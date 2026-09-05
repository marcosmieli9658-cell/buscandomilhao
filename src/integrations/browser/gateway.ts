import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { database } from "@/db/client";
import { getBusinessConfig } from "@/lib/business";
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

export interface DiscoveredProfile {
  handle: string;
  displayName?: string;
  bio?: string;
  websiteUrl?: string;
  qualificationEvidence?: string;
  suggestedService?: "site_creation" | "site_diagnostic" | "ecommerce" | "google_business";
}

export interface BrowserGateway {
  sendFirstMessage(request: BrowserSendRequest): Promise<BrowserSendResult>;
  discoverProfiles?(request: { jobId: number; keyword: string; limit: number }): Promise<DiscoveredProfile[]>;
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

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function instagramSearchKeyword(keyword: string): string {
  return normalizeSearchText(keyword)
    .replace(/sao jose dos campos/g, "sjc")
    .replace(/pindamonhangaba/g, "pinda")
    .replace(/\s+/g, " ")
    .trim();
}

export function profileMatchesQuery(keyword: string, profileText: string, requireLocation = false): boolean {
  const query = normalizeSearchText(keyword);
  const profile = normalizeSearchText(profileText);
  if (/\b(noticias?|news|portal de noticias)\b/.test(profile)) return false;

  const segmentGroups = [
    { query: /clinic|consult|estet|odont|dent|saude|fisi|terap|psic/, profile: /clinic|consult|estet|odont|dent|medic|fisi|terap|psic|saude/ },
    { query: /imobili|corret|imove/, profile: /imobili|corret|imove|empreendimento/ },
    { query: /restaurante|gastronom|pizz|hamburg|lanch|bar\b|churrasc/, profile: /restaurante|gastronom|pizz|hamburg|lanch|bar\b|churrasc|cafe/ },
    { query: /loja|varejo|moda|roupa|calcado|acessor|boutique/, profile: /loja|varejo|moda|roupa|calcado|acessor|boutique|store/ },
    { query: /agencia|marketing|design|publicidade/, profile: /agencia|marketing|design|publicidade|comunicacao/ },
    { query: /salao|barbear|beleza|cabelo/, profile: /salao|barbear|beleza|cabelo|hair/ },
    { query: /arquit|engenh|decor|interiores/, profile: /arquit|engenh|decor|interiores/ },
  ];
  const requestedGroups = segmentGroups.filter((group) => group.query.test(query));
  const segmentMatches = requestedGroups.length
    ? requestedGroups.some((group) => group.profile.test(profile))
    : undefined;

  const locationGroups = [
    { query: /sao jose dos campos|\bsjc\b/, profile: /sao jose dos campos|\bsjc\b/ },
    { query: /cacapava/, profile: /cacapava/ },
    { query: /pindamonhangaba|\bpinda\b/, profile: /pindamonhangaba|\bpinda\b/ },
    { query: /taubate/, profile: /taubate/ },
    { query: /tremembe/, profile: /tremembe/ },
    { query: /jacarei/, profile: /jacarei/ },
    { query: /vale do paraiba/, profile: /vale do paraiba/ },
  ];
  const requestedLocations = locationGroups.filter((group) => group.query.test(query));
  if (requireLocation && requestedLocations.length && !requestedLocations.some((group) => group.profile.test(profile))) return false;
  if (segmentMatches !== undefined) return segmentMatches;

  const ignored = new Set(["sao", "jose", "dos", "das", "campos", "vale", "paraiba", "brasil", "cidade", "perto", "empresa"]);
  const terms = query.split(/[^a-z0-9]+/).filter((term) => term.length >= 4 && !ignored.has(term));
  return terms.length > 0 && terms.some((term) => profile.includes(term));
}

function unwrapExternalUrl(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    const candidate = parsed.hostname === "l.instagram.com" ? parsed.searchParams.get("u") : href;
    if (!candidate) return undefined;
    const external = new URL(candidate);
    if (["instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com"].includes(external.hostname)) return undefined;
    return external.protocol === "https:" || external.protocol === "http:" ? external.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function extractVisibleExternalUrl(profileText: string): string | undefined {
  const match = profileText.match(/(?:https?:\/\/)?(?:www\.)?((?:linktr\.ee|beacons\.ai|bio\.site|linkin\.bio)\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+)/i);
  if (!match) return undefined;
  return unwrapExternalUrl(`https://${match[1]}`);
}

export function inferSuggestedService(profileText: string, websiteUrl?: string) {
  const normalized = normalizeSearchText(profileText);
  const isRetail = /loja|varejo|moda|roupa|calcado|acessor|boutique|store|produto/.test(normalized);
  const isLinkHub = websiteUrl ? /linktr\.ee|beacons\.ai|bio\.site|linkin\.bio|wa\.me/.test(websiteUrl) : false;
  if (isRetail && (!websiteUrl || isLinkHub)) return "ecommerce" as const;
  if (!websiteUrl || isLinkHub) return "site_creation" as const;
  return "site_diagnostic" as const;
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
  async discoverProfiles(request: { jobId: number; keyword: string; limit: number }) {
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
        await search.fill(instagramSearchKeyword(request.keyword));
        await page.waitForTimeout(1800);
        const reserved = new Set(["explore", "direct", "accounts", "reels", "stories", "about"]);
        const candidates = await page.getByRole("main").getByRole("link").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href"), text: link.textContent?.trim() ?? "" })));
        const seen = new Set<string>();
        const ownHandle = getBusinessConfig().instagramHandle.replace(/^@/, "").toLowerCase();
        const matching = candidates.flatMap((candidate) => {
          const match = candidate.href?.match(/^\/([A-Za-z0-9._]+)\/$/);
          const handle = match?.[1].toLowerCase();
          if (!handle || handle === ownHandle || reserved.has(handle) || seen.has(handle)) return [];
          seen.add(handle);
          if (!profileMatchesQuery(request.keyword, candidate.text)) return [];
          const displayName = candidate.text.replace(new RegExp(`^${handle}`, "i"), "").trim() || undefined;
          return [{ handle: `@${handle}`, displayName }];
        }).slice(0, Math.min(20, request.limit));

        const profiles: DiscoveredProfile[] = [];
        for (const candidate of matching) {
          const profilePage = await context.newPage();
          try {
            const profileUrl = `https://www.instagram.com/${encodeURIComponent(candidate.handle.slice(1))}/`;
            validateInstagramUrl(profileUrl);
            await profilePage.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
            const main = profilePage.getByRole("main");
            await main.waitFor({ state: "visible", timeout: 15_000 });
            const publicText = (await main.innerText()).replace(/\s+/g, " ").trim().slice(0, 1_200);
            if (!profileMatchesQuery(request.keyword, `${candidate.displayName ?? ""} ${publicText}`, true)) continue;
            const externalHref = await main.locator('a[href*="l.instagram.com"], a[href^="http://"], a[href^="https://"]').first().getAttribute("href").catch(() => null);
            const websiteUrl = unwrapExternalUrl(externalHref) ?? extractVisibleExternalUrl(publicText);
            const suggestedService = inferSuggestedService(publicText, websiteUrl);
            const siteEvidence = websiteUrl ? `link externo identificado na bio (${new URL(websiteUrl).hostname})` : "nenhum site identificado na bio";
            profiles.push({
              ...candidate,
              bio: publicText,
              websiteUrl,
              suggestedService,
              qualificationEvidence: `Perfil público compatível com a busca \"${request.keyword}\"; ${siteEvidence}.`,
            });
          } finally {
            await profilePage.close().catch(() => undefined);
          }
        }
        return profiles;
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
