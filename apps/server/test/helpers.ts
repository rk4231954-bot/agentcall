import { randomBytes } from "node:crypto";
import { createDatabase } from "@agentcall/db";
import { createApp } from "../src/app";
import { createDeps, type Deps } from "../src/deps";
import { loadEnv } from "../src/env";

export type FetchCall = { url: string; init?: RequestInit };
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

/** A fetch that answers from handlers and records every call; unknown URLs fail loudly. */
export function fakeFetch(...handlers: Handler[]) {
  const calls: FetchCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url: url.toString(), init });
    for (const h of handlers) {
      const res = await h(url, init);
      if (res) return res;
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function setup(envOverrides: Record<string, string> = {}, fetchImpl?: typeof fetch) {
  const env = loadEnv({
    NODE_ENV: "test",
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    WEB_URL: "http://web.test",
    PUBLIC_SERVER_URL: "http://server.test",
    WORKER_CONCURRENCY: "0",
    ...envOverrides,
  });
  const database = await createDatabase(undefined);
  await database.migrate();
  const deps: Deps = createDeps(env, database.db, fetchImpl ? { fetch: fetchImpl } : {});
  const app = createApp(deps);

  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    return { status: res.status, body: (await res.json()) as any };
  };
  const signup = async (email = "ada@example.com") => {
    const r = await call("POST", "/api/v1/auth/signup", { name: "Ada", email, password: "correct horse" });
    return r.body.data.user as { id: string };
  };
  return { deps, app, call, signup, close: database.close, setCookie: (c: string) => (cookie = c) };
}
