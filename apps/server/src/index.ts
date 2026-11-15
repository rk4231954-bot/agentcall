import { createDatabase } from "@agentcall/db";
import { createApp } from "./app";
import { createDeps } from "./deps";
import { loadEnv } from "./env";
import { startWorker } from "./worker/worker";

const env = loadEnv();
const database = await createDatabase(env.DATABASE_URL);
await database.migrate();

const deps = createDeps(env, database.db);
const worker = startWorker(deps);
const server = Bun.serve({ port: env.PORT, fetch: createApp(deps).fetch, maxRequestBodySize: 30 * 1024 * 1024 });
deps.log.info("server.listening", { url: server.url.toString() });

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  deps.log.info("server.shutdown", { signal });
  await server.stop();
  await worker.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
