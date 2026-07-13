import test from "node:test";
import assert from "node:assert/strict";
import { createLeadWebhookProbeHandler } from "../src/lib/lead-webhook-probe.mjs";

const TEST_TOKEN = "a-secure-test-token-with-32-characters";
const TEST_WEBHOOK = "https://lead-processor.example/webhook";

function request(token = TEST_TOKEN) {
  return new Request("https://compare.example/api/internal/lead-webhook-probe", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test("lead webhook probe requires a separately configured high-entropy token", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(null, { status: 200 }); };
  const unconfigured = createLeadWebhookProbeHandler({ env: {}, fetchImpl });
  const unconfiguredResponse = await unconfigured(request());
  assert.equal(unconfiguredResponse.status, 503);

  const configured = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN, AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK },
    fetchImpl,
  });
  const unauthorizedResponse = await configured(request("wrong-token"));
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(calls, 0);
});

test("lead webhook probe sends a distinct test event with no customer or energy data", async () => {
  let delivery;
  const handler = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN, AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK },
    fetchImpl: async (url, init) => {
      delivery = { url, init };
      return new Response(null, { status: 204 });
    },
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    createId: () => "probe-id-123",
  });

  const response = await handler(request());
  const result = await response.json();
  const payload = JSON.parse(delivery.init.body);

  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, probeId: "probe-id-123" });
  assert.equal(delivery.url, TEST_WEBHOOK);
  assert.equal(delivery.init.headers["X-AEA-Event-Type"], "webhook.delivery_probe");
  assert.deepEqual(payload, {
    schemaVersion: "1",
    eventType: "webhook.delivery_probe",
    test: true,
    probeId: "probe-id-123",
    sentAt: "2026-07-13T12:00:00.000Z",
    source: "aea-energy",
  });
  for (const field of ["submissionType", "name", "email", "phone", "nmi", "postcode", "annualKwh", "top3"]) {
    assert.equal(field in payload, false);
  }
});

test("lead webhook probe reports a failed downstream acknowledgement", async () => {
  const handler = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN, AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK },
    fetchImpl: async () => new Response(null, { status: 500 }),
    createId: () => "failed-probe-id",
  });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "The lead processor did not acknowledge the probe.",
    probeId: "failed-probe-id",
  });
});
