import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { apiKeys, bots, githubConnections, slackConnections, users } from "@agentcall/db";
import type { Deps } from "../deps";
import { features } from "../env";
import { InstaboxError } from "../integrations/instabox";
import { listOpencodeModels, OpencodeKeyError, verifyOpencodeKey } from "../integrations/opencode";
import { SlackClient } from "../integrations/slack";
import { requireUser, type AuthVars } from "../lib/auth";
import { aad } from "../lib/crypto";
import { ApiError, errors, ok, validate } from "../lib/http";
import { getSlackToken } from "../services/keys";

const apiKey = z.string().trim().min(8, "That key looks too short.").max(512);

export async function integrationSummary(deps: Deps, userId: string) {
  const [github] = await deps.db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
  const [slack] = await deps.db.select().from(slackConnections).where(eq(slackConnections.userId, userId)).limit(1);
  const keys = await deps.db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  const key = (p: string) => keys.find((k) => k.provider === p);
  const f = features(deps.env);
  const opencode = key("opencode");
  const instabox = key("instabox");
  return {
    github: {
      available: f.github,
      connected: Boolean(github),
      account: github ? { login: github.accountLogin, type: github.accountType, repositorySelection: github.repositorySelection } : null,
    },
    slack: {
      available: f.slack,
      connected: Boolean(slack),
      team: slack ? { id: slack.teamId, name: slack.teamName } : null,
      channel: slack?.channelId ? { id: slack.channelId, name: slack.channelName } : null,
    },
    opencode: { connected: Boolean(opencode), last4: opencode?.last4 ?? null },
    instabox: {
      connected: Boolean(instabox),
      last4: instabox?.last4 ?? null,
      workspace: (instabox?.meta as { workspace?: string } | undefined)?.workspace ?? null,
      plan: (instabox?.meta as { plan?: string } | undefined)?.plan ?? null,
    },
  };
}

export function integrationRoutes(deps: Deps) {
  const callback = (provider: "github" | "slack") => `${deps.env.WEB_URL.replace(/\/$/, "")}/callback/${provider}`;

  const saveKey = async (userId: string, provider: "opencode" | "instabox", key: string, meta: Record<string, unknown>) => {
    const values = {
      keyEnc: deps.cipher.encrypt(key, aad.apiKey(provider, userId)),
      last4: key.slice(-4),
      meta,
      verifiedAt: new Date(),
    };
    await deps.db
      .insert(apiKeys)
      .values({ userId, provider, ...values })
      .onConflictDoUpdate({ target: [apiKeys.userId, apiKeys.provider], set: values });
  };

  return (
    new Hono<{ Variables: AuthVars }>()
      .use(requireUser(deps.db))
      .get("/", async (c) => ok(c, await integrationSummary(deps, c.get("user").id)))

      // ---------- GitHub (agentcall GitHub App) ----------
      .get("/github/install", (c) => {
        if (!deps.github) throw errors.notConfigured("GitHub");
        const state = deps.cipher.sign({ uid: c.get("user").id, p: "github" });
        return ok(c, { url: deps.github.installUrl(state) });
      })
      .post(
        "/github/complete",
        validate(
          "json",
          z.object({ installationId: z.coerce.number().int().positive(), state: z.string(), code: z.string().optional() }),
        ),
        async (c) => {
          if (!deps.github) throw errors.notConfigured("GitHub");
          const { installationId, state, code } = c.req.valid("json");
          const user = c.get("user");
          const s = deps.cipher.verify<{ uid: string; p: string }>(state);
          if (!s || s.uid !== user.id || s.p !== "github") {
            throw new ApiError(400, "invalid_state", "This GitHub link expired. Start the connection again.");
          }
          // The state proves who started the flow; the OAuth code proves the
          // installation is theirs. Without it anyone could claim any installation id.
          if (!code) {
            throw new ApiError(400, "authorization_required", "GitHub didn't send an authorization code. Connect again.");
          }
          if (!(await deps.github.userOwnsInstallation(code, installationId))) {
            throw new ApiError(403, "installation_not_owned", "That GitHub installation doesn't belong to your account.");
          }
          const inst = await deps.github.getInstallation(installationId);
          const values = {
            installationId,
            accountLogin: inst.account.login,
            accountType: inst.account.type,
            repositorySelection: inst.repository_selection,
          };
          await deps.db
            .insert(githubConnections)
            .values({ userId: user.id, ...values })
            .onConflictDoUpdate({ target: githubConnections.userId, set: values });
          return ok(c, { account: { login: inst.account.login, type: inst.account.type } });
        },
      )
      .get("/github/repos", async (c) => {
        if (!deps.github) throw errors.notConfigured("GitHub");
        const [conn] = await deps.db
          .select()
          .from(githubConnections)
          .where(eq(githubConnections.userId, c.get("user").id))
          .limit(1);
        if (!conn) throw errors.precondition("github_not_connected", "Connect GitHub first.");
        return ok(c, { repos: await deps.github.listRepos(conn.installationId) });
      })
      .delete("/github", async (c) => {
        await deps.db.delete(githubConnections).where(eq(githubConnections.userId, c.get("user").id));
        return ok(c, { disconnected: true });
      })

      // ---------- Slack ----------
      .get("/slack/install", (c) => {
        if (!deps.slack) throw errors.notConfigured("Slack");
        const state = deps.cipher.sign({ uid: c.get("user").id, p: "slack" });
        return ok(c, { url: deps.slack.installUrl(state, callback("slack")) });
      })
      .post("/slack/complete", validate("json", z.object({ code: z.string(), state: z.string() })), async (c) => {
        if (!deps.slack) throw errors.notConfigured("Slack");
        const { code, state } = c.req.valid("json");
        const user = c.get("user");
        const s = deps.cipher.verify<{ uid: string; p: string }>(state);
        if (!s || s.uid !== user.id || s.p !== "slack") {
          throw new ApiError(400, "invalid_state", "This Slack link expired. Start the connection again.");
        }
        const res = await deps.slack.exchange(code, callback("slack"));
        const values = {
          teamId: res.team.id,
          teamName: res.team.name,
          botUserId: res.bot_user_id,
          botTokenEnc: deps.cipher.encrypt(res.access_token, aad.slackBot(user.id)),
          scope: res.scope,
        };
        await deps.db
          .insert(slackConnections)
          .values({ userId: user.id, ...values })
          .onConflictDoUpdate({ target: slackConnections.userId, set: values });
        return ok(c, { team: res.team });
      })
      .get("/slack/channels", async (c) => {
        const slack = await getSlackToken(deps, c.get("user").id);
        if (!slack) throw errors.precondition("slack_not_connected", "Connect Slack first.");
        return ok(c, { channels: await new SlackClient(slack.token, deps.fetch).listChannels() });
      })
      .put("/slack/channel", validate("json", z.object({ channelId: z.string().min(1) })), async (c) => {
        const user = c.get("user");
        const slack = await getSlackToken(deps, user.id);
        if (!slack) throw errors.precondition("slack_not_connected", "Connect Slack first.");
        const client = new SlackClient(slack.token, deps.fetch);
        const channel = (await client.listChannels()).find((ch) => ch.id === c.req.valid("json").channelId);
        if (!channel) throw errors.notFound("Channel");
        if (!channel.isMember) {
          if (channel.isPrivate) {
            throw new ApiError(409, "invite_required", `Invite the bot to #${channel.name} first: type /invite @agentcall there.`);
          }
          await client.join(channel.id);
        }
        await deps.db
          .update(slackConnections)
          .set({ channelId: channel.id, channelName: channel.name })
          .where(eq(slackConnections.userId, user.id));
        // Bots without their own channel follow the workspace's default.
        await deps.db.update(bots).set({ slackChannelId: channel.id }).where(and(eq(bots.userId, user.id)));
        await client
          .post({
            channel: channel.id,
            text: `:wave: agentcall is here. Mention me with a bug, a security report or a question, and an agent will take it from there.`,
          })
          .catch(() => undefined);
        return ok(c, { channel: { id: channel.id, name: channel.name } });
      })
      .delete("/slack", async (c) => {
        await deps.db.delete(slackConnections).where(eq(slackConnections.userId, c.get("user").id));
        return ok(c, { disconnected: true });
      })

      // ---------- OpenCode ----------
      .put("/opencode", validate("json", z.object({ apiKey })), async (c) => {
        const key = c.req.valid("json").apiKey;
        try {
          await verifyOpencodeKey(key, deps.fetch);
        } catch (e) {
          if (e instanceof OpencodeKeyError) throw new ApiError(422, "invalid_api_key", e.message);
          throw new ApiError(502, "provider_unavailable", e instanceof Error ? e.message : "OpenCode is unavailable.");
        }
        await saveKey(c.get("user").id, "opencode", key, {});
        return ok(c, { connected: true, last4: key.slice(-4) });
      })
      .get("/opencode/models", async (c) => ok(c, { models: await listOpencodeModels(deps.fetch) }))

      // ---------- instabox ----------
      .put("/instabox", validate("json", z.object({ apiKey })), async (c) => {
        const key = c.req.valid("json").apiKey;
        if (!key.startsWith("ibk_")) throw new ApiError(422, "invalid_api_key", "instabox keys start with ibk_.");
        let usage;
        try {
          usage = await deps.instabox(key).usage();
        } catch (e) {
          if (e instanceof InstaboxError && (e.status === 401 || e.status === 403)) {
            throw new ApiError(422, "invalid_api_key", "instabox rejected this API key.");
          }
          throw new ApiError(502, "provider_unavailable", "instabox is unavailable. Try again in a moment.");
        }
        const meta = { workspace: usage.org.name, plan: usage.org.tier, maxMachines: usage.limits.maxMachines };
        await saveKey(c.get("user").id, "instabox", key, meta);
        return ok(c, { connected: true, last4: key.slice(-4), ...meta, machinesInUse: usage.machines });
      })

      .delete("/:provider{opencode|instabox}", async (c) => {
        const provider = c.req.param("provider") as "opencode" | "instabox";
        await deps.db.delete(apiKeys).where(and(eq(apiKeys.userId, c.get("user").id), eq(apiKeys.provider, provider)));
        return ok(c, { disconnected: true });
      })
  );
}

export function onboardingRoutes(deps: Deps) {
  return new Hono<{ Variables: AuthVars }>()
    .use(requireUser(deps.db))
    .get("/", async (c) => {
      const user = c.get("user");
      const summary = await integrationSummary(deps, user.id);
      const [bot] = await deps.db.select({ id: bots.id }).from(bots).where(eq(bots.userId, user.id)).limit(1);
      return ok(c, { ...summary, bot: { created: Boolean(bot) }, completed: Boolean(user.onboardedAt) });
    })
    .post("/complete", async (c) => {
      const user = c.get("user");
      const keys = await deps.db.select({ p: apiKeys.provider }).from(apiKeys).where(eq(apiKeys.userId, user.id));
      if (!keys.some((k) => k.p === "opencode")) {
        throw errors.precondition("opencode_required", "Add your OpenCode API key to finish.");
      }
      await deps.db.update(users).set({ onboardedAt: new Date() }).where(eq(users.id, user.id));
      return ok(c, { completed: true });
    });
}
