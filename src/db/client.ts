import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export function normalizeDatabasePath(databaseUrl: string): string {
  const value = databaseUrl.replace(/^file:/, "");
  if (value === ":memory:") return value;
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), value);
}

export function createDatabase(databaseUrl = getEnv().DATABASE_URL) {
  const filename = normalizeDatabasePath(databaseUrl);
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

const globalDatabase = globalThis as typeof globalThis & {
  __upscaleDatabase?: ReturnType<typeof createDatabase>;
};

export const database = globalDatabase.__upscaleDatabase ?? createDatabase();
if (process.env.NODE_ENV !== "production") globalDatabase.__upscaleDatabase = database;
