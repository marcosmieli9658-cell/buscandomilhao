import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";
import { enqueueJob } from "./queue";

let lastSeededDate: string | undefined;

function zonedScheduleParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    weekday: weekdays[values.weekday],
  };
}

export function isAutonomousDiscoveryWindow(input: {
  now: Date;
  timezone: string;
  operatingHours: string;
  startDate: string;
  weekdays: number[];
}): boolean {
  const parts = zonedScheduleParts(input.now, input.timezone);
  const [start, end] = input.operatingHours.split("-");
  return parts.date >= input.startDate
    && input.weekdays.includes(parts.weekday)
    && parts.time >= start
    && parts.time <= end;
}

export function ensureDailyDiscoveryJobs(now = new Date()): number {
  const business = getBusinessConfig();
  const campaign = business.autonomousDiscovery;
  const env = getEnv();
  const parts = zonedScheduleParts(now, env.OPERATING_TIMEZONE);
  if (!campaign.enabled || lastSeededDate === parts.date) return 0;
  if (!isAutonomousDiscoveryWindow({
    now,
    timezone: env.OPERATING_TIMEZONE,
    operatingHours: env.OPERATING_HOURS,
    startDate: campaign.startDate,
    weekdays: campaign.weekdays,
  })) return 0;

  let remaining = Math.min(campaign.dailyLeadLimit, env.MAX_DMS_PER_DAY);
  let jobs = 0;
  for (const keyword of campaign.keywords) {
    if (remaining <= 0) break;
    const limit = Math.min(5, remaining);
    enqueueJob("discover_instagram", { keyword, funnel: "client", limit, automatic: true }, {
      dedupeKey: `automatic_discovery:${parts.date}:${keyword.toLowerCase()}`,
    });
    remaining -= limit;
    jobs += 1;
  }
  lastSeededDate = parts.date;
  return jobs;
}
