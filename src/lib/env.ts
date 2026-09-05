import { z } from "zod";
import { loadEnvFile } from "node:process";

// The standalone worker does not run through Next.js's environment loader.
// Existing process variables win; local overrides are loaded before .env.
if (process.env.NODE_ENV !== "test") {
  for (const filename of [".env.local", ".env"]) {
    try { loadEnvFile(filename); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("data/upscale-agent.db"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-2026-03-05"),
  OPENAI_MODEL_FAST: z.string().default("gpt-5.4-mini-2026-03-17"),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(50),
  CHROME_CDP_URL: z.url().default("http://127.0.0.1:9222"),
  CHROME_PROFILE_DIR: z.string().default(".chrome-profile"),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_PRODUCT_APP_SECRET: z.string().optional(),
  INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().optional(),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),
  INSTAGRAM_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  MAX_DMS_PER_DAY: z.coerce.number().int().min(1).max(50).default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().min(30).default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().min(60).default(240),
  OPERATING_HOURS: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().default("America/Sao_Paulo"),
  OPERATING_DAYS: z.string().regex(/^[0-6](,[0-6])*$/).default("1,2,3,4,5"),
  DRY_RUN: z.string().transform((value) => value !== "false").default(true),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(3000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  cachedEnv ??= envSchema.parse(process.env);
  if (cachedEnv.MIN_SECONDS_BETWEEN_DMS > cachedEnv.MAX_SECONDS_BETWEEN_DMS) {
    throw new Error("MIN_SECONDS_BETWEEN_DMS não pode ser maior que MAX_SECONDS_BETWEEN_DMS.");
  }
  return cachedEnv;
}
