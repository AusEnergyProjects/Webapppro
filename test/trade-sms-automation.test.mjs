import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SMS_AUTOMATION_RULES, parseSmsAutomationRules, renderSmsAutomation, smsAutomationDueAt, smsAutomationPreview } from "../src/lib/trade-sms-automation.ts";

const rules = () => structuredClone(DEFAULT_SMS_AUTOMATION_RULES);
test("SMS automations default off with independent reminder and week-after rules", () => {
  const result = parseSmsAutomationRules(rules());
  assert.equal(result.length, 3); assert.ok(result.every(rule => !rule.enabled));
  assert.deepEqual(result.map(rule => rule.delayHours), [24, 168, 168]);
});
test("rule validation rejects duplicates, implicit enablement, invalid timings and inherited fields", () => {
  for (const change of [{ enabled: "true" }, { delayHours: 0 }, { delayHours: 1009 }, { delayHours: 1.5 }, { body: "{constructor}" }, { body: "{review_url}" }, { body: "x".repeat(481) }]) {
    const value = rules(); Object.assign(value[0], change); assert.throws(() => parseSmsAutomationRules(value));
  }
  assert.throws(() => parseSmsAutomationRules([rules()[0], rules()[0], rules()[2]]));
});
test("review automation requires an HTTPS review link inserted into the enabled message", () => {
  const value = rules(); value[2].enabled = true;
  assert.throws(() => parseSmsAutomationRules(value), /REVIEW_URL_REQUIRED/);
  value[2].reviewUrl = "javascript:alert(1)"; assert.throws(() => parseSmsAutomationRules(value), /REVIEW_URL_INVALID/);
  value[2].reviewUrl = "https://name:secret@example.test/"; assert.throws(() => parseSmsAutomationRules(value), /REVIEW_URL_INVALID/);
  value[2].reviewUrl = "https://example.test/reviews";
  assert.equal(parseSmsAutomationRules(value)[2].reviewUrl, value[2].reviewUrl);
  value[2].body = "Thanks for your business."; assert.throws(() => parseSmsAutomationRules(value), /REVIEW_URL_REQUIRED/);
});
test("rendering uses only own supported fields and detects expanded message overflow", () => {
  const rule = { ...rules()[0], body: "Hi {customer_first_name}: {job_title}" };
  const inherited = Object.create({ customer_first_name: "Hidden" }); inherited.job_title = "Work";
  assert.deepEqual(renderSmsAutomation(rule, inherited).missing, ["Customer first name"]);
  assert.ok(renderSmsAutomation(rule, { customer_first_name: "Alex", job_title: "x".repeat(480) }).missing.length);
});
test("appointment due time resolves DST transition, rejects nonexistent time, and supports independent before/after", () => {
  const starts = "2026-10-04T09:00";
  assert.equal(new Date(smsAutomationDueAt("appointment_reminder", starts, "Australia/Sydney", 24)).toISOString(), "2026-10-02T22:00:00.000Z");
  assert.equal(new Date(smsAutomationDueAt("appointment_follow_up", starts, "Australia/Sydney", 168)).toISOString(), "2026-10-10T22:00:00.000Z");
  assert.ok(Number.isNaN(smsAutomationDueAt("appointment_reminder", "2026-10-04T02:30", "Australia/Sydney", 24)));
});
test("preview costs every segment including business identity, STOP and job reference", () => {
  const preview = smsAutomationPreview({ ...rules()[0], body: "a".repeat(150) });
  assert.equal(preview.segments, 2); assert.equal(preview.costMicro, 198_000);
  assert.match(preview.formattedBody, /Your business: /); assert.match(preview.formattedBody, /Reply STOP/); assert.match(preview.formattedBody, /Job JOB-1042/);
  assert.doesNotThrow(() => smsAutomationPreview({ ...rules()[0], body: "" }));
});
