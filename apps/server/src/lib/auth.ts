import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { sessions, users, type Db, type User } from "@agentcall/db";
import { randomToken, sha256 } from "./crypto";
import { errors } from "./http";

export const SESSION_COOKIE = "ac_session";
const SESSION_DAYS = 30;

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });
export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);

export async function startSession(c: Context, db: Db, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(c: Context, db: Db) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function sessionUser(c: Context, db: Db): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}

export type AuthVars = { user: User };

export const requireUser = (db: Db) =>
  createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
    const user = await sessionUser(c, db);
    if (!user) throw errors.unauthorized();
    c.set("user", user);
    await next();
  });

export const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  onboarded: Boolean(u.onboardedAt),
});
