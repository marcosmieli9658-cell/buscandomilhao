Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: ":memory:",
  OPERATING_HOURS: "00:00-23:59",
  MIN_SECONDS_BETWEEN_DMS: "30",
  MAX_SECONDS_BETWEEN_DMS: "60",
  MAX_DMS_PER_DAY: "30",
  OPERATING_DAYS: "0,1,2,3,4,5,6",
  DRY_RUN: "false",
  OPENAI_MONTHLY_BUDGET_USD: "50",
});

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { database } = await import("@/db/client");
migrate(database.db, { migrationsFolder: "drizzle" });

export {};
