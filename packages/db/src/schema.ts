import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Columns ending in `Enc` hold AES-256-GCM ciphertext (see apps/server/src/lib/crypto.ts),
// never plaintext. Each one is bound to its row and purpose via AAD.

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the session token; the token itself only lives in the cookie.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const apiKeyProvider = pgEnum("api_key_provider", ["opencode", "instabox"]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: apiKeyProvider("provider").notNull(),
    keyEnc: text("key_enc").notNull(),
    last4: text("last4").notNull(),
    // Provider details captured at verification, e.g. the instabox workspace and plan.
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("api_keys_user_provider_idx").on(t.userId, t.provider)],
);

export const githubConnections = pgTable("github_connections", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  installationId: bigint("installation_id", { mode: "number" }).notNull().unique(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  repositorySelection: text("repository_selection").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const slackConnections = pgTable("slack_connections", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  teamName: text("team_name").notNull(),
  botUserId: text("bot_user_id").notNull(),
  botTokenEnc: text("bot_token_enc").notNull(),
  scope: text("scope").notNull(),
  channelId: text("channel_id"),
  channelName: text("channel_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const bots = pgTable(
  "bots",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default(":robot_face:"),
    purpose: text("purpose").notNull(),
    instructions: text("instructions").notNull().default(""),
    // Which kinds of work this bot takes on; used to route Slack messages.
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    model: text("model").notNull(),
    slackChannelId: text("slack_channel_id"),
    repos: text("repos").array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bots_user_idx").on(t.userId)],
);

// One persistent instabox machine per user: the free plan allows a single
// machine, so it is created once, resumed for each task and left to pause.
export const machines = pgTable("machines", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  instaboxId: text("instabox_id").notNull(),
  name: text("name").notNull(),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taskStatus = pgEnum("task_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const taskSource = pgEnum("task_source", ["slack", "dashboard", "api"]);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    source: taskSource("source").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    prompt: text("prompt").notNull(),
    repo: text("repo"),
    slackChannelId: text("slack_channel_id"),
    slackThreadTs: text("slack_thread_ts"),
    // The bot's live status message in the thread, edited as work progresses.
    slackStatusTs: text("slack_status_ts"),
    // Dedupe key for inbound events (Slack retries the same event_id).
    externalId: text("external_id").unique(),
    attempts: integer("attempts").notNull().default(0),
    result: jsonb("result").$type<TaskResult>(),
    error: text("error"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_queue_idx").on(t.status, t.createdAt),
    index("tasks_user_idx").on(t.userId, t.createdAt),
  ],
);

export type TaskResult = {
  summary?: string;
  prUrl?: string;
  reportPath?: string;
  artifacts?: { name: string; path: string }[];
};

export const taskEvents = pgTable(
  "task_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("task_events_task_idx").on(t.taskId, t.id)],
);

export const vmRunStatus = pgEnum("vm_run_status", ["starting", "running", "done", "failed", "lost"]);

export const vmRuns = pgTable(
  "vm_runs",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    status: vmRunStatus("status").notNull().default("starting"),
    // SHA-256 of the per-run bearer token the VM uses to call back.
    callbackTokenHash: text("callback_token_hash").notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("vm_runs_task_idx").on(t.taskId), index("vm_runs_status_idx").on(t.status)],
);

export type User = typeof users.$inferSelect;
export type Bot = typeof bots.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type VmRun = typeof vmRuns.$inferSelect;
export type Machine = typeof machines.$inferSelect;
