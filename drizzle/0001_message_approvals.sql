CREATE TABLE `message_approvals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lead_id` integer NOT NULL REFERENCES `leads`(`id`) ON DELETE CASCADE,
  `channel` text NOT NULL CHECK (`channel` IN ('browser','api')),
  `purpose` text NOT NULL CHECK (`purpose` IN ('first_contact','reply','follow_up')),
  `recipient_handle` text NOT NULL,
  `recipient_scoped_id` text,
  `body` text NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending','approved','rejected','sending','sent','uncertain','simulated')),
  `version` integer DEFAULT 1 NOT NULL,
  `direct_history_checked` integer DEFAULT false NOT NULL,
  `source_key` text,
  `approved_at` integer,
  `sent_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_approvals_source_unique` ON `message_approvals` (`source_key`);
--> statement-breakpoint
CREATE INDEX `message_approvals_status_idx` ON `message_approvals` (`status`,`created_at`);
