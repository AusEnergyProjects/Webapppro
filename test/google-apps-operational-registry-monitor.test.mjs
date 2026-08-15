import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES,
} from "../src/lib/creditex-official-product-registry.ts";

const scriptPath = path.join(
  process.cwd(),
  "integrations/google-apps-script/lead-email-relay.gs",
);
const scriptSource = fs.readFileSync(scriptPath, "utf8");

const requiredRegistryCodes = [
  ...CREDITEX_CALCULATOR_REQUIRED_PRODUCT_REGISTRY_CODES,
];

function jsonResponse(body, status = 200) {
  return {
    getResponseCode() {
      return status;
    },
    getContentText() {
      return JSON.stringify(body);
    },
  };
}

function healthyRegistries(lastAttemptStatus = "success") {
  return requiredRegistryCodes.map((registryCode) => ({
    registryCode,
    status: "current",
    lastAttempt: {
      status: lastAttemptStatus,
      checkedAt: "2026-08-15T00:00:00.000Z",
      message: "",
    },
    readiness: {
      calculatorReady: true,
      refreshReady: true,
      blocker: null,
    },
  }));
}

function appsScriptHarness({
  registries = healthyRegistries(),
  initialState = null,
  now = 1_787_000_000_000,
} = {}) {
  let activeRegistries = registries;
  let currentNow = now;
  let savedState = initialState ? JSON.stringify(initialState) : "";
  const requests = [];
  const emails = [];

  class FixedDate extends Date {
    static now() {
      return currentNow;
    }
  }

  const sandbox = {
    console: { log() {}, error() {} },
    Date: FixedDate,
    MailApp: {
      sendEmail(payload) {
        emails.push(payload);
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            if (key === "AEA_LEAD_WEBHOOK_TEST_TOKEN") return "test-probe-token";
            if (key === "AEA_OPS_HEALTH_STATE_V1") return savedState;
            return "";
          },
          setProperty(key, value) {
            if (key === "AEA_OPS_HEALTH_STATE_V1") savedState = value;
          },
        };
      },
    },
    UrlFetchApp: {
      fetch(url) {
        const value = String(url);
        requests.push(value);
        if (value.endsWith("/api/health")) {
          return jsonResponse({ ok: true, service: "aea-energy" });
        }
        if (value.includes("/api/creditex/official-products")) {
          return jsonResponse({ ok: true, registries: activeRegistries });
        }
        if (value.includes("/api/electricity-plans") || value.includes("/api/gas-plans")) {
          return jsonResponse({
            plans: [{ id: "plan-1" }],
            source: {
              listSourcesSucceeded: 1,
              detailPlansSucceeded: 1,
              plansWithLastUpdated: 1,
              detailApiVersion: "3",
            },
          });
        }
        if (value.includes("/api/internal/lead-webhook-probe")) {
          return jsonResponse({ ok: true, probeId: "probe-1" });
        }
        throw new Error(`Unexpected Apps Script request: ${value}`);
      },
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(scriptSource, context, { filename: scriptPath });

  return {
    emails,
    requests,
    run() {
      return vm.runInContext("runOperationalHealthCheck()", context);
    },
    setNow(value) {
      currentNow = value;
    },
    setRegistries(value) {
      activeRegistries = value;
    },
    state() {
      return JSON.parse(savedState || "null");
    },
  };
}

test("production Apps Script monitors every required official product registry", () => {
  assert.match(scriptSource, /\/api\/creditex\/official-products/);
  assert.match(scriptSource, /opsOfficialProductRegistriesOk_/);
  for (const registryCode of requiredRegistryCodes) {
    assert.match(scriptSource, new RegExp(`"${registryCode}"`));
  }

  const harness = appsScriptHarness({
    registries: healthyRegistries("unchanged"),
  });
  const result = harness.run();

  assert.equal(result.status, "healthy");
  assert.equal(result.alertSent, false);
  assert.equal(
    harness.requests.filter((url) => url.includes("/api/creditex/official-products")).length,
    1,
  );
  assert.deepEqual(
    Array.from(result.checks, (check) => check.name),
    [
      "site_runtime",
      "official_product_registries",
      "electricity_plans",
      "gas_plans",
      "lead_delivery",
    ],
  );
});

test("production Apps Script fails closed for every unsafe required-registry state", () => {
  const scenarios = [
    {
      name: "missing registry",
      registries: healthyRegistries().filter(
        (registry) => registry.registryCode !== "veu-approved-products",
      ),
    },
    {
      name: "stale registry",
      registries: healthyRegistries().map((registry) => (
        registry.registryCode === "veu-approved-products"
          ? { ...registry, status: "stale" }
          : registry
      )),
    },
    {
      name: "unavailable registry",
      registries: healthyRegistries().map((registry) => (
        registry.registryCode === "veu-approved-products"
          ? { ...registry, status: "unavailable" }
          : registry
      )),
    },
    {
      name: "failed latest attempt",
      registries: healthyRegistries().map((registry) => (
        registry.registryCode === "veu-approved-products"
          ? { ...registry, lastAttempt: { ...registry.lastAttempt, status: "failed" } }
          : registry
      )),
    },
    {
      name: "refresh blocked",
      registries: healthyRegistries().map((registry) => (
        registry.registryCode === "cec-products"
          ? {
              ...registry,
              readiness: {
                ...registry.readiness,
                refreshReady: false,
                blocker: "CEC connector credentials are missing.",
              },
            }
          : registry
      )),
    },
    {
      name: "missing latest attempt",
      registries: healthyRegistries().map((registry) => (
        registry.registryCode === "veu-approved-products"
          ? { ...registry, lastAttempt: null }
          : registry
      )),
    },
  ];

  for (const scenario of scenarios) {
    const harness = appsScriptHarness({ registries: scenario.registries });
    const result = harness.run();
    const registryCheck = Array.from(result.checks).find(
      (check) => check.name === "official_product_registries",
    );

    assert.equal(result.status, "unhealthy", scenario.name);
    assert.equal(registryCheck.ok, false, scenario.name);
    assert.equal(result.alertSent, true, scenario.name);
    assert.equal(harness.emails.length, 1, scenario.name);
    assert.match(harness.emails[0].body, /official_product_registries: failed/);
    assert.doesNotMatch(
      harness.emails[0].body,
      /registryCode|lastAttempt|sourceSha256|recordCount|customer|email|phone|postcode|NMI/i,
      scenario.name,
    );
  }
});

test("production Apps Script preserves six-hour suppression and recovery alerts", () => {
  const now = 1_787_000_000_000;
  const failedRegistries = healthyRegistries().map((registry) => (
    registry.registryCode === "gems-products"
      ? { ...registry, status: "stale" }
      : registry
  ));
  const harness = appsScriptHarness({ registries: failedRegistries, now });

  assert.equal(harness.run().status, "unhealthy");
  assert.equal(harness.emails.length, 1);

  harness.setNow(now + 60 * 60 * 1000);
  const suppressed = harness.run();
  assert.equal(suppressed.status, "unhealthy");
  assert.equal(suppressed.alertSent, false);
  assert.equal(harness.emails.length, 1);

  harness.setRegistries(healthyRegistries());
  harness.setNow(now + 2 * 60 * 60 * 1000);
  const recovered = harness.run();
  assert.equal(recovered.status, "healthy");
  assert.equal(recovered.alertSent, true);
  assert.equal(harness.emails.length, 2);
  assert.match(harness.emails[1].subject, /recovered/);
  assert.equal(harness.state().status, "healthy");
});
