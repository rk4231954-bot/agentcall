import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for every secret we store (API keys, OAuth tokens).
// Format: "v1:" + base64url(iv[12] || tag[16] || ciphertext).
// The AAD binds a ciphertext to its owner and purpose, e.g. "api_key:opencode:<userId>",
// so a value copied into another row or column fails to decrypt.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class Cipher {
  readonly #key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes");
    this.#key = key;
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
  }

  decrypt(payload: string, aad: string): string {
    const [version, body] = payload.split(":");
    if (version !== VERSION || !body) throw new Error("Unsupported ciphertext");
    const raw = Buffer.from(body, "base64url");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }

  /** Signed, expiring state for OAuth round trips. */
  sign(data: Record<string, string | number>, ttlSeconds = 600): string {
    const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
      "base64url",
    );
    return `${body}.${this.#mac(body)}`;
  }

  verify<T extends Record<string, unknown>>(token: string): T | null {
    const [body, mac] = token.split(".");
    if (!body || !mac || !safeEqual(mac, this.#mac(body))) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    return data.exp > Date.now() / 1000 ? data : null;
  }

  #mac(body: string) {
    return createHmac("sha256", this.#key).update(`state:${body}`).digest("base64url");
  }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const aad = {
  apiKey: (provider: string, userId: string) => `api_key:${provider}:${userId}`,
  slackBot: (userId: string) => `slack_bot:${userId}`,
};
