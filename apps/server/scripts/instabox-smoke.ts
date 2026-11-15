// Live check of the instabox path with a real key (the free plan's single machine):
//   INSTABOX_TEST_API_KEY=ibk_... bun scripts/instabox-smoke.ts [--keep]
// Creates the machine, provisions the runner and opencode, runs the runner on a
// question-only task with a free model, prints its events, then deletes the machine.
import { createDatabase, machines } from "@agentcall/db";
import { randomBytes } from "node:crypto";
import { createDeps } from "../src/deps";
import { loadEnv } from "../src/env";
import { Instabox } from "../src/integrations/instabox";
import { ensureMachine, provision, readRunEvents, runDir, VM_ROOT } from "../src/vm/vm-service";
import { users, tasks, bots, vmRuns } from "@agentcall/db";
import { sha256 } from "../src/lib/crypto";
import runnerSource from "../src/vm/runner.vm.js" with { type: "text" };

const key = process.env.INSTABOX_TEST_API_KEY;
if (!key) throw new Error("INSTABOX_TEST_API_KEY is required");
const keep = process.argv.includes("--keep");

const env = loadEnv({ ...process.env, ENCRYPTION_KEY: randomBytes(32).toString("base64"), WORKER_CONCURRENCY: "0" });
const database = await createDatabase(undefined);
await database.migrate();
const deps = createDeps(env, database.db);
const ib = new Instabox(key);
const t0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

console.log("usage", await ib.usage());
const [user] = await deps.db.insert(users).values({ name: "smoke", email: "smoke@test", passwordHash: "x" }).returning();
let machine: Awaited<ReturnType<typeof ensureMachine>> | undefined;
try {
  step("ensureMachine");
  machine = await ensureMachine(deps, user!.id, ib);
  step(`machine ${machine.instaboxId}`);
  await provision(deps, ib, machine);
  step("provisioned");
  const again = Date.now();
  await provision(deps, ib, machine);
  step(`re-provision check took ${Date.now() - again}ms`);
  console.log((await ib.exec(machine.instaboxId, { cmd: "opencode --version; bun --version; which chromium chromium-browser google-chrome 2>/dev/null; df -h /data | tail -1" })).stdout);

  // A local stand-in for the server's callback endpoint, on the VM itself.
  await ib.exec(machine.instaboxId, {
    cmd: `setsid nohup bun -e 'Bun.serve({port:8787,fetch:async r=>{if(r.method==="POST"){await Bun.write("/tmp/cb-"+Date.now()+"-"+Math.random(), await r.text())};return new Response("{}")}})' > /tmp/cb.log 2>&1 < /dev/null &`,
  });

  const [bot] = await deps.db.insert(bots).values({ userId: user!.id, name: "Smoke", purpose: "answer questions", model: "big-pickle" }).returning();
  const [task] = await deps.db.insert(tasks).values({ userId: user!.id, botId: bot!.id, source: "api", prompt: "x" }).returning();
  const [run] = await deps.db
    .insert(vmRuns)
    .values({ taskId: task!.id, machineId: machine.id, callbackTokenHash: sha256("t"), deadlineAt: new Date(Date.now() + 3600_000) })
    .returning();
  const dir = runDir(run!.id);
  const RUNNER = `${VM_ROOT}/runner-${sha256(runnerSource).slice(0, 12)}.js`;
  await ib.writeFile(
    machine.instaboxId,
    `${dir}/task.json`,
    JSON.stringify({
      taskId: task!.id,
      runId: run!.id,
      title: "Smoke test",
      prompt: "In two sentences: what is a race condition? Write the answer to the summary file.",
      model: "opencode/big-pickle",
      botName: "Smoke",
      botPurpose: "answer questions",
      botInstructions: "",
      repo: null,
      baseBranch: null,
      branch: "agentcall/smoke",
      callbackUrl: "http://127.0.0.1:8787/run",
      timeoutMinutes: 10,
    }),
    "0600",
  );
  step("starting runner");
  await ib.exec(machine.instaboxId, {
    cmd: `cd ${dir} && setsid nohup bun ${RUNNER} ${dir} > runner.log 2>&1 < /dev/null & echo $! > ${dir}/pid`,
    envs: { AGENTCALL_CALLBACK_TOKEN: "t", OPENCODE_API_KEY: process.env.OPENCODE_TEST_API_KEY ?? "" },
    noHistory: true,
  });
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(10_000);
    const events = await readRunEvents(ib, machine, run!.id);
    const last = events.filter((e) => e.type !== "heartbeat").at(-1);
    step(`${events.length} events, last: ${last?.type} ${last?.message?.slice(0, 120)}`);
    if (last?.type === "done" || last?.type === "failed") {
      for (const e of events) console.log("  ", e.type, JSON.stringify(e.message).slice(0, 400), e.data ? JSON.stringify(e.data) : "");
      break;
    }
  }
  console.log((await ib.exec(machine.instaboxId, { cmd: `tail -30 ${dir}/runner.log; ls /tmp/cb-* | wc -l; ls ${dir}` })).stdout);
} finally {
  if (machine && !keep) {
    step("deleting machine");
    await ib.deleteMachine(machine.instaboxId).catch((e) => console.error("delete failed", e));
    step("deleted");
  }
  await database.close();
}
