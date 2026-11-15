import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export const defaultMigrationsDir = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Postgres when `url` is a postgres:// URL (production, Railway). Otherwise an
 * embedded PGlite (Postgres in WASM) for local dev and tests: `url` is a data
 * directory, or omitted for an in-memory database.
 */
export async function createDatabase(
  url: string | undefined,
  migrationsFolder = process.env.MIGRATIONS_DIR ?? defaultMigrationsDir,
): Promise<Database> {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    // Small pool: Railway's starter Postgres has a low connection limit.
    const client = postgres(url, { max: 5, idle_timeout: 30, prepare: true });
    const db = drizzlePg(client, { schema });
    return {
      db: db as unknown as Db,
      migrate: () => migratePg(db, { migrationsFolder }),
      close: () => client.end({ timeout: 5 }),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (url) mkdirSync(url, { recursive: true });
  const client = new PGlite(url);
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  };
}
