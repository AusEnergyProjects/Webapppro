PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trade_team_member_credentials` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_uid` text NOT NULL,
  `team_member_id` text NOT NULL,
  `credential_type` text NOT NULL CHECK (`credential_type` IN ('licence', 'registration', 'training', 'accreditation', 'insurance', 'other')),
  `name` text NOT NULL,
  `credential_number` text NOT NULL DEFAULT '',
  `issuer` text NOT NULL DEFAULT '',
  `jurisdiction` text NOT NULL DEFAULT '' CHECK (`jurisdiction` IN ('', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NATIONAL')),
  `expires_at` text NOT NULL DEFAULT '' CHECK (`expires_at` = '' OR (date(`expires_at`) = `expires_at` AND length(`expires_at`) = 10)),
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'expired', 'suspended', 'archived')),
  `file_id` text NOT NULL DEFAULT '',
  `created_at` text NOT NULL CHECK (datetime(`created_at`) IS NOT NULL),
  `updated_at` text NOT NULL CHECK (datetime(`updated_at`) IS NOT NULL),
  `rental_gate` text DEFAULT '' NOT NULL CHECK (`rental_gate` IN ('', 'licensed_electrician', 'licensed_gasfitter', 'licensed_plumber', 'registered_plumber', 'refrigerant_handler', 'suitably_qualified_smoke_alarm_worker', 'sres_installer_accreditation', 'sres_designer_accreditation')),
  CHECK (`rental_gate` NOT IN ('sres_installer_accreditation', 'sres_designer_accreditation') OR (`credential_type` = 'accreditation' AND `jurisdiction` = 'NATIONAL')),
  CHECK ((`rental_gate` <> 'licensed_plumber' OR `credential_type` = 'licence')
    AND (`rental_gate` <> 'registered_plumber' OR `credential_type` = 'registration')
    AND (`rental_gate` <> 'refrigerant_handler' OR `credential_type` = 'licence')),
  FOREIGN KEY (`team_member_id`) REFERENCES `trade_team_members`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT
);--> statement-breakpoint
INSERT INTO `__new_trade_team_member_credentials`
  (`id`, `owner_uid`, `team_member_id`, `credential_type`, `name`, `credential_number`, `issuer`, `jurisdiction`, `expires_at`, `status`, `file_id`, `created_at`, `updated_at`, `rental_gate`)
SELECT `id`, `owner_uid`, `team_member_id`, `credential_type`, `name`, `credential_number`, `issuer`, `jurisdiction`, `expires_at`, `status`, `file_id`, `created_at`, `updated_at`, `rental_gate`
FROM `trade_team_member_credentials`;--> statement-breakpoint
DROP TABLE `trade_team_member_credentials`;--> statement-breakpoint
ALTER TABLE `__new_trade_team_member_credentials` RENAME TO `trade_team_member_credentials`;--> statement-breakpoint
CREATE INDEX `trade_team_member_credentials_member_idx`
  ON `trade_team_member_credentials` (`owner_uid`, `team_member_id`, `status`, `expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_team_member_credentials_file_idx`
  ON `trade_team_member_credentials` (`file_id`) WHERE `file_id` <> '';--> statement-breakpoint
PRAGMA foreign_keys=ON;
