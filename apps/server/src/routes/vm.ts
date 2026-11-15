import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { tasks, vmRuns } from "@agentcall/db";
import type { Deps } from "../deps";
import { safeEqual, sha256 } from "../lib/crypto";
import { ApiError, errors, ok, validate } from "../lib/http";
import { uploadToThread } from "../services/notify";
import { applyVmEvent } from "../worker/tasks";

// Callbacks from the runner on instabox VMs. Each run has its own bearer
// token (only its hash is stored), valid only while the run is active.

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const ARTIFACT_NAME = /^[\w.-]{1,100}\.(pdf|png|jpe?g|webm|mp4|txt|md|log)$/i;

const event = z.object({
  type: z.enum(["started", "progress", "heartbeat", "done", "failed"]),
  message: z.string().max(4000),
  data: z
    .object({ prUrl: z.string().url().nullable().optional(), artifacts: z.array(z.string()).optional() })
    .partial()
    .optional(),
  at: z.string().optional(),
});

export function vmRoutes(deps: Deps) {
  const authed = async (runId: string, header: string | undefined) => {
    const token = header?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !z.string().uuid().safeParse(runId).success) throw errors.unauthorized();
    const [run] = await deps.db.select().from(vmRuns).where(eq(vmRuns.id, runId)).limit(1);
    if (!run || !safeEqual(run.callbackTokenHash, sha256(token))) throw errors.unauthorized();
    return run;
  };

  return new Hono()
    .post("/runs/:id/events", validate("json", event), async (c) => {
      const run = await authed(c.req.param("id"), c.req.header("authorization"));
      await applyVmEvent(deps, run, c.req.valid("json"));
      return ok(c, { accepted: true });
    })
    .post("/runs/:id/artifacts", async (c) => {
      const run = await authed(c.req.param("id"), c.req.header("authorization"));
      if (run.status !== "starting" && run.status !== "running") {
        throw new ApiError(409, "run_finished", "This run has already ended.");
      }
      const name = c.req.query("name") ?? "";
      if (!ARTIFACT_NAME.test(name)) throw new ApiError(422, "invalid_name", "Unsupported artifact name.");
      if (Number(c.req.header("content-length") ?? 0) > MAX_ARTIFACT_BYTES) {
        throw new ApiError(413, "too_large", "Artifacts are limited to 25 MB.");
      }
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new ApiError(413, "too_large", "Artifacts are limited to 25 MB.");
      const [task] = await deps.db.select().from(tasks).where(eq(tasks.id, run.taskId)).limit(1);
      if (task) await uploadToThread(deps, task, name, bytes);
      return ok(c, { uploaded: name });
    });
}
