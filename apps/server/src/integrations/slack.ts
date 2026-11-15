import { createHmac } from "node:crypto";
import { safeEqual } from "../lib/crypto";

// Bot scopes: read mentions and channel messages, post as each bot
// (chat:write.customize sets per-bot names), join the chosen channel, upload reports.
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "files:write",
  "groups:history",
  "groups:read",
  "reactions:write",
];

export interface SlackAppConfig {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

/** Slack request signing: v0=HMAC_SHA256(secret, "v0:{ts}:{body}"), within 5 minutes. */
export function verifySlackSignature(secret: string, timestamp: string | undefined, signature: string | undefined, body: string) {
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return safeEqual(expected, signature);
}

export class SlackApp {
  constructor(
    readonly config: SlackAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  installUrl(state: string, redirectUri: string) {
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchange(code: string, redirectUri: string) {
    const res = await this.fetchImpl("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as {
      ok: boolean;
      error?: string;
      access_token: string;
      scope: string;
      bot_user_id: string;
      team: { id: string; name: string };
    };
    if (!body.ok) throw new Error(`Slack OAuth failed: ${body.error}`);
    return body;
  }

  verify(timestamp: string | undefined, signature: string | undefined, body: string): boolean {
    return verifySlackSignature(this.config.signingSecret, timestamp, signature, body);
  }
}

export type SlackChannel = { id: string; name: string; isPrivate: boolean; isMember: boolean };

export class SlackClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      form.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const res = await this.fetchImpl(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error}`);
    return body;
  }

  async listChannels(): Promise<SlackChannel[]> {
    const out: SlackChannel[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res = await this.call<{
        channels: { id: string; name: string; is_private: boolean; is_member: boolean }[];
        response_metadata?: { next_cursor?: string };
      }>("conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "200",
        cursor,
      });
      out.push(
        ...res.channels.map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private, isMember: c.is_member })),
      );
      cursor = res.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  join(channel: string) {
    return this.call("conversations.join", { channel });
  }

  post(input: {
    channel: string;
    text: string;
    threadTs?: string;
    username?: string;
    iconEmoji?: string;
    blocks?: unknown[];
  }) {
    return this.call<{ ts: string; channel: string }>("chat.postMessage", {
      channel: input.channel,
      text: input.text,
      thread_ts: input.threadTs,
      username: input.username,
      icon_emoji: input.iconEmoji,
      blocks: input.blocks,
      unfurl_links: "false",
    });
  }

  update(input: { channel: string; ts: string; text: string; blocks?: unknown[] }) {
    return this.call("chat.update", input);
  }

  react(channel: string, ts: string, name: string) {
    return this.call("reactions.add", { channel, timestamp: ts, name }).catch(() => undefined);
  }

  /** Uploads a file into a channel thread (files.getUploadURLExternal flow). */
  async upload(input: { channel: string; threadTs?: string; filename: string; title: string; bytes: Uint8Array }) {
    const { upload_url, file_id } = await this.call<{ upload_url: string; file_id: string }>(
      "files.getUploadURLExternal",
      { filename: input.filename, length: String(input.bytes.byteLength) },
    );
    const res = await this.fetchImpl(upload_url, { method: "POST", body: input.bytes });
    if (!res.ok) throw new Error(`Slack upload failed: ${res.status}`);
    await this.call("files.completeUploadExternal", {
      files: [{ id: file_id, title: input.title }],
      channel_id: input.channel,
      thread_ts: input.threadTs,
    });
  }
}
