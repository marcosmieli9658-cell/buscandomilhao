import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/client";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
if (!fs.existsSync(migrationsFolder)) throw new Error("Migration directory not found.");

const { db, sqlite } = createDatabase();
migrate(db, { migrationsFolder });
sqlite.close();
console.log("Database migrations completed.");
