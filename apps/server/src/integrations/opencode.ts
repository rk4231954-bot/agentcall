// OpenCode (opencode.ai) inference API. We never run inference on the server:
// agents run the opencode binary inside the user's instabox VM. The server only
// validates keys and lists models.

const BASE = "https://opencode.ai/inference";

export type OpencodeModel = { id: string; name: string; free: boolean };

export class OpencodeKeyError extends Error {}

/**
 * Checks a key without spending anything: an empty request is rejected with
 * 401 for a bad key, and with 400 (validation) for a good one.
 */
export async function verifyOpencodeKey(key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${BASE}/openai/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new OpencodeKeyError("OpenCode rejected this API key.");
  if (res.status >= 500) throw new Error(`OpenCode is unavailable (${res.status}). Try again in a moment.`);
}

let cache: { at: number; models: OpencodeModel[] } | null = null;

export async function listOpencodeModels(fetchImpl: typeof fetch = fetch): Promise<OpencodeModel[]> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.models;
  const res = await fetchImpl(`${BASE}/v1/models`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Could not load OpenCode models (${res.status})`);
  const body = (await res.json()) as {
    data: { id: string; name?: string; type?: string; cost?: { text?: { input?: { price?: number }; output?: { price?: number } } } }[];
  };
  const models = body.data
    .filter((m) => !m.type || m.type === "chat")
    .map((m) => ({ id: m.id, name: m.name ?? m.id, free: m.id.endsWith("-free") || (m.cost?.text?.input?.price === 0 && m.cost.text.output?.price === 0) }));
  cache = { at: Date.now(), models };
  return models;
}

/** opencode CLI model ids are "<provider>/<model>". */
export const toOpencodeModel = (id: string) => (id.includes("/") ? id : `opencode/${id}`);
