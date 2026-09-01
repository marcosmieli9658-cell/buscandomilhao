import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseEnvironment(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

const projectRoot = process.cwd();
const workspaceEnvironment = path.resolve(projectRoot, "../../.env.local");
const appEnvironment = path.resolve(projectRoot, ".env");
if (!fs.existsSync(workspaceEnvironment)) throw new Error("Workspace .env.local was not found.");
if (!fs.existsSync(appEnvironment)) throw new Error("Application .env was not found.");

const source = parseEnvironment(fs.readFileSync(workspaceEnvironment, "utf8"));
const current = parseEnvironment(fs.readFileSync(appEnvironment, "utf8"));
const replacements = new Map([
  ["INSTAGRAM_PAGE_ACCESS_TOKEN", source.get("META_IG_ACCESS_TOKEN")],
  ["INSTAGRAM_BUSINESS_ACCOUNT_ID", source.get("META_IG_USER_ID")],
  ["INSTAGRAM_GRAPH_VERSION", source.get("META_GRAPH_VERSION")],
  ["INSTAGRAM_WEBHOOK_VERIFY_TOKEN", current.get("INSTAGRAM_WEBHOOK_VERIFY_TOKEN") || crypto.randomBytes(32).toString("hex")],
]);

for (const [name, value] of replacements) {
  if (!value) throw new Error(`Required workspace credential ${name} is missing.`);
}

const updated = fs.readFileSync(appEnvironment, "utf8").split(/\r?\n/).map((line) => {
  const name = line.match(/^([A-Z0-9_]+)=/)?.[1];
  return name && replacements.has(name) ? `${name}=${replacements.get(name)}` : line;
}).join("\n");

fs.writeFileSync(appEnvironment, `${updated.replace(/\n+$/, "")}\n`, { encoding: "utf8", mode: 0o600 });
console.log("Imported existing Instagram credentials and ensured a private webhook verification token in the local app environment.");
