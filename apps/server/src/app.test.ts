import { afterAll, expect, test } from "bun:test";
import { createServer } from "./app";

const server = createServer(0);
afterAll(() => server.stop(true));

test("GET /health", async () => {
  const res = await fetch(new URL("/health", server.url));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("GET / greets", async () => {
  const res = await fetch(new URL("/?name=team", server.url));
  expect(await res.text()).toBe("Hello, team!");
});

test("unknown route is 404", async () => {
  const res = await fetch(new URL("/nope", server.url));
  expect(res.status).toBe(404);
});
