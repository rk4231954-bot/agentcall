import { eq } from "drizzle-orm";
import { bots, tasks, type Task } from "@agentcall/db";
import type { Deps } from "../deps";
import { SlackClient } from "../integrations/slack";
import { getSlackToken } from "./keys";

// Each bot speaks in Slack under its own name and emoji (chat:write.customize),
// in the thread the task came from. A single status message is edited as work
// progresses, then the result is posted as a reply.

type Target = { client: SlackClient; channel: string; threadTs?: string; username: string; iconEmoji: string };

async function target(deps: Deps, task: Task): Promise<Target | null> {
  if (!task.slackChannelId) return null;
  const slack = await getSlackToken(deps, task.userId);
  if (!slack) return null;
  const [bot] = await deps.db.select().from(bots).where(eq(bots.id, task.botId)).limit(1);
  return {
    client: new SlackClient(slack.token, deps.fetch),
    channel: task.slackChannelId,
    threadTs: task.slackThreadTs ?? undefined,
    username: bot?.name ?? "agentcall",
    iconEmoji: bot?.emoji ?? ":robot_face:",
  };
}

async function safely(deps: Deps, what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    deps.log.warn(`slack.${what}`, { error: String(e) });
  }
}

export async function notifyStatus(deps: Deps, task: Task, text: string) {
  const t = await target(deps, task);
  if (!t) return;
  await safely(deps, "status", async () => {
    if (task.slackStatusTs) {
      await t.client.update({ channel: t.channel, ts: task.slackStatusTs, text });
      return;
    }
    const msg = await t.client.post({ channel: t.channel, threadTs: t.threadTs, text, username: t.username, iconEmoji: t.iconEmoji });
    await deps.db.update(tasks).set({ slackStatusTs: msg.ts }).where(eq(tasks.id, task.id));
    task.slackStatusTs = msg.ts;
  });
}

export async function notifyReply(deps: Deps, task: Task, text: string) {
  const t = await target(deps, task);
  if (!t) return;
  await safely(deps, "reply", () =>
    t.client.post({ channel: t.channel, threadTs: t.threadTs, text: text.slice(0, 3900), username: t.username, iconEmoji: t.iconEmoji }),
  );
}

export async function notifyDone(deps: Deps, task: Task, summary: string, prUrl?: string | null) {
  await notifyStatus(deps, task, prUrl ? `:white_check_mark: Done. Pull request: ${prUrl}` : ":white_check_mark: Done.");
  await notifyReply(deps, task, prUrl ? `${summary}\n\n:link: <${prUrl}|View the pull request>` : summary);
}

export async function notifyFailed(deps: Deps, task: Task, error: string) {
  await notifyStatus(deps, task, `:x: I couldn't finish this: ${error.slice(0, 500)}`);
}

export async function uploadToThread(deps: Deps, task: Task, filename: string, bytes: Uint8Array) {
  const t = await target(deps, task);
  if (!t) return;
  await safely(deps, "upload", () =>
    t.client.upload({ channel: t.channel, threadTs: t.threadTs, filename, title: filename, bytes }),
  );
}
