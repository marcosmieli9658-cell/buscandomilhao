CREATE TABLE `system_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `globally_paused` integer DEFAULT false NOT NULL,
  `pause_reason` text,
  `browser_queue_paused` integer DEFAULT false NOT NULL,
  `browser_pause_reason` text,
  `consecutive_errors` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `system_settings` (`id`, `created_at`, `updated_at`) VALUES (1, unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
CREATE TABLE `leads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `funnel` text NOT NULL CHECK (`funnel` IN ('client','affiliate')),
  `instagram_handle` text NOT NULL,
  `instagram_scoped_id` text,
  `display_name` text,
  `bio` text,
  `category` text,
  `location` text,
  `source` text NOT NULL,
  `source_keyword` text,
  `score` integer DEFAULT 0 NOT NULL,
  `segment` text,
  `decision_maker_type` text DEFAULT 'unknown' NOT NULL CHECK (`decision_maker_type` IN ('store','employee','owner','decision_maker','unknown')),
  `pipeline_state` text DEFAULT 'discovered' NOT NULL,
  `channel_state` text DEFAULT 'browser_contact_pending' NOT NULL,
  `channel_owner` text DEFAULT 'browser' NOT NULL CHECK (`channel_owner` IN ('browser','api','human','none')),
  `do_not_contact` integer DEFAULT false NOT NULL,
  `do_not_contact_reason` text,
  `last_inbound_at` integer,
  `last_outbound_at` integer,
  `next_action_at` integer,
  `tags_json` text DEFAULT '[]' NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_funnel_handle_unique` ON `leads` (`funnel`,`instagram_handle`);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_scoped_id_unique` ON `leads` (`instagram_scoped_id`);
--> statement-breakpoint
CREATE INDEX `leads_pipeline_idx` ON `leads` (`funnel`,`pipeline_state`);
--> statement-breakpoint
CREATE INDEX `leads_next_action_idx` ON `leads` (`next_action_at`);
--> statement-breakpoint
CREATE TABLE `messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lead_id` integer NOT NULL,
  `external_id` text,
  `direction` text NOT NULL CHECK (`direction` IN ('inbound','outbound')),
  `channel` text NOT NULL CHECK (`channel` IN ('browser','api','human')),
  `body` text NOT NULL,
  `variant_id` integer,
  `delivery_state` text NOT NULL CHECK (`delivery_state` IN ('planned','dry_run','sent','delivered','failed','blocked')),
  `dedupe_key` text NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `sent_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_dedupe_unique` ON `messages` (`dedupe_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_external_unique` ON `messages` (`external_id`);
--> statement-breakpoint
CREATE INDEX `messages_lead_idx` ON `messages` (`lead_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `jobs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `payload_json` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 3 NOT NULL,
  `run_at` integer NOT NULL,
  `locked_at` integer,
  `locked_by` text,
  `last_error` text,
  `completed_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_unique` ON `jobs` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `jobs_ready_idx` ON `jobs` (`status`,`run_at`);
--> statement-breakpoint
CREATE TABLE `events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lead_id` integer,
  `type` text NOT NULL,
  `source` text NOT NULL,
  `payload_json` text DEFAULT '{}' NOT NULL,
  `occurred_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_lead_idx` ON `events` (`lead_id`,`occurred_at`);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lead_id` integer,
  `actor` text NOT NULL,
  `action` text NOT NULL,
  `before_json` text,
  `after_json` text,
  `reason` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `ai_calls` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lead_id` integer,
  `model` text NOT NULL,
  `purpose` text NOT NULL,
  `input_tokens` integer DEFAULT 0 NOT NULL,
  `output_tokens` integer DEFAULT 0 NOT NULL,
  `estimated_cost_usd` real DEFAULT 0 NOT NULL,
  `response_id` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_calls_month_idx` ON `ai_calls` (`created_at`);
--> statement-breakpoint
CREATE TABLE `experiments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `funnel` text NOT NULL,
  `variable` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `control_share` real DEFAULT 0.5 NOT NULL,
  `min_sample_size` integer DEFAULT 30 NOT NULL,
  `hypothesis` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experiment_variants` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `experiment_id` integer NOT NULL,
  `name` text NOT NULL,
  `content` text NOT NULL,
  `weight` real NOT NULL,
  `is_control` integer DEFAULT false NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `experiment_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `experiment_id` integer NOT NULL,
  `variant_id` integer NOT NULL,
  `lead_id` integer NOT NULL,
  `converted_at` integer,
  `conversion_event` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`variant_id`) REFERENCES `experiment_variants`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_unique` ON `experiment_assignments` (`experiment_id`,`lead_id`);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `external_id` text NOT NULL,
  `payload_json` text NOT NULL,
  `processed_at` integer,
  `processing_error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_external_unique` ON `webhook_events` (`external_id`);
--> statement-breakpoint
CREATE TABLE `exceptions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lead_id` integer,
  `job_id` integer,
  `code` text NOT NULL,
  `message` text NOT NULL,
  `details_json` text DEFAULT '{}' NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `resolved_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `exceptions_status_idx` ON `exceptions` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `browser_artifacts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` integer NOT NULL,
  `screenshot_path` text,
  `accessibility_snapshot_path` text,
  `page_url` text,
  `console_errors_json` text DEFAULT '[]' NOT NULL,
  `network_errors_json` text DEFAULT '[]' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
