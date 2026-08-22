import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfficialSourceReviewQueue,
  sourceMayAnswerCurrentFact,
} from "../src/lib/energy-assistant-source-review.ts";

function source(overrides = {}) {
  return {
    id: "source-a",
    title: "Official source",
    publisher: "Australian Government",
    url: "https://example.gov.au/source",
    topic: "insulation",
    audience: ["household"],
    jurisdiction: "Australia",
    effectiveFrom: null,
    effectiveTo: null,
    reviewedAt: "2026-08-01",
    reviewDue: "2026-08-30",
    licence: "official factual summary",
    reuseBasis: "official factual summary",
    volatilityClass: "volatile_program",
    storagePolicy: "local_factual_summary",
    official: true,
    summary: "Official source summary used only for deterministic review queue testing.",
    keywords: ["official", "source", "review", "queue", "testing"],
    ...overrides,
  };
}

test("changed and overdue sources enter the bounded review queue in priority order", () => {
  const queue = buildOfficialSourceReviewQueue([
    source({ id: "overdue", reviewDue: "2026-08-20" }),
    source({ id: "changed", reviewDue: "2026-10-20" }),
    source({ id: "future", reviewDue: "2026-12-20" }),
  ], "2026-08-22", ["changed"]);
  assert.deepEqual(queue.map(({ sourceId, reason }) => ({ sourceId, reason })), [
    { sourceId: "changed", reason: "change_detected" },
    { sourceId: "overdue", reason: "overdue" },
  ]);
});

test("volatile current facts fail closed after a detected change or missed review", () => {
  const current = source({ reviewDue: "2026-08-30" });
  assert.equal(sourceMayAnswerCurrentFact(current, "2026-08-22"), true);
  assert.equal(sourceMayAnswerCurrentFact(current, "2026-08-22", true), false);
  assert.equal(sourceMayAnswerCurrentFact(current, "2026-09-01"), false);
});
