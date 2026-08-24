import { createHash } from "node:crypto";
import { ENERGY_ASSISTANT_KNOWLEDGE } from "../src/data/energy-assistant-knowledge.ts";
import { ENERGY_ASSISTANT_OFFICIAL_SOURCE_APPROVALS } from "../src/data/energy-assistant-official-source-approvals.ts";
import {
  canonicalOfficialSourceEvidence,
  sourceMayAnswerCurrentFact,
} from "../src/lib/energy-assistant-source-review.ts";

const asOf = process.env.SURGE_SOURCE_APPROVAL_AS_OF || new Date().toISOString().slice(0, 10);
const volatileSources = ENERGY_ASSISTANT_KNOWLEDGE.filter(
  (source) => source.official && source.volatilityClass === "volatile_program",
);
const approvals = new Map(ENERGY_ASSISTANT_OFFICIAL_SOURCE_APPROVALS.map((approval) => [approval.sourceId, approval]));
const failures = [];

for (const source of volatileSources) {
  const hash = createHash("sha256").update(canonicalOfficialSourceEvidence(source)).digest("hex");
  const approval = approvals.get(source.id);
  if (!approval) {
    failures.push(`${source.id}: missing approval for ${hash}`);
    continue;
  }
  if (!approval.approvedBy.trim() || approval.approvedBy === "pending") {
    failures.push(`${source.id}: independent reviewer is missing`);
  }
  if (approval.approvedOn < source.reviewedAt) {
    failures.push(`${source.id}: approval predates the reviewed evidence`);
  }
  if (!sourceMayAnswerCurrentFact(source, asOf, false, approval, hash)) {
    failures.push(`${source.id}: hash, approval or review window is not current`);
  }
}

for (const sourceId of approvals.keys()) {
  if (!volatileSources.some((source) => source.id === sourceId)) {
    failures.push(`${sourceId}: orphan approval without a volatile official source`);
  }
}

if (failures.length) {
  throw new Error(`Official source approval audit failed:\n${failures.join("\n")}`);
}

console.log(`Official source approval audit passed: ${volatileSources.length} volatile sources approved as of ${asOf}.`);
