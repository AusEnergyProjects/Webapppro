CREATE TABLE `surge_conversation_quality_daily_next` (
  `day` text NOT NULL CHECK (`day` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `audience` text NOT NULL CHECK (`audience` IN ('household', 'renter', 'strata', 'trade', 'assessor')),
  `turn_intent` text NOT NULL CHECK (`turn_intent` IN ('new_question', 'answer_to_follow_up', 'clarification', 'correction', 'topic_change', 'correction_and_topic_change')),
  `answer_source` text NOT NULL CHECK (`answer_source` IN ('deterministic', 'grounded', 'model')),
  `answer_status` text NOT NULL CHECK (`answer_status` IN ('answered', 'needs_context', 'source_review_required')),
  `corpus_sha256` text DEFAULT '' NOT NULL CHECK (length(`corpus_sha256`) <= 160),
  `prompt_sha256` text DEFAULT '' NOT NULL CHECK (length(`prompt_sha256`) <= 160),
  `source_sha256` text DEFAULT '' NOT NULL CHECK (length(`source_sha256`) <= 160),
  `app_version` text DEFAULT '' NOT NULL CHECK (length(`app_version`) <= 160),
  `git_sha` text DEFAULT '' NOT NULL CHECK (length(`git_sha`) <= 160),
  `deployment_id` text DEFAULT '' NOT NULL CHECK (length(`deployment_id`) <= 160),
  `requested_model` text DEFAULT '' NOT NULL CHECK (length(`requested_model`) <= 160),
  `provider_model` text DEFAULT '' NOT NULL CHECK (length(`provider_model`) <= 160),
  `total_count` integer DEFAULT 0 NOT NULL CHECK (`total_count` >= 0),
  `correction_expected_count` integer DEFAULT 0 NOT NULL CHECK (`correction_expected_count` >= 0),
  `correction_pass_count` integer DEFAULT 0 NOT NULL CHECK (`correction_pass_count` >= 0 AND `correction_pass_count` <= `correction_expected_count`),
  `topic_switch_expected_count` integer DEFAULT 0 NOT NULL CHECK (`topic_switch_expected_count` >= 0),
  `topic_switch_pass_count` integer DEFAULT 0 NOT NULL CHECK (`topic_switch_pass_count` >= 0 AND `topic_switch_pass_count` <= `topic_switch_expected_count`),
  `privacy_pass_count` integer DEFAULT 0 NOT NULL CHECK (`privacy_pass_count` >= 0 AND `privacy_pass_count` <= `total_count`),
  `follow_up_pass_count` integer DEFAULT 0 NOT NULL CHECK (`follow_up_pass_count` >= 0 AND `follow_up_pass_count` <= `total_count`),
  `latency_total_ms` integer DEFAULT 0 NOT NULL CHECK (`latency_total_ms` >= 0),
  `latency_samples` integer DEFAULT 0 NOT NULL CHECK (`latency_samples` >= 0 AND `latency_samples` <= `total_count`),
  `updated_at` integer NOT NULL CHECK (`updated_at` >= 0),
  PRIMARY KEY (
    `day`, `audience`, `turn_intent`, `answer_source`, `answer_status`,
    `corpus_sha256`, `prompt_sha256`, `source_sha256`, `app_version`,
    `git_sha`, `deployment_id`, `requested_model`, `provider_model`
  )
);
--> statement-breakpoint

INSERT INTO `surge_conversation_quality_daily_next` (
  `day`, `audience`, `turn_intent`, `answer_source`, `answer_status`,
  `total_count`, `correction_expected_count`, `correction_pass_count`,
  `topic_switch_expected_count`, `topic_switch_pass_count`,
  `privacy_pass_count`, `follow_up_pass_count`, `updated_at`
)
SELECT
  `day`, `audience`, `turn_intent`, `answer_source`, `answer_status`,
  `total_count`, `correction_expected_count`, `correction_pass_count`,
  `topic_switch_expected_count`, `topic_switch_pass_count`,
  `privacy_pass_count`, `follow_up_pass_count`, `updated_at`
FROM `surge_conversation_quality_daily`;
--> statement-breakpoint

DROP TABLE `surge_conversation_quality_daily`;
--> statement-breakpoint

ALTER TABLE `surge_conversation_quality_daily_next`
  RENAME TO `surge_conversation_quality_daily`;
--> statement-breakpoint

CREATE INDEX `surge_conversation_quality_daily_updated_idx`
  ON `surge_conversation_quality_daily` (`updated_at`);
