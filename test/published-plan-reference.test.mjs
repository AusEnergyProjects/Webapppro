import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublishedPlanReference, annualPlanDifference } from "../src/lib/published-plan-reference.ts";

const plan = (id, key = id, rest = {}) => ({ key, id, name: "Published offer", brand: "Retailer", annualCost: 1800, rateDescription: "Published prices", ...rest });
const records = [plan("1ST787440MR@VEC"), plan("AGL123MR1@EME"), plan("AGL123MR2@EME")];

test("blank ID is optional, while links and overlong codes cannot be treated as plan IDs", () => {
  assert.equal(resolvePublishedPlanReference("  ", records).status, "empty");
  for (const value of ["https://example.com/plan", "<script>", "A".repeat(129)]) {
    assert.equal(resolvePublishedPlanReference(value, records).status, "invalid");
  }
});

test("external Offer ID and full official namespace identify the same complete published record", () => {
  for (const value of ["1ST787440MR", " 1st787440mr@vec ", "1ST 787440 MR"]) {
    const match = resolvePublishedPlanReference(value, records);
    assert.equal(match.status, "matched");
    assert.equal(match.plan, records[0]);
  }
});

test("version digits, namespaces and unknown opaque suffixes are never discarded or guessed", () => {
  for (const value of ["AGL123MR", "AGL123MR3", "1ST787440MR@EME", "787440", "Published offer"]) {
    assert.equal(resolvePublishedPlanReference(value, records).status, "missing");
  }
  const opaque = [plan("CUSTOM@VERSION1")];
  assert.equal(resolvePublishedPlanReference("CUSTOM", opaque).status, "missing");
  assert.equal(resolvePublishedPlanReference("CUSTOM@VERSION1", opaque).status, "matched");
  assert.equal(resolvePublishedPlanReference("AGL123MR2", records).plan.id, "AGL123MR2@EME");
});

test("opaque IDs and unknown suffixes preserve case and internal spacing exactly", () => {
  const opaque = [plan("CUSTOM@Version1"), plan("customer-plan")];
  assert.equal(resolvePublishedPlanReference(" CUSTOM@Version1 ", opaque).plan, opaque[0]);
  for (const value of ["CUSTOM@VERSION1", "custom@Version1", "customerplan", "CUSTOMER-PLAN", "customer -plan"]) {
    assert.equal(resolvePublishedPlanReference(value, opaque).status, "missing");
  }
});

test("duplicate public IDs require an explicit record choice, including collisions across retailers", () => {
  const choices = [plan("SAME@EME", "retailer-a|SAME@EME"), plan("SAME@VEC", "retailer-b|SAME@VEC")];
  assert.equal(resolvePublishedPlanReference("SAME", choices).status, "ambiguous");
  assert.equal(resolvePublishedPlanReference("SAME", choices, choices[1].key).plan, choices[1]);
  assert.equal(resolvePublishedPlanReference("SAME", choices, "old-unrelated-selection").status, "ambiguous");
  const fullCollision = [choices[0], plan("SAME@EME", "retailer-c|SAME@EME")];
  assert.equal(resolvePublishedPlanReference("SAME@EME", fullCollision).status, "ambiguous");
});

test("expired, future, invalid-date and unpriceable records cannot become the reference", () => {
  for (const rest of [
    { effectiveTo: "2000-01-01T00:00:00Z" },
    { effectiveFrom: "3000-01-01T00:00:00Z" },
    { effectiveFrom: "bad-date" },
    { effectiveTo: "bad-date" },
    { annualCost: NaN },
    { annualCost: Infinity },
  ]) {
    assert.equal(resolvePublishedPlanReference("PLAN", [plan("PLAN@VEC", "PLAN", rest)]).status, "missing");
  }
  assert.equal(resolvePublishedPlanReference("PLAN", [plan("PLAN@VEC", "PLAN", { effectiveFrom: "2000-01-01T00:00:00Z", effectiveTo: "3000-01-01T00:00:00Z" })]).status, "matched");
});

test("network or pricing changes that remove the reference never reuse the previous cost", () => {
  assert.equal(resolvePublishedPlanReference("1ST787440MR", records).plan.annualCost, 1800);
  assert.equal(resolvePublishedPlanReference("1ST787440MR", records.slice(1)).status, "missing");
  assert.equal(resolvePublishedPlanReference("1ST787440MR", [plan("1ST787440MR@VEC", "repriced", { annualCost: 2500 })]).plan.annualCost, 2500);
});

test("yearly differences retain cheaper, dearer and equal costs to the cent", () => {
  assert.equal(annualPlanDifference(1800, 1200.45), 599.55);
  assert.equal(annualPlanDifference(1800, 2200.12), -400.12);
  assert.equal(annualPlanDifference(1800, 1800), 0);
  assert.equal(annualPlanDifference(-100, -200), 100);
});
