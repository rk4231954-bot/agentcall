import { eq } from "drizzle-orm";
import { machines, vmRuns, type Machine } from "@agentcall/db";
import type { Deps } from "../deps";
import { type Instabox, InstaboxError } from "../integrations/instabox";
import { randomToken, sha256 } from "../lib/crypto";
import runnerSource from "./runner.vm.js" with { type: "text" };

// Each user brings their own instabox key. The free plan allows one machine,
// so we keep exactly one per user: created once, resumed for each task, and
// left to auto-pause after 30 idle minutes. Runs on it are serialized by the
// queue (one running task per user).

export const VM_ROOT = "/data/home/agentcall";
const RUNNER_VERSION = sha256(runnerSource).slice(0, 12);
const RUNNER_PATH = `${VM_ROOT}/runner-${RUNNER_VERSION}.js`;
const OPENCODE_MIN = "1.18.0";

export const runDir = (runId: string) => `${VM_ROOT}/runs/${runId}`;

export class VmUnavailableError extends Error {}

export async function ensureMachine(deps: Deps, userId: string, ib: Instabox): Promise<Machine> {
  const [existing] = await deps.db.select().from(machines).where(eq(machines.userId, userId)).limit(1);
  if (existing) {
    try {
      await ib.ensureRunning(existing.instaboxId);
      return existing;
    } catch (e) {
      // Deleted from the instabox dashboard: forget it and make a new one.
      if (!(e instanceof InstaboxError) || (e.status !== 404 && e.code !== "machine_unavailable")) throw e;
      await deps.db.delete(machines).where(eq(machines.id, existing.id));
    }
  }

  const usage = await ib.usage();
  if (usage.machines >= usage.limits.maxMachines) {
    throw new VmUnavailableError(
      `Your instabox workspace already has ${usage.machines} of ${usage.limits.maxMachines} machines. Delete one in instabox so agentcall can create its own.`,
    );
  }
  const name = `agentcall-${userId.slice(0, 8)}`;
  deps.log.info("instabox.create", { userId, name });
  const m = await ib.createMachine({ name, metadata: { app: "agentcall", user: userId } });
  const [row] = await deps.db
    .insert(machines)
    .values({ userId, instaboxId: m.id, name: m.name })
    .onConflictDoUpdate({ target: machines.userId, set: { instaboxId: m.id, name: m.name, provisionedAt: null } })
    .returning();
  return row!;
}

/**
 * Installs what runs need, once per runner version: the runner script and a
 * current opencode. Cheap to call before every run (one exec when up to date).
 */
export async function provision(deps: Deps, ib: Instabox, machine: Machine) {
  const check = await ib.exec(machine.instaboxId, {
    cmd: `test -f ${RUNNER_PATH} && opencode --version 2>/dev/null`,
    noHistory: true,
    timeoutSeconds: 30,
  });
  const version = check.exitCode === 0 ? check.stdout.trim() : "";
  if (version && !olderThan(version, OPENCODE_MIN)) return;

  deps.log.info("instabox.provision", { machine: machine.instaboxId, runner: RUNNER_VERSION, opencode: version });
  await ib.writeFile(machine.instaboxId, RUNNER_PATH, runnerSource, "0644");
  const install = await ib.exec(machine.instaboxId, {
    // npm's global prefix is the machine user's on agent-browser: no sudo.
    cmd: `mkdir -p ${VM_ROOT}/runs && npm install -g opencode-ai@latest --no-fund --no-audit --loglevel=error && opencode --version`,
    timeoutSeconds: 600,
  });
  if (install.exitCode !== 0) throw new Error(`Installing opencode failed: ${install.stderr.slice(-500)}`);
  await deps.db.update(machines).set({ provisionedAt: new Date() }).where(eq(machines.id, machine.id));
}

export interface RunSpec {
  taskId: string;
  title: string;
  prompt: string;
  model: string;
  botName: string;
  botPurpose: string;
  botInstructions: string;
  repo: string | null;
  baseBranch: string | null;
}

export interface RunSecrets {
  opencodeKey: string;
  githubToken: string | null;
}

/** Starts the runner detached on the VM. It reports back by itself. */
export async function startRun(deps: Deps, ib: Instabox, machine: Machine, spec: RunSpec, secrets: RunSecrets) {
  const callbackToken = randomToken();
  const deadlineAt = new Date(Date.now() + (deps.env.TASK_TIMEOUT_MINUTES + 10) * 60_000);
  const [run] = await deps.db
    .insert(vmRuns)
    .values({ taskId: spec.taskId, machineId: machine.id, callbackTokenHash: sha256(callbackToken), deadlineAt })
    .returning();
  const dir = runDir(run!.id);
  const base = deps.env.PUBLIC_SERVER_URL ?? `http://localhost:${deps.env.PORT}`;

  const task = {
    ...spec,
    runId: run!.id,
    branch: `agentcall/${slug(spec.title)}-${run!.id.slice(0, 6)}`,
    callbackUrl: `${base.replace(/\/$/, "")}/api/v1/vm/runs/${run!.id}`,
    timeoutMinutes: deps.env.TASK_TIMEOUT_MINUTES,
  };
  await ib.holdAwake(machine.instaboxId, run!.id);
  await ib.writeFile(machine.instaboxId, `${dir}/task.json`, JSON.stringify(task), "0600");

  const envs: Record<string, string> = {
    AGENTCALL_CALLBACK_TOKEN: callbackToken,
    OPENCODE_API_KEY: secrets.opencodeKey,
  };
  if (secrets.githubToken) envs.GH_TOKEN = secrets.githubToken;

  // setsid: its own process group, so a cancel can stop opencode and its children too.
  const started = await ib.exec(machine.instaboxId, {
    cmd: `cd ${dir} && setsid nohup bun ${RUNNER_PATH} ${dir} > runner.log 2>&1 < /dev/null & echo $! > ${dir}/pid`,
    envs,
    noHistory: true,
    timeoutSeconds: 30,
  });
  if (started.exitCode !== 0) throw new Error(`Starting the agent failed: ${started.stderr.slice(-300)}`);
  return run!;
}

export async function cancelRun(ib: Instabox, machine: Machine, runId: string) {
  const dir = runDir(runId);
  await ib.exec(machine.instaboxId, {
    cmd: `test -f ${dir}/pid && kill -TERM -- -$(cat ${dir}/pid) 2>/dev/null; true`,
    noHistory: true,
    timeoutSeconds: 30,
  });
}

/** Reads what the runner wrote, for when its callbacks never arrived. */
export async function readRunEvents(ib: Instabox, machine: Machine, runId: string) {
  try {
    const bytes = await ib.readFile(machine.instaboxId, `${runDir(runId)}/events.jsonl`);
    return new TextDecoder()
      .decode(bytes)
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as VmEvent);
  } catch (e) {
    if (e instanceof InstaboxError && e.status === 404) return [];
    throw e;
  }
}

export type VmEvent = {
  type: "started" | "progress" | "heartbeat" | "done" | "failed";
  message: string;
  data?: { prUrl?: string | null; artifacts?: string[] };
  at?: string;
};

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "task"
  );
}

function olderThan(version: string, min: string) {
  const a = version.replace(/^v/, "").split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
