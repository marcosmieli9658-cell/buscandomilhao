import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { channelStates } from "@/lib/types";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
};

export const systemSettings = sqliteTable("system_settings", {
  id: integer("id").primaryKey(),
  globallyPaused: integer("globally_paused", { mode: "boolean" }).notNull().default(false),
  pauseReason: text("pause_reason"),
  browserQueuePaused: integer("browser_queue_paused", { mode: "boolean" }).notNull().default(false),
  browserPauseReason: text("browser_pause_reason"),
  consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  ...timestamps,
});

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  funnel: text("funnel", { enum: ["client", "affiliate"] }).notNull(),
  instagramHandle: text("instagram_handle").notNull(),
  instagramScopedId: text("instagram_scoped_id"),
  displayName: text("display_name"),
  bio: text("bio"),
  category: text("category"),
  location: text("location"),
  source: text("source").notNull(),
  sourceKeyword: text("source_keyword"),
  score: integer("score").notNull().default(0),
  segment: text("segment"),
  decisionMakerType: text("decision_maker_type", { enum: ["store", "employee", "owner", "decision_maker", "unknown"] }).notNull().default("unknown"),
  pipelineState: text("pipeline_state").notNull().default("discovered"),
  channelState: text("channel_state", { enum: channelStates }).notNull().default("browser_contact_pending"),
  channelOwner: text("channel_owner", { enum: ["browser", "api", "human", "none"] }).notNull().default("browser"),
  doNotContact: integer("do_not_contact", { mode: "boolean" }).notNull().default(false),
  doNotContactReason: text("do_not_contact_reason"),
  lastInboundAt: integer("last_inbound_at", { mode: "timestamp_ms" }),
  lastOutboundAt: integer("last_outbound_at", { mode: "timestamp_ms" }),
  nextActionAt: integer("next_action_at", { mode: "timestamp_ms" }),
  tagsJson: text("tags_json").notNull().default("[]"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  version: integer("version").notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("leads_funnel_handle_unique").on(table.funnel, table.instagramHandle),
  uniqueIndex("leads_scoped_id_unique").on(table.instagramScopedId),
  index("leads_pipeline_idx").on(table.funnel, table.pipelineState),
  index("leads_next_action_idx").on(table.nextActionAt),
]);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  externalId: text("external_id"),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  channel: text("channel", { enum: ["browser", "api", "human"] }).notNull(),
  body: text("body").notNull(),
  variantId: integer("variant_id"),
  deliveryState: text("delivery_state", { enum: ["planned", "dry_run", "sent", "delivered", "failed", "blocked"] }).notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("messages_dedupe_unique").on(table.dedupeKey),
  uniqueIndex("messages_external_unique").on(table.externalId),
  index("messages_lead_idx").on(table.leadId, table.createdAt),
]);

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  status: text("status", { enum: ["pending", "running", "completed", "retry", "dead_letter", "cancelled"] }).notNull().default("pending"),
  payloadJson: text("payload_json").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  runAt: integer("run_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
  lockedBy: text("locked_by"),
  lastError: text("last_error"),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [
  uniqueIndex("jobs_dedupe_unique").on(table.dedupeKey),
  index("jobs_ready_idx").on(table.status, table.runAt),
]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  source: text("source").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  ...timestamps,
}, (table) => [index("events_lead_idx").on(table.leadId, table.occurredAt)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason"),
  ...timestamps,
});

export const aiCalls = sqliteTable("ai_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  purpose: text("purpose").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  responseId: text("response_id"),
  ...timestamps,
}, (table) => [index("ai_calls_month_idx").on(table.createdAt)]);

export const experiments = sqliteTable("experiments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  funnel: text("funnel", { enum: ["client", "affiliate"] }).notNull(),
  variable: text("variable").notNull(),
  status: text("status", { enum: ["draft", "running", "paused", "completed"] }).notNull().default("draft"),
  controlShare: real("control_share").notNull().default(0.5),
  minSampleSize: integer("min_sample_size").notNull().default(30),
  hypothesis: text("hypothesis").notNull(),
  ...timestamps,
});

export const experimentVariants = sqliteTable("experiment_variants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentId: integer("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  content: text("content").notNull(),
  weight: real("weight").notNull(),
  isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const experimentAssignments = sqliteTable("experiment_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentId: integer("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
  variantId: integer("variant_id").notNull().references(() => experimentVariants.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  convertedAt: integer("converted_at", { mode: "timestamp_ms" }),
  conversionEvent: text("conversion_event"),
  ...timestamps,
}, (table) => [uniqueIndex("assignment_unique").on(table.experimentId, table.leadId)]);

export const webhookEvents = sqliteTable("webhook_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  processingError: text("processing_error"),
  ...timestamps,
}, (table) => [uniqueIndex("webhook_external_unique").on(table.externalId)]);

export const exceptions = sqliteTable("exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  message: text("message").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  status: text("status", { enum: ["open", "resolved", "ignored"] }).notNull().default("open"),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  ...timestamps,
}, (table) => [index("exceptions_status_idx").on(table.status, table.createdAt)]);

export const browserArtifacts = sqliteTable("browser_artifacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  screenshotPath: text("screenshot_path"),
  accessibilitySnapshotPath: text("accessibility_snapshot_path"),
  pageUrl: text("page_url"),
  consoleErrorsJson: text("console_errors_json").notNull().default("[]"),
  networkErrorsJson: text("network_errors_json").notNull().default("[]"),
  ...timestamps,
});
