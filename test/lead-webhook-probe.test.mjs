import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createLeadWebhookProbeHandler,
  LEAD_PROCESSOR_TIMEOUT_MS,
} from "../src/lib/lead-webhook-probe.mjs";

const TEST_TOKEN = "a-secure-test-token-with-32-characters";
const TEST_SIGNING_SECRET = "a-distinct-lead-signing-secret-with-32-characters";
const TEST_WEBHOOK = "https://lead-processor.example/webhook";

test("lead processor timeout covers the observed Google Apps Script cold start", () => {
  assert.ok(LEAD_PROCESSOR_TIMEOUT_MS > 12_590);
  assert.ok(LEAD_PROCESSOR_TIMEOUT_MS <= 20_000);
});

function request(token = TEST_TOKEN) {
  return new Request(
    "https://compare.example/api/internal/lead-webhook-probe",
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
}

test("lead webhook probe requires a separately configured high-entropy token", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("ok", { status: 200 });
  };
  const unconfigured = createLeadWebhookProbeHandler({ env: {}, fetchImpl });
  const unconfiguredResponse = await unconfigured(request());
  assert.equal(unconfiguredResponse.status, 503);

  const configured = createLeadWebhookProbeHandler({
    env: {
      AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN,
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: TEST_SIGNING_SECRET,
      AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK,
    },
    fetchImpl,
  });
  const unauthorizedResponse = await configured(request("wrong-token"));
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(calls, 0);
});

test("lead webhook probe sends a distinct test event with no customer or energy data", async () => {
  let delivery;
  const handler = createLeadWebhookProbeHandler({
    env: {
      AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN,
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: TEST_SIGNING_SECRET,
      AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK,
    },
    fetchImpl: async (url, init) => {
      delivery = { url, init };
      return new Response("ok", { status: 200 });
    },
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    createId: () => "probe-id-123",
  });

  const response = await handler(request());
  const result = await response.json();
  const envelope = JSON.parse(delivery.init.body);
  const payload = JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, probeId: "probe-id-123" });
  assert.equal(delivery.url, TEST_WEBHOOK);
  assert.equal(
    delivery.init.headers["X-AEA-Event-Type"],
    "webhook.delivery_probe",
  );
  assert.equal(envelope.eventType, "lead.webhook");
  assert.equal(envelope.sentAt, "2026-07-13T12:00:00.000Z");
  assert.equal(
    envelope.signature,
    createHmac("sha256", TEST_SIGNING_SECRET)
      .update(`${envelope.sentAt}.${envelope.payload}`)
      .digest("base64url"),
  );
  assert.deepEqual(payload, {
    schemaVersion: "1",
    eventType: "webhook.delivery_probe",
    test: true,
    probeId: "probe-id-123",
    sentAt: "2026-07-13T12:00:00.000Z",
    source: "aea-energy",
  });
  for (const field of [
    "submissionType",
    "name",
    "email",
    "phone",
    "nmi",
    "postcode",
    "annualKwh",
    "top3",
  ]) {
    assert.equal(field in payload, false);
  }
});

test("lead webhook probe reports a failed downstream acknowledgement", async () => {
  const handler = createLeadWebhookProbeHandler({
    env: {
      AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN,
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: TEST_SIGNING_SECRET,
      AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK,
    },
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

test("lead webhook probe rejects an HTTP 200 error body from a signing-mismatched relay", async () => {
  const handler = createLeadWebhookProbeHandler({
    env: {
      AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN,
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: TEST_SIGNING_SECRET,
      AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK,
    },
    fetchImpl: async () =>
      new Response("error: Invalid lead webhook signature", { status: 200 }),
    createId: () => "body-failure-probe-id",
  });
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).ok, false);
});

test("lead webhook probe fails closed when signing is absent or the processor has a different secret", async () => {
  const unconfigured = createLeadWebhookProbeHandler({
    env: {
      AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN,
      AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK,
    },
    createId: () => "unsigned-probe-id",
  });
  const unconfiguredResponse = await unconfigured(request());
  assert.equal(unconfiguredResponse.status, 503);
  assert.match(
    (await unconfiguredResponse.json()).error,
    /signing is not configured/i,
  );

  let receivedSignedEnvelope = false;
  const mismatched = createLeadWebhookProbeHandler({
    env: {
      AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN,
      AEA_LEAD_WEBHOOK_SIGNING_SECRET: TEST_SIGNING_SECRET,
      AEA_LEAD_WEBHOOK_URL: TEST_WEBHOOK,
    },
    fetchImpl: async (_url, init) => {
      const envelope = JSON.parse(init.body);
      receivedSignedEnvelope = envelope.eventType === "lead.webhook";
      const expected = createHmac(
        "sha256",
        "a-different-processor-secret-with-32-characters",
      )
        .update(`${envelope.sentAt}.${envelope.payload}`)
        .digest("base64url");
      return envelope.signature === expected
        ? new Response("ok", { status: 200 })
        : new Response("error: Invalid lead webhook signature", {
            status: 200,
          });
    },
    createId: () => "mismatched-secret-probe-id",
  });
  const mismatchResponse = await mismatched(request());
  assert.equal(receivedSignedEnvelope, true);
  assert.equal(mismatchResponse.status, 502);
});
