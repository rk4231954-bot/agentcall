import { expect, test } from "bun:test";
import { app } from "./app";

test("GET / says hello world", async () => {
  const res = await app.request("/");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Hello, World!");
});

test("GET /health", async () => {
  const res = await app.request("/health");
  expect(await res.json()).toEqual({ ok: true });
});

test("GET /hello greets by name", async () => {
  const res = await app.request("/hello?name=team");
  expect(await res.json()).toEqual({ message: "Hello, team!" });
});

test("GET /hello/random returns a greeting", async () => {
  const res = await app.request("/hello/random");
  const body = (await res.json()) as { language: string; text: string };
  expect(res.status).toBe(200);
  expect(body.language).toBeString();
  expect(body.text).toBeString();
});

test("unknown route is 404", async () => {
  const res = await app.request("/nope");
  expect(res.status).toBe(404);
});
