import type { SurgeConversationQualityEvent } from "./energy-assistant-quality.ts";

export function createSurgeConversationQualityRecorder(database: D1Database) {
  return async (event: SurgeConversationQualityEvent) => {
    await database.prepare(`
      INSERT INTO surge_conversation_quality_daily (
        day, audience, turn_intent, answer_source, answer_status, total_count,
        correction_expected_count, correction_pass_count,
        topic_switch_expected_count, topic_switch_pass_count,
        privacy_pass_count, follow_up_pass_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (day, audience, turn_intent, answer_source, answer_status)
      DO UPDATE SET
        total_count = total_count + 1,
        correction_expected_count = correction_expected_count + excluded.correction_expected_count,
        correction_pass_count = correction_pass_count + excluded.correction_pass_count,
        topic_switch_expected_count = topic_switch_expected_count + excluded.topic_switch_expected_count,
        topic_switch_pass_count = topic_switch_pass_count + excluded.topic_switch_pass_count,
        privacy_pass_count = privacy_pass_count + excluded.privacy_pass_count,
        follow_up_pass_count = follow_up_pass_count + excluded.follow_up_pass_count,
        updated_at = excluded.updated_at
    `).bind(
      event.day,
      event.audience,
      event.turnIntent,
      event.answerSource,
      event.answerStatus,
      Number(event.correctionExpected),
      Number(event.correctionExpected && event.correctionPassed),
      Number(event.topicSwitchExpected),
      Number(event.topicSwitchExpected && event.topicSwitchPassed),
      Number(event.privacyPassed),
      Number(event.followUpPassed),
      Date.now(),
    ).run();
  };
}
