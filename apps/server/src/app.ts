import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Deps } from "./deps";
import { ApiError, fail, ok } from "./lib/http";
import { authRoutes } from "./routes/auth";
import { botRoutes } from "./routes/bots";
import { githubWebhookRoutes } from "./routes/github-webhooks";
import { integrationRoutes, onboardingRoutes } from "./routes/integrations";
import { slackEventRoutes } from "./routes/slack-events";
import { taskRoutes } from "./routes/tasks";
import { vmRoutes } from "./routes/vm";

export function createApp(deps: Deps) {
  const app = new Hono();
  const webOrigin = new URL(deps.env.WEB_URL).origin;

  app.use(secureHeaders());

  // CSRF: browser mutations must come from the web app. Server-to-server
  // callers (Slack, GitHub, VMs) send no Origin and authenticate by signature or token.
  app.use("/api/v1/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin && origin !== webOrigin) {
      throw new ApiError(403, "forbidden_origin", "Requests must come from the agentcall app.");
    }
    await next();
  });

  app.get("/", (c) => ok(c, { name: "agentcall", version: "v1" }));
  app.get("/health", (c) => ok(c, { status: "healthy" }));

  const v1 = new Hono()
    .route("/auth", authRoutes(deps))
    .route("/onboarding", onboardingRoutes(deps))
    .route("/integrations", integrationRoutes(deps))
    .route("/bots", botRoutes(deps))
    .route("/tasks", taskRoutes(deps))
    .route("/slack/events", slackEventRoutes(deps))
    .route("/vm", vmRoutes(deps));
  app.route("/api/v1", v1);
  app.route("/github/events", githubWebhookRoutes(deps));

  app.notFound((c) => fail(c, 404, "not_found", "No such endpoint."));
  app.onError((err, c) => {
    if (err instanceof ApiError) return fail(c, err.status, err.code, err.message, err.details);
    if (err instanceof SyntaxError) return fail(c, 400, "invalid_json", "The request body isn't valid JSON.");
    deps.log.error("http.unhandled", { path: c.req.path, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    return fail(c, 500, "internal_error", "Something went wrong on our side.");
  });

  return app;
}
