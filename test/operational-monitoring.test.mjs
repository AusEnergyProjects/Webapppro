import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { runApiHealthMonitor } from "../src/lib/api-health-monitor.mjs";
import {
  CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES,
} from "../src/lib/creditex-official-product-registry.ts";
import { createOperationalRecorder } from "../src/lib/operational-events.mjs";

const leadRoute = fs.readFileSync(
  new URL("../src/app/api/leads/route.js", import.meta.url),
  "utf8",
);
const monitorSource = fs.readFileSync(
  new URL("../src/lib/api-health-monitor.mjs", import.meta.url),
  "utf8",
);

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

test("legacy non-plan lead delivery retains one bounded downstream timeout", () => {
  assert.match(leadRoute, /LEAD_PROCESSOR_TIMEOUT_MS/);
  assert.doesNotMatch(
    leadRoute,
    /setTimeout\(\(\) => controller\.abort\(\), 10000\)/,
  );
});

test("the lead health check has a bounded allowance beyond the protected endpoint deadline", () => {
  assert.match(monitorSource, /const LEAD_CHECK_TIMEOUT_MS = 5_000/);
  assert.match(
    monitorSource,
    /new URL\("\/api\/internal\/lead-webhook-probe", siteUrl\)[\s\S]*LEAD_CHECK_TIMEOUT_MS/,
  );
  assert.match(
    monitorSource,
    /fetchWithTimeout\(fetchImpl, url, options, timeoutMs = CHECK_TIMEOUT_MS\)/,
  );
});

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

function healthyCheckResponse(url) {
  const value = String(url);
  if (value.includes("/api/health")) return jsonResponse({ ok: true, service: "aea-energy" });
  if (value.includes("/api/creditex/official-products")) {
    return jsonResponse({
      ok: true,
      registries: CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES.map((registryCode) => ({
        registryCode,
        status: "current",
        lastCheckedAt: "2027-01-15T00:00:00.000Z",
        lastAttempt: {
          status: "unchanged",
          checkedAt: "2027-01-15T00:00:00.000Z",
          message: "",
        },
        readiness: {
          calculatorReady: true,
          refreshReady: true,
          blocker: null,
        },
      })),
    });
  }
  if (value.includes("electricity-plans") || value.includes("gas-plans")) {
    return jsonResponse({
      plans: [{ id: "plan-1" }],
      source: { listSourcesSucceeded: 3, detailPlansSucceeded: 10, plansWithLastUpdated: 10, detailApiVersion: "3", partial: false },
    });
  }
  if (value.includes("lead-webhook-probe")) {
    return jsonResponse({
      ok: true,
      probeId: "probe-1",
      mode: "durable_outbox_readiness",
      schedulerExecutionVerified: false,
      providerDeliveryVerified: false,
    });
  }
  return null;
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
      return healthyCheckResponse(url);
    },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.alert.attempted, false);
  assert.equal(requests.length, 5);
  assert.deepEqual(result.checks.map((check) => check.name), [
    "site_runtime",
    "official_product_registries",
    "electricity_plans",
    "gas_plans",
    "lead_delivery",
  ]);
  assert.equal(store.read().status, "healthy");
  assert.equal(store.read().lastAlertAt, null);
});

test("monitor alerts when a required official product registry is stale or its latest refresh failed", async () => {
  const scenarios = [
    {
      name: "stale",
      registry: {
        registryCode: "veu-approved-products",
        status: "stale",
        lastAttempt: { status: "failed", checkedAt: "2027-01-15T00:00:00.000Z" },
      },
      expectedField: "staleRegistryCodes",
    },
    {
      name: "degraded",
      registry: {
        registryCode: "veu-approved-products",
        status: "current",
        lastAttempt: { status: "failed", checkedAt: "2027-01-15T00:00:00.000Z" },
      },
      expectedField: "degradedRegistryCodes",
    },
    {
      name: "refresh blocked",
      registry: {
        registryCode: "cec-products",
        status: "current",
        lastAttempt: {
          status: "unchanged",
          checkedAt: "2027-01-15T00:00:00.000Z",
        },
        readiness: {
          calculatorReady: true,
          refreshReady: false,
          blocker: "The platform CEC battery connector is not configured.",
        },
      },
      expectedField: "refreshBlockedRegistryCodes",
    },
    {
      name: "unavailable",
      registry: {
        registryCode: "veu-approved-products",
        status: "unavailable",
        lastAttempt: null,
      },
      expectedField: "unavailableRegistryCodes",
    },
  ];

  for (const scenario of scenarios) {
    const store = createStateStore();
    const alertBodies = [];
    const result = await runApiHealthMonitor({
      siteUrl: "https://example.test",
      leadProbeToken: "probe-secret",
      alertWebhookUrl: "https://alerts.example.test/hook",
      stateStore: store,
      logger: quietLogger(),
      now: () => 1_800_000_000_000,
      async fetchImpl(url, options) {
        if (String(url).includes("/api/creditex/official-products")) {
          const response = await healthyCheckResponse(url).json();
          response.registries = response.registries.map((registry) => (
            registry.registryCode === scenario.registry.registryCode
              ? scenario.registry
              : registry
          ));
          return jsonResponse(response);
        }
        const healthy = healthyCheckResponse(url);
        if (healthy) return healthy;
        alertBodies.push(options.body);
        return new Response(null, { status: 204 });
      },
    });

    const registryCheck = result.checks.find(
      (check) => check.name === "official_product_registries",
    );
    assert.equal(result.status, "unhealthy", scenario.name);
    assert.equal(registryCheck.ok, false, scenario.name);
    assert.deepEqual(
      registryCheck[scenario.expectedField],
      [scenario.registry.registryCode],
      scenario.name,
    );
    assert.equal(result.alert.sent, true, scenario.name);
    assert.match(alertBodies[0], /official_product_registries/);
  }
});

test("monitor rejects the retired downstream acknowledgement response contract", async () => {
  const store = createStateStore();
  const result = await runApiHealthMonitor({
    siteUrl: "https://example.test",
    leadProbeToken: "probe-secret",
    alertWebhookUrl: "",
    stateStore: store,
    logger: quietLogger(),
    now: () => 1_800_000_000_000,
    async fetchImpl(url) {
      if (String(url).includes("lead-webhook-probe")) {
        return jsonResponse({ ok: true, probeId: "retired-probe" });
      }
      return healthyCheckResponse(url);
    },
  });
  assert.equal(result.status, "unhealthy");
  assert.equal(result.checks.find((entry) => entry.name === "lead_delivery").ok, false);
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
      const healthy = healthyCheckResponse(url);
      if (healthy) return healthy;
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
      const healthy = healthyCheckResponse(url);
      if (healthy) return healthy;
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
      const healthy = healthyCheckResponse(url);
      if (healthy) return healthy;
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
      const healthy = healthyCheckResponse(url);
      if (healthy) return healthy;
      return jsonResponse({ ok: false }, 500);
    },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.alert.sent, false);
  assert.equal(store.read().status, "unhealthy");
});

test("Google Apps monitoring checks the Sites runtime, both plan services and durable lead readiness", () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), "integrations/google-apps-script/lead-email-relay.gs"),
    "utf8",
  );
  assert.match(script, /everyHours\(1\)/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /\/api\/electricity-plans\?postcode=3000/);
  assert.match(script, /\/api\/gas-plans\?postcode=3000&annualMj=58000/);
  assert.match(script, /\/api\/internal\/lead-webhook-probe/);
  assert.match(script, /AEA_LEAD_WEBHOOK_TEST_TOKEN/);
  const monitorBlock = script.slice(
    script.indexOf("function runOperationalHealthCheck"),
    script.indexOf("function sheet_"),
  );
  assert.doesNotMatch(monitorBlock, /payload\.|writeLead_|sheet_|contact details|annualKwh|\bNMI\b|meter file/i);
});

test("Sites exposes a no-store service identity endpoint for independent availability checks", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/health/route.ts"),
    "utf8",
  );
  assert.match(route, /service: "aea-energy"/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /process\.env|request|email|postcode|NMI/i);
});
