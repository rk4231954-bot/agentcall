import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { users } from "@agentcall/db";
import type { Deps } from "../deps";
import { endSession, hashPassword, publicUser, requireUser, sessionUser, startSession, verifyPassword } from "../lib/auth";
import { ApiError, ok, validate } from "../lib/http";
import { rateLimiter } from "../lib/rate-limit";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const password = z.string().min(8, "Use at least 8 characters.").max(256);

// A dummy hash so a login for an unknown email costs the same time as a real one.
const DUMMY_HASH = await hashPassword("agentcall-timing-equalizer");

export function authRoutes(deps: Deps) {
  const limit = rateLimiter(10, 60_000);
  const clientKey = (ip: string | undefined, mail: string) => `${ip ?? "?"}:${mail}`;

  return new Hono()
    .post(
      "/signup",
      validate("json", z.object({ name: z.string().trim().min(1, "Tell us your name.").max(100), email, password })),
      async (c) => {
        const body = c.req.valid("json");
        if (!limit(clientKey(c.req.header("x-forwarded-for"), body.email))) {
          throw new ApiError(429, "rate_limited", "Too many attempts. Try again in a minute.");
        }
        const [existing] = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
        if (existing) throw new ApiError(409, "email_taken", "An account with this email already exists.");
        const [user] = await deps.db
          .insert(users)
          .values({ name: body.name, email: body.email, passwordHash: await hashPassword(body.password) })
          .returning();
        await startSession(c, deps.db, user!.id);
        return ok(c, { user: publicUser(user!) }, 201);
      },
    )
    .post("/login", validate("json", z.object({ email, password: z.string().min(1).max(256) })), async (c) => {
      const body = c.req.valid("json");
      if (!limit(clientKey(c.req.header("x-forwarded-for"), body.email))) {
        throw new ApiError(429, "rate_limited", "Too many attempts. Try again in a minute.");
      }
      const [user] = await deps.db.select().from(users).where(eq(users.email, body.email)).limit(1);
      const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !valid) throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
      await startSession(c, deps.db, user.id);
      return ok(c, { user: publicUser(user) });
    })
    .post("/logout", async (c) => {
      await endSession(c, deps.db);
      return ok(c, { signedOut: true });
    })
    .get("/me", async (c) => {
      const user = await sessionUser(c, deps.db);
      if (!user) throw new ApiError(401, "unauthorized", "Sign in to continue.");
      return ok(c, { user: publicUser(user) });
    })
    .use("/account", requireUser(deps.db))
    .delete("/account", async (c) => {
      await deps.db.delete(users).where(eq(users.id, c.get("user").id));
      await endSession(c, deps.db);
      return ok(c, { deleted: true });
    });
}
