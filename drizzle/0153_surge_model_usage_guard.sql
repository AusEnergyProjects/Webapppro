CREATE TABLE `surge_model_usage_state` (
  `scope_hash` text PRIMARY KEY NOT NULL CHECK (
    length(`scope_hash`) = 64
    AND `scope_hash` = lower(`scope_hash`)
    AND `scope_hash` NOT GLOB '*[^0-9a-f]*'
  ),
  `state_json` text NOT NULL CHECK (
    json_valid(`state_json`)
    AND json_type(`state_json`) = 'object'
    AND length(`state_json`) BETWEEN 2 AND 131072
  ),
  `version` integer DEFAULT 0 NOT NULL CHECK (`version` >= 0),
  `updated_at` integer NOT NULL CHECK (`updated_at` >= 0)
);
--> statement-breakpoint

CREATE INDEX `surge_model_usage_state_updated_idx`
  ON `surge_model_usage_state` (`updated_at`);
