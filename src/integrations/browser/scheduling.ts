import { database } from "@/db/client";
import { getEnv } from "@/lib/env";

export function getZonedTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export class BrowserSendDeferredError extends Error {
  constructor(message: string, readonly retryAt: Date) { super(message); }
}

export function nextOperatingTime(date: Date): Date {
  const env = getEnv();
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const days = env.OPERATING_DAYS.split(",").map(Number);
  const [start, end] = env.OPERATING_HOURS.split("-");
  let candidate = new Date(date);
  for (let minute = 0; minute <= 8 * 24 * 60; minute++) {
    const parts = getZonedTimeParts(candidate, env.OPERATING_TIMEZONE);
    const time = `${parts.hour}:${parts.minute}`;
    if (days.includes(weekdays[parts.weekday]) && time >= start && time <= end) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error("Nenhum horário operacional disponível na próxima semana.");
}

export function nextBrowserSendAt(now = new Date(), random = Math.random): Date {
  const env = getEnv();
  const lastSent = database.sqlite.prepare("SELECT MAX(sent_at) AS value FROM messages WHERE channel = 'browser' AND delivery_state = 'sent'").get() as { value: number | null };
  const lastScheduled = database.sqlite.prepare("SELECT MAX(run_at) AS value FROM jobs WHERE type IN ('send_browser_dm', 'send_approved_browser') AND status IN ('pending', 'retry', 'running')").get() as { value: number | null };
  if (!lastSent.value && !lastScheduled.value) return nextOperatingTime(now);

  const minimum = env.MIN_SECONDS_BETWEEN_DMS;
  const maximum = env.MAX_SECONDS_BETWEEN_DMS;
  const delaySeconds = Math.min(maximum, minimum + Math.floor(random() * (maximum - minimum + 1)));
  const baseline = lastScheduled.value
    ? Math.max(now.getTime(), lastScheduled.value, lastSent.value ?? 0)
    : Math.max(now.getTime() - delaySeconds * 1000, lastSent.value ?? 0);
  return nextOperatingTime(new Date(baseline + delaySeconds * 1000));
}
