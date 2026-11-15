import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { validator } from "hono/validator";
import type { z } from "zod";

// Every /api/v1 response has one of two shapes:
//   { "ok": true,  "data": ... }
//   { "ok": false, "error": { "code": "snake_case", "message": "Human readable", "details"?: ... } }

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const ok = <T>(c: Context, data: T, status: ContentfulStatusCode = 200) =>
  c.json({ ok: true, data } satisfies ApiSuccess<T>, status);

export const fail = (c: Context, status: ContentfulStatusCode, code: string, message: string, details?: unknown) =>
  c.json({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } } satisfies ApiFailure, status);

export const errors = {
  unauthorized: () => new ApiError(401, "unauthorized", "Sign in to continue."),
  notFound: (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`),
  notConfigured: (what: string) =>
    new ApiError(503, "integration_not_configured", `${what} isn't configured on this server yet.`),
  precondition: (code: string, message: string) => new ApiError(409, code, message),
};

/** Validates a request part with zod and throws the standard 422 on failure. */
export const validate = <T extends z.ZodType, K extends "json" | "query" | "param">(target: K, schema: T) =>
  validator(target, (value) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ApiError(
        422,
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Invalid request.",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
    return parsed.data as z.infer<T>;
  });
