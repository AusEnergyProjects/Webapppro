import { SURGE_CONVERSATION_REVIEWED_RESULTS } from "../src/data/surge-conversation-reviewed-results.ts";
import { evaluateSurgeConversationReleaseGate } from "../src/lib/surge-conversation-quality-gate.ts";

const report = evaluateSurgeConversationReleaseGate(SURGE_CONVERSATION_REVIEWED_RESULTS);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) {
  throw new Error(`Surge conversation quality gate failed: ${[...report.coverageErrors, ...report.failedDimensions].join(", ")}`);
}
