import { and, eq } from "drizzle-orm";
import { apiKeys, slackConnections } from "@agentcall/db";
import type { Deps } from "../deps";
import { aad } from "../lib/crypto";

export type Provider = "opencode" | "instabox";

/** Decrypts a user's stored API key, or null if they haven't added one. */
export async function getApiKey(deps: Deps, userId: string, provider: Provider): Promise<string | null> {
  const [row] = await deps.db
    .select({ keyEnc: apiKeys.keyEnc })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
    .limit(1);
  return row ? deps.cipher.decrypt(row.keyEnc, aad.apiKey(provider, userId)) : null;
}

export async function getSlackToken(deps: Deps, userId: string) {
  const [row] = await deps.db.select().from(slackConnections).where(eq(slackConnections.userId, userId)).limit(1);
  if (!row) return null;
  return { connection: row, token: deps.cipher.decrypt(row.botTokenEnc, aad.slackBot(userId)) };
}
