import { and, asc, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bots, githubConnections, machines, taskEvents, tasks, vmRuns, type Task, type VmRun } from "@agentcall/db";
import type { Deps } from "../deps";
import { toOpencodeModel } from "../integrations/opencode";
import { getApiKey } from "../services/keys";
import { notifyDone, notifyFailed, notifyStatus } from "../services/notify";
import { cancelRun, ensureMachine, provision, readRunEvents, startRun, type VmEvent } from "../vm/vm-service";

export async function addEvent(deps: Deps, taskId: string, type: string, message: string, data?: Record<string, unknown>) {
  await deps.db.insert(taskEvents).values({ taskId, type, message, data });
}

/**
 * Claims the oldest queued task whose user has nothing running. One running
 * task per user, because each user has a single instabox machine.
 * Callers must not claim concurrently (the worker claims one at a time).
 */
export async function claimNext(deps: Deps): Promise<Task | null> {
  return deps.db.transaction(async (tx) => {
    const running = alias(tasks, "running");
    const [next] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "queued"),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(running)
              .where(and(eq(running.userId, tasks.userId), eq(running.status, "running"))),
          ),
        ),
      )
      .orderBy(asc(tasks.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [task] = await tx
      .update(tasks)
      .set({ status: "running", attempts: sql`${tasks.attempts} + 1`, startedAt: new Date() })
      .where(eq(tasks.id, next.id))
      .returning();
    return task ?? null;
  });
}

export async function finishTask(
  deps: Deps,
  task: Task,
  outcome: { status: "succeeded"; summary: string; prUrl?: string | null } | { status: "failed" | "cancelled"; error: string },
) {
  const [updated] = await deps.db
    .update(tasks)
    .set(
      outcome.status === "succeeded"
        ? { status: "succeeded", result: { summary: outcome.summary, prUrl: outcome.prUrl ?? undefined }, finishedAt: new Date() }
        : { status: outcome.status, error: outcome.error, finishedAt: new Date() },
    )
    // Only a running task finishes: a late callback can't revive a cancelled one.
    .where(and(eq(tasks.id, task.id), eq(tasks.status, "running")))
    .returning();
  if (!updated) return;
  await addEvent(deps, task.id, outcome.status, outcome.status === "succeeded" ? "Finished" : outcome.error);
  if (outcome.status === "succeeded") await notifyDone(deps, updated, outcome.summary, outcome.prUrl);
  else if (outcome.status === "failed") await notifyFailed(deps, updated, outcome.error);
}

/** Gets a claimed task onto the user's VM. The VM reports back on its own. */
export async function launchTask(deps: Deps, task: Task) {
  try {
    const [bot] = await deps.db.select().from(bots).where(eq(bots.id, task.botId)).limit(1);
    if (!bot) throw new Error("This bot no longer exists.");
    const opencodeKey = await getApiKey(deps, task.userId, "opencode");
    if (!opencodeKey) throw new Error("Add your OpenCode API key in agentcall first.");
    const instaboxKey = await getApiKey(deps, task.userId, "instabox");
    if (!instaboxKey) throw new Error("Add your instabox API key in agentcall first.");

    let githubToken: string | null = null;
    let baseBranch: string | null = null;
    if (task.repo) {
      const [conn] = await deps.db
        .select()
        .from(githubConnections)
        .where(eq(githubConnections.userId, task.userId))
        .limit(1);
      if (!deps.github || !conn) throw new Error("Connect GitHub so I can work on the repository.");
      // Scoped to this one repository, valid for an hour, acting as the agentcall app.
      const { token } = await deps.github.installationToken(conn.installationId, [task.repo]);
      githubToken = token;
      baseBranch = (await deps.github.repo(token, task.repo)).default_branch;
    }

    await notifyStatus(deps, task, ":hourglass_flowing_sand: Starting my machine…");
    await addEvent(deps, task.id, "progress", "Starting the machine");
    const ib = deps.instabox(instaboxKey);
    const machine = await ensureMachine(deps, task.userId, ib);
    await provision(deps, ib, machine);

    await startRun(
      deps,
      ib,
      machine,
      {
        taskId: task.id,
        title: titleFrom(task.prompt),
        prompt: task.prompt,
        model: toOpencodeModel(bot.model),
        botName: bot.name,
        botPurpose: bot.purpose,
        botInstructions: bot.instructions,
        repo: task.repo,
        baseBranch,
      },
      { opencodeKey, githubToken },
    );
    await addEvent(deps, task.id, "progress", "Agent launched on the machine");
    await notifyStatus(deps, task, ":gear: Working on it…");
  } catch (e) {
    deps.log.error("task.launch_failed", { taskId: task.id, error: String(e) });
    await finishTask(deps, task, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

/** Applies one event from the VM runner. Safe to call twice for the same event. */
export async function applyVmEvent(deps: Deps, run: VmRun, event: VmEvent) {
  if (run.status === "done" || run.status === "failed" || run.status === "lost") return;
  const [task] = await deps.db.select().from(tasks).where(eq(tasks.id, run.taskId)).limit(1);
  if (!task) return;

  const terminal = event.type === "done" || event.type === "failed";
  await deps.db
    .update(vmRuns)
    .set({
      lastHeartbeatAt: new Date(),
      ...(event.type === "started" ? { status: "running" as const } : {}),
      ...(terminal ? { status: event.type === "done" ? ("done" as const) : ("failed" as const), endedAt: new Date() } : {}),
    })
    .where(eq(vmRuns.id, run.id));

  if (event.type === "heartbeat") return;
  if (!terminal) {
    await addEvent(deps, task.id, event.type, event.message);
    if (event.type === "progress") await notifyStatus(deps, task, `:gear: ${event.message}`);
    return;
  }

  await releaseMachine(deps, run);
  if (event.type === "done") {
    await finishTask(deps, task, { status: "succeeded", summary: event.message, prUrl: event.data?.prUrl });
  } else {
    await finishTask(deps, task, { status: "failed", error: event.message });
  }
}

async function machineFor(deps: Deps, run: VmRun) {
  const [m] = await deps.db.select().from(machines).where(eq(machines.id, run.machineId)).limit(1);
  const key = m ? await getApiKey(deps, m.userId, "instabox") : null;
  return m && key ? { machine: m, ib: deps.instabox(key) } : null;
}

async function releaseMachine(deps: Deps, run: VmRun) {
  const vm = await machineFor(deps, run);
  if (vm) await vm.ib.releaseAwake(vm.machine.instaboxId, run.id);
}

export async function cancelTask(deps: Deps, task: Task) {
  const [run] = await deps.db
    .select()
    .from(vmRuns)
    .where(and(eq(vmRuns.taskId, task.id), inArray(vmRuns.status, ["starting", "running"])))
    .limit(1);
  if (run) {
    const vm = await machineFor(deps, run);
    if (vm) {
      await cancelRun(vm.ib, vm.machine, run.id).catch(() => undefined);
      await vm.ib.releaseAwake(vm.machine.instaboxId, run.id);
    }
    await deps.db.update(vmRuns).set({ status: "failed", endedAt: new Date() }).where(eq(vmRuns.id, run.id));
  }
  if (task.status === "queued") {
    await deps.db.update(tasks).set({ status: "cancelled", finishedAt: new Date() }).where(eq(tasks.id, task.id));
  } else {
    await finishTask(deps, task, { status: "cancelled", error: "Cancelled" });
  }
  await notifyStatus(deps, task, ":octagonal_sign: Cancelled.");
}

/**
 * Keeps active runs honest: renews the machine's awake lease, recovers results
 * whose callbacks were lost by reading the runner's event log, and fails runs
 * past their deadline.
 */
export async function watchRuns(deps: Deps) {
  const active = await deps.db
    .select()
    .from(vmRuns)
    .where(inArray(vmRuns.status, ["starting", "running"]));
  const staleBefore = Date.now() - 3 * 60_000;

  for (const run of active) {
    try {
      const vm = await machineFor(deps, run);
      if (!vm) continue;
      await vm.ib.holdAwake(vm.machine.instaboxId, run.id).catch(() => undefined);

      const lastSeen = (run.lastHeartbeatAt ?? run.createdAt).getTime();
      if (lastSeen < staleBefore || run.deadlineAt.getTime() < Date.now()) {
        const events = await readRunEvents(vm.ib, vm.machine, run.id);
        const final = events.findLast((e) => e.type === "done" || e.type === "failed");
        if (final) {
          await applyVmEvent(deps, run, final);
          continue;
        }
        if (run.deadlineAt.getTime() < Date.now()) {
          await cancelRun(vm.ib, vm.machine, run.id).catch(() => undefined);
          await deps.db.update(vmRuns).set({ status: "lost", endedAt: new Date() }).where(eq(vmRuns.id, run.id));
          await vm.ib.releaseAwake(vm.machine.instaboxId, run.id);
          const [task] = await deps.db.select().from(tasks).where(eq(tasks.id, run.taskId)).limit(1);
          if (task) await finishTask(deps, task, { status: "failed", error: "The agent ran out of time." });
        }
      }
    } catch (e) {
      deps.log.warn("watchdog.run_failed", { runId: run.id, error: String(e) });
    }
  }

  // Tasks stuck "running" with no run at all (e.g. the server restarted mid-launch).
  const orphans = await deps.db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "running"),
        lt(tasks.startedAt, new Date(Date.now() - 15 * 60_000)),
        notExists(deps.db.select({ one: sql`1` }).from(vmRuns).where(eq(vmRuns.taskId, tasks.id))),
      ),
    );
  for (const t of orphans) await finishTask(deps, t, { status: "failed", error: "The agent never started." });
}

function titleFrom(prompt: string) {
  const line = prompt.trim().split("\n")[0] ?? "Task";
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}
