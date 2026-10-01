import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../integrations/google-apps-script/trade-map-maintenance.gs", import.meta.url), "utf8");
function harness({ status = 202, token = "test-operations-key-with-at-least-thirty-two-characters", triggers = [] } = {}) {
  const calls = [], logs = [], created = [];
  const context = {
    Date: { now: () => 1_790_824_000_000 },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(name => ({ getHandlerFunction: () => name })),
      newTrigger: name => ({ timeBased: () => ({ everyMinutes: minutes => ({ create: () => created.push({ name, minutes }) }) }) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => name === "AEA_LEAD_WEBHOOK_TEST_TOKEN" ? token : null }) },
    Utilities: {
      computeHmacSha256Signature: (message, secret) => createHmac("sha256", secret).update(message).digest(),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
    },
    UrlFetchApp: { fetch: (url, options) => { calls.push({ url, options }); return { getResponseCode: () => status }; } },
    console: { log: message => logs.push(message) },
  };
  runInNewContext(source, context);
  return { context, calls, logs, created, token };
}
test("map trigger is installed once per minute without changing the existing health trigger", () => {
  const h = harness({ triggers: ["runOperationalHealthCheck"] });
  h.context.setupTradeMapMaintenance();
  assert.deepEqual(h.created, [{ name: "runTradeMapMaintenance", minutes: 1 }]);
  const installed = harness({ triggers: ["runOperationalHealthCheck", "runTradeMapMaintenance"] });
  installed.context.setupTradeMapMaintenance();
  assert.equal(installed.created.length, 0);
});
test("scheduler uses a fresh purpose-bound signature and never follows credential redirects", () => {
  const h = harness();
  h.context.runTradeMapMaintenance();
  assert.equal(h.calls.length, 1);
  const { url, options } = h.calls[0];
  assert.equal(url, "https://ausenergyassessments.com/api/internal/trade-map-maintenance");
  assert.equal(options.method, "post");
  assert.equal(options.followRedirects, false);
  assert.equal(options.headers["X-TLink-Maintenance-Timestamp"], "1790824000000");
  assert.equal(options.headers["X-TLink-Maintenance-Signature"], createHmac("sha256", h.token).update("tlink-map-maintenance\n1790824000000").digest("base64url"));
  assert.equal(JSON.stringify(h.calls).includes(h.token), false);
  assert.equal(JSON.stringify(h.logs).includes(h.token), false);
});
test("missing authentication and rejected requests fail visibly without logging response contents", () => {
  const missing = harness({ token: "" });
  assert.throws(() => missing.context.runTradeMapMaintenance(), /not configured/);
  assert.equal(missing.calls.length, 0);
  const rejected = harness({ status: 401 });
  assert.throws(() => rejected.context.runTradeMapMaintenance(), /HTTP 401/);
  assert.equal(rejected.logs.length, 0);
});
