import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { runApiHealthMonitor } from "../src/lib/api-health-monitor.mjs";
import { createOperationalRecorder } from "../src/lib/operational-events.mjs";

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

function createStateStore(initial = null) {
  let state = initial;
  return {
    async get() {
      return state;
    },
    async setJSON(_key, value) {
      state = structuredClone(value);
    },
    read() {
      return state;
    },
  };
}

function quietLogger() {
  return { info() {}, error() {} };
}

test("operational recorder emits bounded structured fields with a correlation ID", () => {
  const lines = [];
  const recorder = createOperationalRecorder({
    event: "api.test",
    now: (() => {
      const times = [100, 125];
      return () => times.shift();
    })(),
    createId: () => "request-1",
    logger: { info: (line) => lines.push(line), error: (line) => lines.push(line) },
  });

  const entry = recorder.record("success", 200, {
    planCount: 10,
    partial: false,
    ignoredObject: { email: "person@example.com" },
  });

  assert.equal(entry.requestId, "request-1");
  assert.equal(entry.durationMs, 25);
  assert.equal(entry.planCount, 10);
  assert.equal(entry.ignoredObject, undefined);
  assert.doesNotMatch(lines[0], /person@example\.com/);
});

test("first healthy monitor run records state without sending a noisy recovery alert", async () => {
  const store = createStateStore();
  const requests = [];
  const result = await runApiHealthMonitor({
    siteUrl: "https://example.test",
    leadProbeToken: "probe-secret",
    alertWebhookUrl: "https://alerts.example.test/hook",
    stateStore: store,
    logger: quietLogger(),
    now: () => 1_800_000_000_000,
    async fetchImpl(url, options) {
      requests.push({ url: String(url), options });
      if (String(url).includes("electricity-plans")) {
        return jsonResponse({
          plans: [{ id: "plan-1" }],
          source: { listSourcesSucceeded: 3, detailPlansSucceeded: 10, plansWithLastUpdated: 10, detailApiVersion: "3", partial: false },
        });
      }
      return jsonResponse({ ok: true, probeId: "probe-1" });
    },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.alert.attempted, false);
  assert.equal(requests.length, 2);
  assert.equal(store.read().status, "healthy");
  assert.equal(store.read().lastAlertAt, null);
});

test("failed plan check sends a privacy-safe alert and records the notification time", async () => {
  const store = createStateStore();
  const alertBodies = [];
  const result = await runApiHealthMonitor({
    siteUrl: "https://example.test",
    leadProbeToken: "probe-secret-value",
    alertWebhookUrl: "https://alerts.example.test/hook",
    stateStore: store,
    logger: quietLogger(),
    now: () => 1_800_000_000_000,
    async fetchImpl(url, options) {
      if (String(url).includes("electricity-plans")) return jsonResponse({ error: "unavailable" }, 502);
      if (String(url).includes("lead-webhook-probe")) return jsonResponse({ ok: true });
      alertBodies.push(options.body);
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.status, "unhealthy");
  assert.equal(result.alert.sent, true);
  assert.equal(store.read().lastAlertAt, 1_800_000_000_000);
  assert.equal(alertBodies.length, 1);
  assert.match(alertBodies[0], /ops\.health_alert/);
  assert.doesNotMatch(alertBodies[0], /probe-secret-value|email|phone|postcode|annualKwh|NMI/i);
});

test("repeated failures are suppressed for six hours and recovery is announced", async () => {
  const recentFailure = createStateStore({
    status: "unhealthy",
    checkedAt: 1_800_000_000_000,
    lastAlertAt: 1_800_000_000_000,
  });
  let alertCalls = 0;
  const failed = await runApiHealthMonitor({
    siteUrl: "https://example.test",
    leadProbeToken: "probe-secret",
    alertWebhookUrl: "https://alerts.example.test/hook",
    stateStore: recentFailure,
    logger: quietLogger(),
    now: () => 1_800_000_000_000 + 60 * 60 * 1000,
    async fetchImpl(url) {
      if (String(url).includes("electricity-plans")) return jsonResponse({}, 502);
      if (String(url).includes("lead-webhook-probe")) return jsonResponse({ ok: true });
      alertCalls += 1;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(failed.alert.reason, "not_due");
  assert.equal(alertCalls, 0);

  const recovered = await runApiHealthMonitor({
    siteUrl: "https://example.test",
    leadProbeToken: "probe-secret",
    alertWebhookUrl: "https://alerts.example.test/hook",
    stateStore: recentFailure,
    logger: quietLogger(),
    now: () => 1_800_000_000_000 + 2 * 60 * 60 * 1000,
    async fetchImpl(url) {
      if (String(url).includes("electricity-plans")) {
        return jsonResponse({ plans: [{}], source: { listSourcesSucceeded: 1, detailPlansSucceeded: 1, plansWithLastUpdated: 1, detailApiVersion: "3" } });
      }
      if (String(url).includes("lead-webhook-probe")) return jsonResponse({ ok: true });
      alertCalls += 1;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(recovered.status, "healthy");
  assert.equal(recovered.alert.sent, true);
  assert.equal(alertCalls, 1);
});

test("failed alert delivery remains pending for the next scheduled run", async () => {
  const store = createStateStore({
    status: "unhealthy",
    checkedAt: 1_800_000_000_000,
    lastAlertAt: 1_800_000_000_000,
  });
  const result = await runApiHealthMonitor({
    siteUrl: "https://example.test",
    leadProbeToken: "probe-secret",
    alertWebhookUrl: "https://alerts.example.test/hook",
    stateStore: store,
    logger: quietLogger(),
    now: () => 1_800_000_000_000 + 60 * 60 * 1000,
    async fetchImpl(url) {
      if (String(url).includes("electricity-plans")) {
        return jsonResponse({ plans: [{}], source: { listSourcesSucceeded: 1, detailPlansSucceeded: 1, plansWithLastUpdated: 1, detailApiVersion: "3" } });
      }
      if (String(url).includes("lead-webhook-probe")) return jsonResponse({ ok: true });
      return jsonResponse({ ok: false }, 500);
    },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.alert.sent, false);
  assert.equal(store.read().status, "unhealthy");
});

test("scheduled function is hourly and uses the dedicated operations store", () => {
  const scheduled = fs.readFileSync(
    path.join(process.cwd(), "netlify/functions/api-health-monitor.mts"),
    "utf8",
  );
  assert.match(scheduled, /schedule: "@hourly"/);
  assert.match(scheduled, /name: "aea-operations", consistency: "strong"/);
  assert.match(scheduled, /AEA_OPS_ALERT_WEBHOOK_URL/);
  assert.match(scheduled, /AEA_LEAD_WEBHOOK_TEST_TOKEN/);
});
