import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createLeadWebhookProbeHandler,
  LEAD_PROCESSOR_TIMEOUT_MS,
  LEAD_READINESS_TIMEOUT_MS,
} from "../src/lib/lead-webhook-probe.mjs";
import {
  PUBLIC_PLAN_READINESS_OBJECT_KEY,
  publicPlanInternalRelayConfigured,
  readPublicPlanDeliveryReadiness,
} from "../src/lib/public-plan-delivery-readiness.mjs";

const TEST_TOKEN = "a-secure-test-token-with-32-characters";
const migration = fs.readFileSync(
  new URL("../drizzle/0129_public_plan_delivery_outboxes.sql", import.meta.url),
  "utf8",
);
const helperSource = fs.readFileSync(
  new URL("../src/lib/public-plan-delivery-readiness.mjs", import.meta.url),
  "utf8",
);
const routeSource = fs.readFileSync(
  new URL("../src/app/api/internal/lead-webhook-probe/route.js", import.meta.url),
  "utf8",
);

class TestD1Statement {
  constructor(database, sql, bindings = [], queries = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
    this.queries = queries;
  }

  bind(...bindings) {
    return new TestD1Statement(this.database, this.sql, bindings, this.queries);
  }

  async all() {
    this.queries.push(this.sql);
    assert.match(this.sql.trimStart(), /^SELECT\b/i);
    return {
      success: true,
      results: this.database.prepare(this.sql).all(...this.bindings),
    };
  }
}

function testD1(database, queries = []) {
  return {
    prepare(sql) {
      return new TestD1Statement(database, sql, [], queries);
    },
  };
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    database.exec(statement);
  }
  return database;
}

function request(token = TEST_TOKEN) {
  return new Request(
    "https://compare.example/api/internal/lead-webhook-probe",
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
}

function readyResult(overrides = {}) {
  return {
    ok: true,
    checks: [
      { name: "durable_intake", ok: true, blocking: true, evidence: "required_columns_and_indexes_readable" },
    ],
    schedulerExecutionVerified: false,
    providerDeliveryVerified: false,
    ...overrides,
  };
}

test("durable readiness has a two second endpoint deadline while legacy lead handling keeps its own timeout", () => {
  assert.equal(LEAD_READINESS_TIMEOUT_MS, 2_000);
  assert.ok(LEAD_PROCESSOR_TIMEOUT_MS > 12_590);
  assert.ok(LEAD_PROCESSOR_TIMEOUT_MS <= 20_000);
});

test("readiness probe requires a separately configured high entropy token before any read", async () => {
  let reads = 0;
  const readReadiness = async () => {
    reads += 1;
    return readyResult();
  };
  const unconfigured = createLeadWebhookProbeHandler({ env: {}, readReadiness });
  assert.equal((await unconfigured(request())).status, 503);

  const configured = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN },
    readReadiness,
  });
  const unauthorized = await configured(request("wrong-token"));
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");
  assert.equal(reads, 0);
});

test("readiness probe returns only bounded capability evidence and preserves no-store", async () => {
  const handler = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN },
    createId: () => "readiness-probe-1",
    readReadiness: async () => readyResult(),
  });
  const response = await handler(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    ok: true,
    probeId: "readiness-probe-1",
    mode: "durable_outbox_readiness",
    checks: readyResult().checks,
    schedulerExecutionVerified: false,
    providerDeliveryVerified: false,
  });
  assert.doesNotMatch(JSON.stringify(body), /email@|phone|postcode|address|secret|api[_-]?key/i);
});

test("readiness probe fails closed when a blocking capability is unavailable", async () => {
  const handler = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN },
    createId: () => "readiness-probe-failed",
    readReadiness: async () => readyResult({ ok: false }),
  });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

test("readiness probe stops waiting at its configured deadline", async () => {
  const startedAt = Date.now();
  const handler = createLeadWebhookProbeHandler({
    env: { AEA_LEAD_WEBHOOK_TEST_TOKEN: TEST_TOKEN },
    createId: () => "readiness-probe-timeout",
    timeoutMs: 20,
    readReadiness: () => new Promise(() => {}),
  });
  const response = await handler(request());
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.mode, "durable_outbox_readiness");
  assert.equal(body.schedulerExecutionVerified, false);
  assert.equal(body.providerDeliveryVerified, false);
  assert.ok(Date.now() - startedAt < 500);
});

test("readiness reads the required schema, indexes and reserved R2 key without mutation or provider calls", async () => {
  const database = migratedDatabase();
  const queries = [];
  const bucketCalls = [];
  const bucket = {
    async head(key) {
      bucketCalls.push(["head", key]);
      return null;
    },
    async put() {
      assert.fail("readiness must not write R2 objects");
    },
    async delete() {
      assert.fail("readiness must not delete R2 objects");
    },
  };
  const result = await readPublicPlanDeliveryReadiness({
    database: testD1(database, queries),
    bucket,
    customerEmailConfigured: true,
    internalRelayConfigured: false,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((entry) => entry.name), [
    "durable_intake",
    "customer_email_outbox",
    "internal_relay_outbox",
    "private_payload_store",
    "customer_email_configuration",
    "internal_relay_configuration",
  ]);
  assert.deepEqual(result.checks.map((entry) => entry.ok), [true, true, true, true, true, false]);
  assert.equal(result.checks.at(-1).blocking, false);
  assert.equal(result.schedulerExecutionVerified, false);
  assert.equal(result.providerDeliveryVerified, false);
  assert.deepEqual(bucketCalls, [["head", PUBLIC_PLAN_READINESS_OBJECT_KEY]]);
  assert.equal(queries.length, 4);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_lead_intakes").get().count, 0);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_customer_email_deliveries").get().count, 0);
  assert.equal(database.prepare("SELECT count(*) count FROM public_plan_internal_relay_deliveries").get().count, 0);
  database.close();
});

test("missing customer channel, schema or R2 read access fails readiness without hiding the relay status", async () => {
  const database = migratedDatabase();
  const noCustomerChannel = await readPublicPlanDeliveryReadiness({
    database: testD1(database),
    bucket: { head: async () => null },
    customerEmailConfigured: false,
    internalRelayConfigured: true,
  });
  assert.equal(noCustomerChannel.ok, false);
  assert.equal(noCustomerChannel.checks.find((entry) => entry.name === "customer_email_configuration").ok, false);

  database.exec("DROP INDEX public_plan_customer_email_status_idx");
  const missingIndex = await readPublicPlanDeliveryReadiness({
    database: testD1(database),
    bucket: { head: async () => null },
    customerEmailConfigured: true,
    internalRelayConfigured: true,
  });
  assert.equal(missingIndex.ok, false);
  assert.equal(missingIndex.checks.find((entry) => entry.name === "customer_email_outbox").ok, false);

  const noR2Read = await readPublicPlanDeliveryReadiness({
    database: testD1(database),
    bucket: { head: async () => { throw new Error("binding unavailable"); } },
    customerEmailConfigured: true,
    internalRelayConfigured: true,
  });
  assert.equal(noR2Read.ok, false);
  assert.equal(noR2Read.checks.find((entry) => entry.name === "private_payload_store").ok, false);
  database.close();
});

test("an object at the reserved absent key fails closed instead of being touched", async () => {
  const database = migratedDatabase();
  const result = await readPublicPlanDeliveryReadiness({
    database: testD1(database),
    bucket: { head: async () => ({ size: 1 }) },
    customerEmailConfigured: true,
    internalRelayConfigured: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((entry) => entry.name === "private_payload_store").ok, false);
  database.close();
});

test("legacy internal relay configuration is HTTPS and secret length checked but remains nonblocking", () => {
  assert.equal(publicPlanInternalRelayConfigured({}), false);
  assert.equal(publicPlanInternalRelayConfigured({
    AEA_LEAD_WEBHOOK_URL: "http://relay.example.test",
    AEA_LEAD_WEBHOOK_SIGNING_SECRET: "x".repeat(32),
  }), false);
  assert.equal(publicPlanInternalRelayConfigured({
    AEA_LEAD_WEBHOOK_URL: "https://relay.example.test",
    AEA_LEAD_WEBHOOK_SIGNING_SECRET: "short",
  }), false);
  assert.equal(publicPlanInternalRelayConfigured({
    AEA_LEAD_WEBHOOK_URL: "https://relay.example.test",
    AEA_LEAD_WEBHOOK_SIGNING_SECRET: "x".repeat(32),
  }), true);
});

test("runtime readiness implementation has no mutation or provider delivery surface", () => {
  assert.doesNotMatch(helperSource, /\.(?:put|delete|run|batch)\s*\(/);
  assert.doesNotMatch(helperSource, /\bfetch\s*\(|fetchImpl|api\.resend|UrlFetchApp/);
  assert.doesNotMatch(routeSource, /createAdminNotification|resolveSystemAdminNotifications|enqueue|dispatch|send[A-Z]|\bfetch\s*\(/);
  assert.match(routeSource, /serviceReminderProviderConfiguration/);
  assert.match(routeSource, /getD1\(\)/);
  assert.match(routeSource, /getCustomerProjectEvidenceBucket\(\)/);
});
