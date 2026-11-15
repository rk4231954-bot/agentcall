import { Webhooks } from "@octokit/webhooks";
import type { Db } from "@agentcall/db";
import { features, type Env } from "./env";
import { GitHubApp } from "./integrations/github";
import { Instabox } from "./integrations/instabox";
import { SlackApp } from "./integrations/slack";
import { Cipher } from "./lib/crypto";
import { createLogger, type Logger } from "./lib/log";

/** Everything routes and the worker need, built once and injectable in tests. */
export interface Deps {
  env: Env;
  db: Db;
  cipher: Cipher;
  log: Logger;
  github: GitHubApp | null;
  slack: SlackApp | null;
  webhooks: Webhooks | null;
  instabox: (apiKey: string) => Instabox;
  fetch: typeof fetch;
}

export function createDeps(env: Env, db: Db, overrides: Partial<Deps> = {}): Deps {
  const f = features(env);
  const fetchImpl = overrides.fetch ?? fetch;
  return {
    env,
    db,
    cipher: new Cipher(env.ENCRYPTION_KEY),
    log: createLogger(env.NODE_ENV === "test" ? "silent" : "info"),
    github: f.github
      ? new GitHubApp(
          {
            appId: env.GITHUB_APP_ID!,
            slug: env.GITHUB_APP_SLUG!,
            privateKey: env.GITHUB_APP_PRIVATE_KEY!,
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
          fetchImpl,
        )
      : null,
    slack: f.slack
      ? new SlackApp(
          {
            clientId: env.SLACK_CLIENT_ID!,
            clientSecret: env.SLACK_CLIENT_SECRET!,
            signingSecret: env.SLACK_SIGNING_SECRET!,
          },
          fetchImpl,
        )
      : null,
    webhooks: env.GITHUB_WEBHOOK_SECRET ? new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET }) : null,
    instabox: (apiKey) => new Instabox(apiKey, undefined, fetchImpl),
    fetch: fetchImpl,
    ...overrides,
  };
}
