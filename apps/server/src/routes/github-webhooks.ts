import { Hono } from "hono";
import type { EmitterWebhookEvent } from "@octokit/webhooks";
import type { Deps } from "../deps";
import { ApiError, errors, ok } from "../lib/http";

// GitHub App webhooks at /github/events, the URL configured on the app.
// Verified and dispatched with @octokit/webhooks, as Octokit's own
// middleware does. No handlers act on events yet; they're only logged.

export function githubWebhookRoutes(deps: Deps) {
  deps.webhooks?.onAny(({ id, name, payload }) => {
    const action = "action" in payload ? payload.action : undefined;
    deps.log.info("github.webhook", { id, name, action });
  });
  deps.webhooks?.onError((e) => deps.log.error("github.webhook_handler", { error: String(e) }));

  return new Hono().post("/", async (c) => {
    if (!deps.webhooks) throw errors.notConfigured("GitHub webhooks");
    const id = c.req.header("x-github-delivery");
    const name = c.req.header("x-github-event");
    const signature = c.req.header("x-hub-signature-256");
    if (!id || !name || !signature) {
      throw new ApiError(400, "missing_headers", "Required GitHub webhook headers are missing.");
    }
    const payload = await c.req.text();
    if (!(await deps.webhooks.verify(payload, signature))) {
      throw new ApiError(401, "invalid_signature", "Webhook signature didn't match.");
    }
    if (name === "ping") return ok(c, { pong: true });
    await deps.webhooks.receive({ id, name, payload: JSON.parse(payload) } as EmitterWebhookEvent);
    return ok(c, { received: true });
  });
}
