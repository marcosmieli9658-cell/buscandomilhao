import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const cdpUrl = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";

async function isRunning() {
  try {
    const response = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

if (await isRunning()) {
  console.log(`Chrome dedicado já está disponível em ${cdpUrl}.`);
  process.exit(0);
}

const candidates = [
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES
    ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
    : undefined,
  process.env["PROGRAMFILES(X86)"]
    ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
    : undefined,
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
    : undefined,
].filter((candidate): candidate is string => Boolean(candidate));

const chromePath = candidates.find(existsSync);

if (!chromePath) {
  throw new Error(
    "Google Chrome não encontrado. Defina CHROME_PATH no .env com o caminho do chrome.exe.",
  );
}

const profilePath = path.join(process.cwd(), ".chrome-profile");
mkdirSync(profilePath, { recursive: true });

const child = spawn(
  chromePath,
  [
    "--remote-debugging-port=9222",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profilePath}`,
    "https://www.instagram.com/",
  ],
  { detached: true, stdio: "ignore" },
);

child.unref();
console.log("Chrome dedicado aberto. Entre no Instagram e mantenha essa janela disponível.");
