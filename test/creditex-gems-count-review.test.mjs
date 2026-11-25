import assert from "node:assert/strict";
import test from "node:test";
import { gemsCountReview, gemsReviewWasPublished } from "../src/lib/creditex-gems-count-review.ts";

function status(message, overrides = {}) {
  return {
    registryCode: "gems-products", status: "stale", recordCount: 50,
    lastAttempt: { status: "failed", checkedAt: "2026-11-25T04:01:00Z", message },
    ...overrides,
  };
}
const failure = pairs => `Official source counts decreased (${pairs}). Exact reviewed approval is required.`;

test("review supplies every observed GEMS pair and ignores other registries", () => {
  const registry = status(failure("gems-air-conditioners:33->31, gems-electric-motors:17->15"));
  const review = gemsCountReview([{ ...registry, registryCode: "different" }, registry]);
  assert.deepEqual(review.sources, [
    { sourceKey: "gems-air-conditioners", previousRecordCount: 33, acceptedRecordCount: 31 },
    { sourceKey: "gems-electric-motors", previousRecordCount: 17, acceptedRecordCount: 15 },
  ]);
  assert.equal(review.attemptAt, registry.lastAttempt.checkedAt);
  assert.equal(gemsCountReview([]), null);
});

test("partial messages, unrelated failures, duplicates and invalid counts cannot be approved", () => {
  for (const message of [
    failure("gems-chillers:33->31").slice(0, -1),
    failure("gems-chillers:33->31, another-source:10->2"),
    failure("gems-chillers:33->31, gems-chillers:33->31"),
    failure("gems-chillers:4->5"), failure("gems-chillers:4->0"),
    failure("gems-chillers:9999999999999999999999->2"),
    "The last controlled registry refresh did not complete.",
  ]) assert.deepEqual(gemsCountReview([status(message)]).sources, []);
  const registry = status(failure("gems-chillers:33->31"));
  for (const attempt of [{...registry.lastAttempt, checkedAt: null}, {...registry.lastAttempt, status: "success"}]) {
    assert.deepEqual(gemsCountReview([{...registry, lastAttempt: attempt}]).sources, []);
  }
});

test("a review succeeds only when the returned reviewed snapshot is current with its published count", () => {
  const result = {registryCode: "gems-products", snapshotId: "registered-snapshot", recordCount: 31, reviewedCountDecrease: true};
  const registry = { ...result, status: "current" };
  const response = {ok: true, results: [result], registries: [registry]};
  assert.equal(gemsReviewWasPublished(response).recordCount, 31);
  for (const changed of [{snapshotId: "previous"}, {status: "stale"}, {recordCount: 33}]) {
    assert.equal(gemsReviewWasPublished({...response, registries: [{...registry, ...changed}]}), null);
  }
  assert.equal(gemsReviewWasPublished({...response, results: [{...result, reviewedCountDecrease: false}]}), null);
  assert.equal(gemsReviewWasPublished({ok: true, queued: true}), null);
});
