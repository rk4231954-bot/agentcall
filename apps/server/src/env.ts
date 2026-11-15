import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  /** postgres:// URL in production; a PGlite data dir (or empty for in-memory) locally. */
  DATABASE_URL: optional,
  /** 32 random bytes, base64. Encrypts every stored key and token (AES-256-GCM). */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "must be 32 bytes, base64 encoded (openssl rand -base64 32)",
  }),
  /** Where the web app lives; OAuth redirects and links point here. */
  WEB_URL: z.string().url().default("http://localhost:3001"),
  /** Public URL of this server, reachable from instabox VMs for callbacks. */
  PUBLIC_SERVER_URL: optional,

  GITHUB_APP_ID: optional,
  GITHUB_APP_SLUG: optional,
  GITHUB_APP_PRIVATE_KEY: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GITHUB_WEBHOOK_SECRET: optional,

  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,
  SLACK_SIGNING_SECRET: optional,

  /** Tasks running at once across all users. Each user still runs one at a time. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(0).default(4),
  /** Hard cap for one agent run. instabox's free plan stops a run at 120 min. */
  TASK_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(110).default(45),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const features = (env: Env) => ({
  // The OAuth client is required too: it's how we prove an installation is the user's.
  github: Boolean(
    env.GITHUB_APP_ID && env.GITHUB_APP_SLUG && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
  ),
  slack: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET),
  vmCallbacks: Boolean(env.PUBLIC_SERVER_URL),
});
