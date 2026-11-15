import type { Deps } from "../deps";
import { claimNext, launchTask, watchRuns } from "./tasks";

// In-process worker. The queue lives in Postgres, so a restart loses nothing:
// queued tasks wait, and the watchdog recovers runs that finished meanwhile.
// Launching is the only work done here; agents run on the users' VMs.

export function startWorker(deps: Deps, opts = { pollMs: 2000, watchMs: 60_000 }) {
  let stopped = false;
  const launching = new Set<Promise<void>>();

  const tick = async () => {
    // Claims are serialized: claimNext relies on it for one-task-per-user.
    while (!stopped && launching.size < deps.env.WORKER_CONCURRENCY) {
      const task = await claimNext(deps);
      if (!task) break;
      deps.log.info("task.claimed", { taskId: task.id, userId: task.userId });
      const p = launchTask(deps, task).finally(() => launching.delete(p));
      launching.add(p);
    }
  };

  const loop = async (fn: () => Promise<void>, every: number, name: string) => {
    while (!stopped) {
      try {
        await fn();
      } catch (e) {
        deps.log.error(`worker.${name}`, { error: String(e) });
      }
      await Bun.sleep(every);
    }
  };

  if (deps.env.WORKER_CONCURRENCY > 0) {
    void loop(tick, opts.pollMs, "tick");
    void loop(() => watchRuns(deps), opts.watchMs, "watch");
  }

  return {
    async stop() {
      stopped = true;
      await Promise.allSettled([...launching]);
    },
  };
}
