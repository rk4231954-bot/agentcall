import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bots, slackConnections, tasks, type Bot } from "@agentcall/db";
import type { Deps } from "../deps";
import { SlackClient, verifySlackSignature } from "../integrations/slack";
import { ApiError, errors, ok } from "../lib/http";
import { getSlackToken } from "../services/keys";
import { notifyReply, notifyStatus } from "../services/notify";
import { cancelTask } from "../worker/tasks";

// Slack is a trigger: mentioning the app in a channel queues a task for one of
// the user's bots, and replies in that thread steer it (status, cancel, or a
// follow-up the bot picks up next). Slack wants a 200 within 3 seconds and
// retries otherwise; event_id dedupes the retries.

type SlackMessageEvent = {
  type: "app_mention" | "message";
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  channel: string;
};

type Envelope =
  | { type: "url_verification"; challenge: string }
  | { type: "event_callback"; team_id: string; event_id: string; event: SlackMessageEvent };

const SKILL_WORDS: Record<string, RegExp> = {
  security: /\b(security|vuln|cve|xss|csrf|injection|leak|exploit|auth)\b/i,
  bugfix: /\b(bug|broken|crash|error|fix|fails?|regression)\b/i,
  testing: /\b(test|qa|e2e|verify|check)\b/i,
  repro: /\b(repro|reproduce|record|video|screen)\b/i,
  review: /\b(review|pr|pull request)\b/i,
  triage: /\b(triage|issue|ticket|customer|client)\b/i,
  support: /\b(how|why|what|question|help)\b/i,
};

/** Picks the bot a message is for: named explicitly, else best skill match in the channel. */
export function routeToBot(all: Bot[], channel: string, text: string): Bot | null {
  const enabled = all.filter((b) => b.enabled);
  const lower = text.toLowerCase();
  const named = enabled
    .filter((b) => new RegExp(`(^|[^\\w])@?${escape(b.name.toLowerCase())}([^\\w]|$)`).test(lower))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return named;
  const inChannel = enabled.filter((b) => b.slackChannelId === channel || !b.slackChannelId);
  const pool = inChannel.length ? inChannel : enabled;
  const scored = pool
    .map((b) => ({ b, score: b.skills.filter((s) => SKILL_WORDS[s]?.test(text)).length }))
    .sort((x, y) => y.score - x.score);
  return scored[0]?.b ?? null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (text: string) => text.replace(/<@[A-Z0-9]+>/g, "").trim();
const REPO = /\b(?:github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\b/;

export function slackEventRoutes(deps: Deps) {
  return new Hono().post("/", async (c) => {
    // Only the signing secret is needed to receive events, so the Request URL
    // can be verified before the OAuth credentials are configured.
    const secret = deps.env.SLACK_SIGNING_SECRET;
    if (!secret) throw errors.notConfigured("Slack");
    const raw = await c.req.text();
    if (!verifySlackSignature(secret, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"), raw)) {
      throw new ApiError(401, "invalid_signature", "Slack signature didn't match.");
    }
    const body = JSON.parse(raw) as Envelope;
    if (body.type === "url_verification") {
      // Slack reads the top-level `challenge`; the rest keeps our standard shape.
      return c.json({ ok: true, data: { challenge: body.challenge }, challenge: body.challenge });
    }
    if (body.type !== "event_callback") return ok(c, { ignored: true });

    try {
      await handleEvent(deps, body.team_id, body.event_id, body.event);
    } catch (e) {
      deps.log.error("slack.event_failed", { eventId: body.event_id, error: String(e) });
    }
    return ok(c, { received: true });
  });
}

async function handleEvent(deps: Deps, teamId: string, eventId: string, ev: SlackMessageEvent) {
  if (ev.bot_id || (ev.subtype && ev.subtype !== "thread_broadcast") || !ev.user) return;

  const conns = await deps.db.select().from(slackConnections).where(eq(slackConnections.teamId, teamId));
  const conn = conns.find((x) => x.channelId === ev.channel) ?? conns[0];
  if (!conn) return;
  const mentionsUs = (ev.text ?? "").includes(`<@${conn.botUserId}>`);
  // A mention fires both `message` and `app_mention`; handle it once.
  if (ev.type === "message" && mentionsUs) return;

  const text = clean(ev.text ?? "");
  const threadTs = ev.thread_ts ?? ev.ts;

  // Replies in a thread we're working in.
  const [prior] = ev.thread_ts
    ? await deps.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, conn.userId), eq(tasks.slackChannelId, ev.channel), eq(tasks.slackThreadTs, ev.thread_ts)))
        .orderBy(desc(tasks.createdAt))
        .limit(1)
    : [];
  if (ev.type === "message" && !prior) return; // ordinary chatter

  if (prior) {
    const command = text.toLowerCase();
    const active = prior.status === "queued" || prior.status === "running";
    if (/^(cancel|stop|abort)\b/.test(command)) {
      if (active) await cancelTask(deps, prior);
      else await notifyReply(deps, prior, "Nothing is running in this thread.");
      return;
    }
    if (/^status\b/.test(command)) {
      await notifyReply(deps, prior, `Status: *${prior.status}*${prior.error ? ` (${prior.error})` : ""}`);
      return;
    }
  }

  const userBots = await deps.db.select().from(bots).where(eq(bots.userId, conn.userId));
  const bot = prior ? (userBots.find((b) => b.id === prior.botId && b.enabled) ?? null) : routeToBot(userBots, ev.channel, text);
  const slack = await getSlackToken(deps, conn.userId);
  const client = slack ? new SlackClient(slack.token, deps.fetch) : null;
  if (!bot) {
    await client
      ?.post({ channel: ev.channel, threadTs, text: "No bot is set up for this yet. Create one in agentcall first." })
      .catch(() => undefined);
    return;
  }
  if (!text) return;

  const prompt = prior
    ? [
        "This is a follow-up in the same Slack thread.",
        `Earlier request: ${prior.prompt}`,
        prior.result?.summary ? `Your earlier answer: ${prior.result.summary}` : "",
        `New message: ${text}`,
      ]
        .filter(Boolean)
        .join("\n\n")
    : text;
  const mentionedRepo = text.match(REPO)?.[1];
  const repo =
    (mentionedRepo && bot.repos.find((r) => r.toLowerCase() === mentionedRepo.toLowerCase())) ?? prior?.repo ?? bot.repos[0] ?? null;

  const [task] = await deps.db
    .insert(tasks)
    .values({
      userId: conn.userId,
      botId: bot.id,
      source: "slack",
      prompt,
      repo,
      slackChannelId: ev.channel,
      slackThreadTs: threadTs,
      externalId: `slack:${eventId}`,
    })
    .onConflictDoNothing({ target: tasks.externalId })
    .returning();
  if (!task) return; // a Slack retry of an event we already have

  void client?.react(ev.channel, ev.ts, "eyes");
  const ahead = await deps.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, conn.userId), eq(tasks.status, "running")))
    .limit(1);
  await notifyStatus(
    deps,
    task,
    ahead.length ? ":inbox_tray: Queued. I'll start as soon as the current task finishes." : ":inbox_tray: Got it, starting shortly.",
  );
}
