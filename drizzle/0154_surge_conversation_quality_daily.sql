CREATE TABLE `surge_conversation_quality_daily` (
  `day` text NOT NULL CHECK (`day` GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  `audience` text NOT NULL CHECK (`audience` IN ('household', 'renter', 'strata', 'trade', 'assessor')),
  `turn_intent` text NOT NULL CHECK (`turn_intent` IN ('new_question', 'answer_to_follow_up', 'clarification', 'correction', 'topic_change', 'correction_and_topic_change')),
  `answer_source` text NOT NULL CHECK (`answer_source` IN ('deterministic', 'model')),
  `answer_status` text NOT NULL CHECK (`answer_status` IN ('answered', 'needs_context', 'source_review_required')),
  `total_count` integer DEFAULT 0 NOT NULL CHECK (`total_count` >= 0),
  `correction_expected_count` integer DEFAULT 0 NOT NULL CHECK (`correction_expected_count` >= 0),
  `correction_pass_count` integer DEFAULT 0 NOT NULL CHECK (`correction_pass_count` >= 0 AND `correction_pass_count` <= `correction_expected_count`),
  `topic_switch_expected_count` integer DEFAULT 0 NOT NULL CHECK (`topic_switch_expected_count` >= 0),
  `topic_switch_pass_count` integer DEFAULT 0 NOT NULL CHECK (`topic_switch_pass_count` >= 0 AND `topic_switch_pass_count` <= `topic_switch_expected_count`),
  `privacy_pass_count` integer DEFAULT 0 NOT NULL CHECK (`privacy_pass_count` >= 0 AND `privacy_pass_count` <= `total_count`),
  `follow_up_pass_count` integer DEFAULT 0 NOT NULL CHECK (`follow_up_pass_count` >= 0 AND `follow_up_pass_count` <= `total_count`),
  `updated_at` integer NOT NULL CHECK (`updated_at` >= 0),
  PRIMARY KEY (`day`, `audience`, `turn_intent`, `answer_source`, `answer_status`)
);
--> statement-breakpoint

CREATE INDEX `surge_conversation_quality_daily_updated_idx`
  ON `surge_conversation_quality_daily` (`updated_at`);
