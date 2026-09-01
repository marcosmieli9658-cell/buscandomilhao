import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { database } from "@/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { pauseBrowserQueue } from "@/worker/queue";

export interface BrowserSendRequest {
  jobId: number;
  handle: string;
  message: string;
  dryRun: boolean;
}

export interface BrowserSendResult {
  sent: boolean;
  dryRun: boolean;
  url: string;
}

export interface BrowserGateway {
  sendFirstMessage(request: BrowserSendRequest): Promise<BrowserSendResult>;
  discoverProfiles?(request: { jobId: number; keyword: string; limit: number }): Promise<Array<{ handle: string; displayName?: string }>>;
}

let browserMutex: Promise<void> = Promise.resolve();

function withBrowserMutex<T>(task: () => Promise<T>): Promise<T> {
  const next = browserMutex.then(task, task);
  browserMutex = next.then(() => undefined, () => undefined);
  return next;
}

function validateInstagramUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(parsed.hostname)) {
    throw new Error(`Browser navigation outside Instagram was blocked: ${url}`);
  }
}

async function captureFailure(page: Page, jobId: number, consoleErrors: string[], networkErrors: string[]): Promise<void> {
  const directory = path.resolve(process.cwd(), "screenshots", String(jobId));
  await fs.mkdir(directory, { recursive: true });
  const screenshotPath = path.join(directory, "failure.png");
  const snapshotPath = path.join(directory, "accessibility.txt");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  const snapshot = await page.locator("body").ariaSnapshot().catch(() => "Accessibility snapshot unavailable.");
  await fs.writeFile(snapshotPath, snapshot, "utf8");
  database.sqlite.prepare(`
    INSERT INTO browser_artifacts (job_id, screenshot_path, accessibility_snapshot_path, page_url, console_errors_json, network_errors_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(jobId, screenshotPath, snapshotPath, page.url(), JSON.stringify(consoleErrors), JSON.stringify(networkErrors), Date.now(), Date.now());
}

export class PlaywrightCdpGateway implements BrowserGateway {
  async discoverProfiles(request: { jobId: number; keyword: string; limit: number }): Promise<Array<{ handle: string; displayName?: string }>> {
    return withBrowserMutex(async () => {
      const env = getEnv();
      let browser: Browser;
      try {
        browser = await chromium.connectOverCDP(env.CHROME_CDP_URL);
      } catch (error) {
        pauseBrowserQueue("browser_unavailable");
        throw new Error(`Dedicated Chrome session is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
      const context = browser.contexts()[0];
      if (!context) throw new Error("The connected Chrome has no reusable context.");
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const networkErrors: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("requestfailed", (failed) => networkErrors.push(`${failed.method()} ${failed.url()}: ${failed.failure()?.errorText ?? "unknown"}`));
      try {
        const searchUrl = "https://www.instagram.com/explore/search/";
        validateInstagramUrl(searchUrl);
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const search = page.getByPlaceholder(/pesquisar|search/i).or(page.getByRole("textbox", { name: /pesquisar|search/i })).first();
        await search.waitFor({ state: "visible", timeout: 15_000 });
        await search.fill(request.keyword);
        await page.waitForTimeout(1800);
        const reserved = new Set(["explore", "direct", "accounts", "reels", "stories", "about"]);
        const candidates = await page.getByRole("link").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), text: link.textContent?.trim() ?? "" })));
        const seen = new Set<string>();
        return candidates.flatMap((candidate) => {
          const match = candidate.href?.match(/^\/([A-Za-z0-9._]+)\/$/);
          if (!match || reserved.has(match[1]) || seen.has(match[1])) return [];
          seen.add(match[1]);
          return [{ handle: `@${match[1].toLowerCase()}`, displayName: candidate.text.split("\n")[0] || undefined }];
        }).slice(0, Math.min(20, request.limit));
      } catch (error) {
        await captureFailure(page, request.jobId, consoleErrors, networkErrors);
        throw error;
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }

  async sendFirstMessage(request: BrowserSendRequest): Promise<BrowserSendResult> {
    return withBrowserMutex(async () => {
      const env = getEnv();
      let browser: Browser;
      try {
        browser = await chromium.connectOverCDP(env.CHROME_CDP_URL);
      } catch (error) {
        pauseBrowserQueue("browser_unavailable");
        database.sqlite.prepare(`INSERT INTO exceptions (job_id, code, message, details_json, status, created_at, updated_at) VALUES (?, 'browser_unavailable', ?, '{}', 'open', ?, ?)`)
          .run(request.jobId, error instanceof Error ? error.message : String(error), Date.now(), Date.now());
        throw new Error("Dedicated Chrome session is unavailable. The browser queue was paused.");
      }

      const context = browser.contexts()[0];
      if (!context) throw new Error("The connected Chrome has no reusable context.");
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const networkErrors: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      page.on("requestfailed", (requestFailure) => networkErrors.push(`${requestFailure.method()} ${requestFailure.url()}: ${requestFailure.failure()?.errorText ?? "unknown"}`));

      try {
        const handle = request.handle.replace(/^@/, "");
        const profileUrl = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
        validateInstagramUrl(profileUrl);
        await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        validateInstagramUrl(page.url());

        const messageButton = page.getByRole("button", { name: /mensagem|message/i }).first();
        await messageButton.waitFor({ state: "visible", timeout: 15_000 });
        await messageButton.click();
        const composer = page.getByRole("textbox", { name: /mensagem|message/i }).or(page.locator('[contenteditable="true"]')).last();
        await composer.waitFor({ state: "visible", timeout: 15_000 });
        await composer.pressSequentially(request.message, { delay: 45 + Math.floor(Math.random() * 35) });
        await page.waitForTimeout(600 + Math.floor(Math.random() * 700));

        if (request.dryRun) return { sent: false, dryRun: true, url: page.url() };
        await composer.press("Enter");
        await page.waitForTimeout(700);
        logger.info({ jobId: request.jobId, handle: request.handle }, "First Instagram DM sent");
        return { sent: true, dryRun: false, url: page.url() };
      } catch (error) {
        await captureFailure(page, request.jobId, consoleErrors, networkErrors);
        throw error;
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }
}
