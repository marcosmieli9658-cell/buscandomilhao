import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const formats = {
  OPENAI_API_KEY: /^sk-[A-Za-z0-9_-]{20,}$/,
  INSTAGRAM_APP_SECRET: /^[a-fA-F0-9]{32}$/,
};

export function updateCredential(contents, name, value) {
  if (!Object.hasOwn(formats, name) || typeof value !== "string" || !formats[name].test(value)) {
    throw new Error("Nome ou formato de credencial inválido. Nenhum valor foi registrado.");
  }
  const lines = contents.split(/\r?\n/);
  let replaced = false;
  const updated = lines.filter((line) => {
    if (!line.startsWith(`${name}=`)) return true;
    if (replaced) return false;
    replaced = true;
    return true;
  }).map((line) => line.startsWith(`${name}=`) ? `${name}=${value}` : line);
  if (!replaced) updated.push(`${name}=${value}`);
  return `${updated.join("\n").replace(/\n+$/, "")}\n`;
}

// Used by the local setup workflow, never exposed through a web route.
export function storeCredential(name, value) {
  const environmentPath = fileURLToPath(new URL("../.env", import.meta.url));
  const current = readFileSync(environmentPath, "utf8");
  const updated = updateCredential(current, name, value);
  writeFileSync(environmentPath, updated, { encoding: "utf8", mode: 0o600 });
  return { name, stored: true };
}
