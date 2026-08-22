CREATE TABLE `surge_profile_storage_health_daily` (
  `day` text NOT NULL CHECK (`day` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `status` text NOT NULL CHECK (`status` IN ('save_failed', 'load_failed', 'merge_recovered')),
  `event_count` integer DEFAULT 0 NOT NULL CHECK (`event_count` >= 0),
  `updated_at` integer NOT NULL CHECK (`updated_at` >= 0),
  PRIMARY KEY (`day`, `status`)
);
--> statement-breakpoint

CREATE INDEX `surge_profile_storage_health_daily_updated_idx`
  ON `surge_profile_storage_health_daily` (`updated_at`);
