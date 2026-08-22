CREATE TABLE `surge_conversation_quality_release_daily` (
  `day` text PRIMARY KEY NOT NULL CHECK (`day` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `correction_pass_rate` real NOT NULL CHECK (`correction_pass_rate` BETWEEN 0 AND 1),
  `topic_switch_pass_rate` real NOT NULL CHECK (`topic_switch_pass_rate` BETWEEN 0 AND 1),
  `privacy_pass_rate` real NOT NULL CHECK (`privacy_pass_rate` BETWEEN 0 AND 1),
  `follow_up_pass_rate` real NOT NULL CHECK (`follow_up_pass_rate` BETWEEN 0 AND 1),
  `source_status_pass_rate` real NOT NULL CHECK (`source_status_pass_rate` BETWEEN 0 AND 1),
  `release_ready` integer NOT NULL CHECK (`release_ready` IN (0, 1)),
  `evaluated_case_count` integer NOT NULL CHECK (`evaluated_case_count` >= 0),
  `updated_at` integer NOT NULL CHECK (`updated_at` >= 0)
);
--> statement-breakpoint

CREATE INDEX `surge_conversation_quality_release_daily_updated_idx`
  ON `surge_conversation_quality_release_daily` (`updated_at`);
