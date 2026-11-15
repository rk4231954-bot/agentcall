import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Cipher, aad } from "../src/lib/crypto";

const cipher = new Cipher(randomBytes(32).toString("base64"));

test("AES-256-GCM round trip with a fresh IV each time", () => {
  const a = cipher.encrypt("sk-secret", aad.apiKey("opencode", "u1"));
  const b = cipher.encrypt("sk-secret", aad.apiKey("opencode", "u1"));
  expect(a).not.toBe(b);
  expect(a.startsWith("v1:")).toBe(true);
  expect(a).not.toContain("sk-secret");
  expect(cipher.decrypt(a, aad.apiKey("opencode", "u1"))).toBe("sk-secret");
});

test("ciphertext is bound to its owner and purpose", () => {
  const enc = cipher.encrypt("sk-secret", aad.apiKey("opencode", "u1"));
  expect(() => cipher.decrypt(enc, aad.apiKey("opencode", "u2"))).toThrow();
  expect(() => cipher.decrypt(enc, aad.apiKey("instabox", "u1"))).toThrow();
});

test("tampered ciphertext fails", () => {
  const enc = cipher.encrypt("sk-secret", "x");
  const raw = Buffer.from(enc.slice(3), "base64url");
  raw[raw.length - 1]! ^= 1;
  expect(() => cipher.decrypt(`v1:${raw.toString("base64url")}`, "x")).toThrow();
});

test("signed state verifies, rejects tampering and expiry", () => {
  const s = cipher.sign({ uid: "u1" });
  expect(cipher.verify<{ uid: string }>(s)?.uid).toBe("u1");
  expect(cipher.verify(`${s}x`)).toBeNull();
  expect(cipher.verify(cipher.sign({ uid: "u1" }, -1))).toBeNull();
});
