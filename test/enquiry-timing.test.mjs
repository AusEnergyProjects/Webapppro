import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { normalizeEnquiryTiming, enquiryDeadlines, enquiryCompletionLabel } from "../src/lib/enquiry-timing.mjs";
import { publicPlanSubmissionFingerprint } from "../src/lib/lead-envelope.mjs";

const now = Date.parse("2026-10-08T00:00:00Z");
test("legacy enquiries keep the existing 30 day window and flexible completion", () => {
  const parsed = normalizeEnquiryTiming({}, now);
  assert.equal(parsed.ok, true);
  assert.deepEqual(enquiryDeadlines(parsed.value, new Date(now)), { expiresAt: "2026-11-07T00:00:00.000Z", requestedWorkBy: "" });
});
test("customer quote window and work completion deadline are independent", () => {
  const parsed = normalizeEnquiryTiming({ quoteWindowValue: 7, quoteWindowUnit: "days", requestedCompletion: "three-months" }, now);
  assert.equal(parsed.ok, true);
  assert.deepEqual(enquiryDeadlines(parsed.value, new Date(now)), { expiresAt: "2026-10-15T00:00:00.000Z", requestedWorkBy: "2027-01-08" });
  assert.equal(enquiryCompletionLabel("2027-01-08"), "By 8 Jan 2027");
});
test("calendar month windows clamp month ends without spilling into another month", () => {
  const timing = { quoteWindowValue: 1, quoteWindowUnit: "months", requestedCompletion: "one-month" };
  assert.deepEqual(enquiryDeadlines(timing, "2027-01-31T12:45:00Z"), { expiresAt: "2027-02-28T12:45:00.000Z", requestedWorkBy: "2027-02-28" });
  assert.equal(enquiryDeadlines(timing, "2028-01-31T12:45:00Z").requestedWorkBy, "2028-02-29");
});
test("Australian calendar dates and daylight saving stay consistent around UTC midnight", () => {
  const timing = { quoteWindowValue: 1, quoteWindowUnit: "months", requestedCompletion: "one-month" };
  assert.deepEqual(enquiryDeadlines(timing, "2027-01-30T13:30:00Z"), { expiresAt: "2027-02-27T13:30:00.000Z", requestedWorkBy: "2027-02-28" });
  assert.deepEqual(enquiryDeadlines(timing, "2027-04-02T13:30:00Z"), { expiresAt: "2027-05-02T14:30:00.000Z", requestedWorkBy: "2027-05-03" });
  assert.equal(normalizeEnquiryTiming({ requestedCompletion: "date", requestedCompletionDate: "2026-10-07" }, Date.parse("2026-10-07T13:30:00Z")).ok, false);
});
test("invalid, expired, impossible and unbounded customer timing is rejected", () => {
  for (const input of [
    { quoteWindowValue: 0 }, { quoteWindowValue: -1 }, { quoteWindowValue: "7" }, { quoteWindowValue: 1.5 },
    { quoteWindowValue: 366 }, { quoteWindowValue: 13, quoteWindowUnit: "months" }, { quoteWindowUnit: "years" },
    { requestedCompletion: "unknown" }, { requestedCompletion: "date", requestedCompletionDate: "2026-02-30" },
    { requestedCompletion: "date", requestedCompletionDate: "2026-10-07" }, { requestedCompletion: "date" },
  ]) assert.equal(normalizeEnquiryTiming(input, now).ok, false, JSON.stringify(input));
  assert.equal(normalizeEnquiryTiming({ requestedCompletion: "date", requestedCompletionDate: "2026-12-12" }, now).value.requestedCompletionDate, "2026-12-12");
});
test("changing quote windows, completion or sector creates a different request fingerprint", () => {
  const original = publicPlanSubmissionFingerprint({ enquiry: "quick-upgrade-options" });
  for (const changes of [{ quoteWindowValue: 7 }, { quoteWindowUnit: "months" }, { requestedCompletion: "one-month" }, { requestedCompletionDate: "2026-12-12" }, { customerSector: "business" }]) {
    assert.notEqual(publicPlanSubmissionFingerprint({ enquiry: "quick-upgrade-options", ...changes }), original);
  }
});
test("additive migration preserves legacy enquiry expiry and marks legacy sector unclassified", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE trade_opportunities(id TEXT, expires_at TEXT); INSERT INTO trade_opportunities VALUES('legacy','2026-11-01T00:00:00Z')");
  db.exec(readFileSync(new URL("../drizzle/0257_enquiry_windows.sql", import.meta.url), "utf8"));
  assert.deepEqual({ ...db.prepare("SELECT * FROM trade_opportunities").get() }, { id: "legacy", expires_at: "2026-11-01T00:00:00Z", quote_window_value: 30, quote_window_unit: "days", requested_completion: "flexible", requested_work_by: "", customer_sector: "unclassified" });
  assert.throws(() => db.prepare("UPDATE trade_opportunities SET customer_sector='guess'").run());
  db.close();
});
