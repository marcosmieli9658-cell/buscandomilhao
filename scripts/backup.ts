import fs from "node:fs";
import path from "node:path";
import { database, normalizeDatabasePath } from "../src/db/client";
import { getEnv } from "../src/lib/env";

const directory = path.resolve(process.cwd(), "backups");
fs.mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const source = normalizeDatabasePath(getEnv().DATABASE_URL);
if (source === ":memory:") throw new Error("In-memory database cannot be backed up.");
const target = path.join(directory, `upscale-agent-${stamp}.db`);
await database.sqlite.backup(target);
console.log(`Backup created: ${target}`);
