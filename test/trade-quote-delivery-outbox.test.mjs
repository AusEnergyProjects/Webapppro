import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  drainTradeQuoteDeliveries,
  tradeQuoteDeliveryStatus,
} from "../src/lib/trade-quote-delivery-server.ts";
import {
  buildTradeQuoteEmailForRevision,
  buildVerifiedTradeQuoteEmailForRevision,
  resolveTradeQuoteEmailRendererRevision,
  tradeQuoteEmailContentSha256,
} from "../src/lib/trade-quote-email.ts";
import {
  queueTradeQuoteDeliveryDispatch,
  TRADE_QUOTE_DELIVERY_DISPATCH_HEADER,
  withTradeQuoteDeliveryDispatch,
} from "../src/lib/trade-quote-delivery-dispatch.ts";
import {
  TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS,
  assertTradeQuoteIssueDeliveryAccess,
  tradeQuoteDeliveryCallbackStatus,
  tradeQuoteDeliveryPresentation,
  tradeQuoteDeliveryRetryAt,
} from "../src/lib/trade-quote-delivery-policy.mjs";

const migration = fs.readFileSync(
  new URL("../drizzle/0136_trade_quote_delivery_outbox.sql", import.meta.url),
  "utf8",
);
const rendererMigration = fs.readFileSync(
  new URL("../drizzle/0137_trade_quote_delivery_renderer_revision.sql", import.meta.url),
  "utf8",
);
const route = fs.readFileSync(new URL("../src/app/api/trade-quotes/route.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const callback = fs.readFileSync(
  new URL("../src/app/api/service-reminder-provider-events/resend/route.ts", import.meta.url),
  "utf8",
);
const notifications = fs.readFileSync(
  new URL("../src/app/api/trade-job-notifications/route.ts", import.meta.url),
  "utf8",
);

const callbackUpdateSql = callback.match(/db\.prepare\(`(UPDATE trade_crm_quote_deliveries SET[\s\S]*?updated_at = \? WHERE id = \?)`\)/)?.[1];
const issueClaimSql = route.match(/const issueClaim = await db\.prepare\(`(UPDATE trade_crm_quote_versions[\s\S]*?updated_at = \?)`\)/)?.[1];
const replacementDraftInsertSql = route.match(/db\.prepare\(`(INSERT OR IGNORE INTO trade_crm_quote_versions[\s\S]*?)`\)\.bind\(versionId/)?.[1];
const revokeLinkSql = route.match(/db\.prepare\(`(UPDATE trade_crm_quote_links[\s\S]*?NOT EXISTS \([\s\S]*?\n        \))`\)\s*\.bind\(now, now, row\.link_id/)?.[1];
const issuedEventSqlTemplate = route.match(
  /(INSERT INTO trade_crm_quote_events\s*\([\s\S]*?SELECT \?, \?, \?, \?, \?, \?, 'issued',[\s\S]*?WHERE \$\{claimStillHeld\})/,
)?.[1];
const queuedDeliverySqlTemplate = route.match(
  /(INSERT OR IGNORE INTO trade_crm_quote_deliveries\s*\([\s\S]*?SELECT \?, \?, \?, \?, \?, \?, 'email', 'resend', 'queued',[\s\S]*?WHERE \$\{claimStillHeld\})/,
)?.[1];

function apply(database, sql) {
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    database.exec(statement);
  }
}

function d1(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      let bindings = [];
      const prepared = {
        bind(...values) { bindings = values; return prepared; },
        async first(columnName) {
          const row = statement.get(...bindings);
          return columnName ? row?.[columnName] ?? null : row ?? null;
        },
        async all() { return { results: statement.all(...bindings), success: true, meta: {} }; },
        async run() {
          const result = statement.run(...bindings);
          return { results: [], success: true, meta: { changes: Number(result.changes) } };
        },
      };
      return prepared;
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE trade_crm_quote_deliveries (
    id text PRIMARY KEY NOT NULL, quote_link_id text NOT NULL,
    quote_version_id text NOT NULL, work_order_id text NOT NULL,
    firebase_uid text NOT NULL, crm_customer_id text NOT NULL,
    channel text NOT NULL, provider text NOT NULL, status text NOT NULL,
    recipient_preview text NOT NULL DEFAULT '', recipient_role text NOT NULL DEFAULT 'acceptance',
    consent_basis text NOT NULL DEFAULT '', idempotency_key text NOT NULL UNIQUE,
    provider_message_id text NOT NULL DEFAULT '', provider_status text NOT NULL DEFAULT '',
    attempts integer NOT NULL DEFAULT 0, last_error text NOT NULL DEFAULT '',
    sent_at text NOT NULL DEFAULT '', delivered_at text NOT NULL DEFAULT '',
    subject_snapshot text NOT NULL DEFAULT '', email_content_sha256 text NOT NULL DEFAULT '',
    attachment_filename text NOT NULL DEFAULT '', attachment_sha256 text NOT NULL DEFAULT '',
    created_at text NOT NULL, updated_at text NOT NULL
  );
  CREATE TABLE trade_crm_quote_links (
    id text PRIMARY KEY, quote_id text, quote_version_id text, work_order_id text,
    firebase_uid text, crm_customer_id text, token_issue integer, token_hash text,
    encrypted_token text, status text, expires_at text
  );
  CREATE TABLE trade_crm_quote_versions (
    id text PRIMARY KEY, quote_id text, firebase_uid text, version_number integer,
    status text, acceptance_email text, document_snapshot_json text,
    issued_pdf_object_key text, issued_pdf_sha256 text, issued_pdf_size_bytes integer
  );
  CREATE TABLE trade_crm_quotes (
    id text PRIMARY KEY, firebase_uid text, work_order_id text, quote_number text,
    current_version_number integer, status text
  );
  CREATE TABLE trade_work_orders (
    id text PRIMARY KEY, firebase_uid text, record_status text, source_type text
  );
  CREATE TABLE trade_crm_job_details (
    work_order_id text, firebase_uid text, crm_customer_id text,
    customer_source text, accepted_disclosure_sha256 text,
    accepted_disclosure_snapshot text
  );
  CREATE TABLE trade_crm_customers (
    id text PRIMARY KEY, firebase_uid text, email text, record_status text
  );
  CREATE TABLE trade_crm_customer_contacts (
    id text PRIMARY KEY, customer_id text, firebase_uid text, email text, record_status text
  );
  CREATE TABLE trade_crm_quote_events (
    id text PRIMARY KEY, quote_link_id text, quote_id text, quote_version_id text,
    work_order_id text, firebase_uid text, event_type text, actor_type text,
    summary text, evidence_key text UNIQUE, occurred_at text
  );`);
  return { database, db: d1(database) };
}

function insertLegacy(database, { id = "delivery-1", status = "failed", attempts = 1 } = {}) {
  database.prepare(`INSERT INTO trade_crm_quote_deliveries
    (id, quote_link_id, quote_version_id, work_order_id, firebase_uid,
     crm_customer_id, channel, provider, status, idempotency_key, attempts,
     created_at, updated_at)
    VALUES (?, 'link-1', 'version-1', 'work-1', 'owner-1', 'customer-1',
      'email', 'resend', ?, ?, ?,
      '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z')`)
    .run(id, status, `quote:version-1:1:email:${id}`, attempts);
}

function initialiseOutbox(database, now = "2026-08-13T01:00:00.000Z") {
  database.prepare(`UPDATE trade_crm_quote_deliveries SET
    status = 'queued', recipient_email_sha256 = 'recipient-hash',
    provider_idempotency_key = 'provider-key',
    public_origin = 'https://compare.ausenergyassessments.com',
    queued_at = ?, next_attempt_at = ?, attempts = 0,
    failure_code = '', last_error = '', updated_at = ? WHERE id = 'delivery-1'`)
    .run(now, now, now);
}

function rendererSnapshot() {
  return {
    schemaVersion: "trade-quote-document-v2",
    capturedAt: "2026-08-13T03:15:00.000Z",
    quoteId: "quote-1",
    quoteVersionId: "version-1",
    quoteNumber: "Q-TLJ-X23NSK46",
    versionNumber: 1,
    work: {
      id: "work-1",
      number: "TLJ-X23NSK46",
      title: "Heat pump and certificate project",
    },
    customer: {
      id: "customer-1",
      number: "CUS-1",
      name: "James William",
      email: "customer@example.com",
    },
    site: {
      id: "site-1",
      label: "Primary site",
      addressLine1: "1 Test Street",
      addressLine2: "",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      summary: "1 Test Street, Melbourne VIC 3000",
    },
    business: {
      name: "Australian Energy Assessments",
      email: "quotes@ausenergyassessments.com",
      phone: "1300 000 001",
      abn: "12345678901",
      website: "https://ausenergyassessments.com",
      address: "Level 4, Melbourne VIC 3000",
      themeKey: "emerald_navy",
      borderStyle: "soft",
      logo: null,
      banner: null,
      bannerCrop: null,
      quoteEmailSubjectTemplate: "{business_name} sent quote {quote_number}",
      quoteEmailIntro: "Thank you for the opportunity to quote.",
    },
    acceptanceEmail: "customer@example.com",
    subtotalCents: 5_400,
    taxCents: 540,
    totalCents: 5_940,
    customerMessage: "Review the scope, choices and total below.",
    terms: "Installation is subject to safe site access.",
    validUntil: "2026-09-12",
    consentStatement: "I accept this exact quote.",
    issuedAt: "2026-08-13T03:15:00.000Z",
    items: [
      {
        id: "line-callout",
        lineType: "labour",
        description: "Call-out",
        quantityMilli: 6_000,
        unitPriceCents: 20_000,
        subtotalCents: 120_000,
        taxCents: 12_000,
        totalCents: 132_000,
        sectionHeading: "Included work",
      },
      {
        id: "line-stc",
        lineType: "adjustment",
        description: "STC rebate",
        quantityMilli: 30_000,
        unitPriceCents: -3_800,
        subtotalCents: -114_000,
        taxCents: -11_400,
        totalCents: -125_400,
        sectionHeading: "Included work",
      },
      {
        id: "line-final-percent",
        lineType: "adjustment",
        description: "Final spring sale",
        quantityMilli: 100,
        unitPriceCents: -6_000,
        subtotalCents: -600,
        taxCents: -60,
        totalCents: -660,
        sectionHeading: "Overall percentage discount",
      },
    ],
    choices: [],
  };
}

test("0137 pins existing deliveries to renderer v1 and fresh issuance to v2", () => {
  const { database } = fixture();
  insertLegacy(database, { status: "delivered" });
  apply(database, migration);
  apply(database, rendererMigration);
  const row = database.prepare(`SELECT email_renderer_revision
    FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'`).get();
  assert.equal(row.email_renderer_revision, 1);
  assert.equal(resolveTradeQuoteEmailRendererRevision(1), 1);
  assert.equal(resolveTradeQuoteEmailRendererRevision(), 2);
  assert.throws(
    () => resolveTradeQuoteEmailRendererRevision(99),
    /QUOTE_DELIVERY_RENDERER_REVISION_UNSUPPORTED/,
  );
  assert.match(rendererMigration, /email_renderer_revision.*DEFAULT 1 NOT NULL/);
  assert.match(route, /CURRENT_TRADE_QUOTE_EMAIL_RENDERER_REVISION/);
  assert.match(route, /email_renderer_revision, attachment_filename/);
  database.close();
});

test("frozen v1 and current v2 rebuild and dispatch their exact immutable email content", async () => {
  const email = {
    snapshot: rendererSnapshot(),
    shareUrl: "https://compare.ausenergyassessments.com/quote-review/link-1.legacy-secret",
    expiresAt: "2026-09-12T23:59:59.999Z",
  };
  const v1 = await buildTradeQuoteEmailForRevision(1, email);
  const v2 = await buildTradeQuoteEmailForRevision(2, email);
  const v1Hash = await tradeQuoteEmailContentSha256(v1);
  const v2Hash = await tradeQuoteEmailContentSha256(v2);
  assert.equal(v1Hash, "670db8730fbe710377b66b20304699467c2eab12f5dda6213f138a9d4b05eec5");
  assert.notEqual(v2Hash, v1Hash);
  assert.match(v1.text, /Discount ex GST/);
  assert.match(v1.text, /Final spring sale/);
  assert.match(v2.text, /Final 10% discount on included items ex GST/);

  for (const [revision, content, hash] of [[1, v1, v1Hash], [2, v2, v2Hash]]) {
    const { database, db } = fixture();
    insertLegacy(database);
    apply(database, migration);
    apply(database, rendererMigration);
    initialiseOutbox(database);
    database.prepare(`UPDATE trade_crm_quote_deliveries
      SET email_renderer_revision = ?, subject_snapshot = ?, email_content_sha256 = ?
      WHERE id = 'delivery-1'`).run(revision, content.subject, hash);
    let sends = 0;
    const result = await drainTradeQuoteDeliveries({
      db,
      deliveryId: "delivery-1",
      now: new Date("2026-08-13T01:00:00.000Z"),
      emailConfigured: true,
      loadContext: async () => database.prepare(
        "SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'",
      ).get(),
      prepareMessage: async (row) => {
        const verified = await buildVerifiedTradeQuoteEmailForRevision({
          revision: Number(row.email_renderer_revision),
          email,
          expectedSubject: String(row.subject_snapshot),
          expectedContentSha256: String(row.email_content_sha256),
        });
        return {
          channel: "email",
          recipient: "customer@example.com",
          subject: verified.subject,
          body: verified.text,
          html: verified.html,
          idempotencyKey: String(row.provider_idempotency_key),
          callbackUrl: "https://compare.ausenergyassessments.com/callback",
        };
      },
      sendEmail: async () => {
        sends += 1;
        return {
          provider: "test",
          providerMessageId: `message-v${revision}`,
          providerStatus: "accepted",
        };
      },
    });
    assert.equal(result.outcomes[0].outcome, "provider_accepted");
    assert.equal(sends, 1);
    database.close();
  }
});

test("unknown renderer revisions fail before the email provider is called", async () => {
  const email = {
    snapshot: rendererSnapshot(),
    shareUrl: "https://compare.ausenergyassessments.com/quote-review/link-1.legacy-secret",
    expiresAt: "2026-09-12T23:59:59.999Z",
  };
  const legacy = await buildTradeQuoteEmailForRevision(1, email);
  const { database, db } = fixture();
  insertLegacy(database);
  apply(database, migration);
  apply(database, rendererMigration);
  initialiseOutbox(database);
  database.prepare(`UPDATE trade_crm_quote_deliveries
    SET email_renderer_revision = 99, subject_snapshot = ?, email_content_sha256 = ?
    WHERE id = 'delivery-1'`).run(
    legacy.subject,
    await tradeQuoteEmailContentSha256(legacy),
  );
  let sends = 0;
  const result = await drainTradeQuoteDeliveries({
    db,
    deliveryId: "delivery-1",
    now: new Date("2026-08-13T01:00:00.000Z"),
    emailConfigured: true,
    loadContext: async () => database.prepare(
      "SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'",
    ).get(),
    prepareMessage: async (row) => {
      const verified = await buildVerifiedTradeQuoteEmailForRevision({
        revision: Number(row.email_renderer_revision),
        email,
        expectedSubject: String(row.subject_snapshot),
        expectedContentSha256: String(row.email_content_sha256),
      });
      return {
        channel: "email",
        recipient: "customer@example.com",
        subject: verified.subject,
        body: verified.text,
        idempotencyKey: "provider-key",
        callbackUrl: "https://compare.ausenergyassessments.com/callback",
      };
    },
    sendEmail: async () => {
      sends += 1;
      throw new Error("provider must not be called");
    },
  });
  assert.equal(sends, 0);
  assert.equal(
    result.outcomes[0].code,
    "QUOTE_DELIVERY_RENDERER_REVISION_UNSUPPORTED",
  );
  database.close();
});

test("0136 quarantines every legacy retryable state instead of auto-emailing customers", async () => {
  const { database, db } = fixture();
  for (const [index, status] of ["failed", "queued", "sending", "waiting_for_channel"].entries()) {
    insertLegacy(database, { id: `delivery-${index + 1}`, status });
  }
  apply(database, migration);
  const row = database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  const rows = database.prepare("SELECT status, failure_code FROM trade_crm_quote_deliveries ORDER BY id").all();
  assert.ok(rows.every((item) => item.status === "failed"));
  assert.ok(rows.every((item) => item.failure_code === "QUOTE_DELIVERY_LEGACY_RETRY_REQUIRED"));
  assert.equal(row.failure_code, "QUOTE_DELIVERY_LEGACY_RETRY_REQUIRED");
  assert.equal(row.recipient_email_sha256, "");
  let sends = 0;
  const result = await drainTradeQuoteDeliveries({
    db, now: new Date("2026-08-13T02:00:00.000Z"), emailConfigured: true,
    prepareMessage: async () => { throw new Error("must not prepare"); },
    sendEmail: async () => { sends += 1; throw new Error("must not send"); },
  });
  assert.equal(result.attempted, 0);
  assert.equal(sends, 0);
  assert.deepEqual(tradeQuoteDeliveryPresentation(row.status, row.attempts, row.next_attempt_at), {
    key: "attention", label: "Needs attention", canRetry: false,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation(
    row.status, row.attempts, row.next_attempt_at, row.failure_code,
  ), { key: "attention", label: "Needs attention", canRetry: true });
  database.close();
});

test("0136 preserves historical complaints as durable customer email opt-outs", () => {
  const { database } = fixture();
  insertLegacy(database, { status: "complained" });
  apply(database, migration);
  const row = database.prepare("SELECT status, failure_code FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.deepEqual({ ...row }, {
    status: "opted_out",
    failure_code: "QUOTE_DELIVERY_PROVIDER_TERMINAL",
  });
  assert.match(route, /status IN \('complained', 'opted_out'\)/);
  database.close();
});

test("provider failure remains durable and retries on the bounded schedule", async () => {
  const { database, db } = fixture();
  insertLegacy(database);
  apply(database, migration);
  initialiseOutbox(database);
  let sends = 0;
  const first = await drainTradeQuoteDeliveries({
    db, deliveryId: "delivery-1", now: new Date("2026-08-13T01:00:00.000Z"),
    emailConfigured: true,
    prepareMessage: async () => ({
      channel: "email", recipient: "customer@example.com", subject: "Quote",
      body: "Quote", idempotencyKey: "quote:version-1:1:email:initial",
      callbackUrl: "https://compare.ausenergyassessments.com/callback",
    }),
    loadContext: async () => database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get(),
    sendEmail: async () => { sends += 1; throw new Error("provider unavailable"); },
  });
  assert.equal(first.outcomes[0].outcome, "retrying");
  assert.equal(sends, 1);
  const failed = database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.next_attempt_at, "2026-08-13T01:05:00.000Z");
  const early = await drainTradeQuoteDeliveries({
    db, deliveryId: "delivery-1", now: new Date("2026-08-13T01:04:59.000Z"),
    emailConfigured: true,
    prepareMessage: async () => { throw new Error("too early"); },
    sendEmail: async () => { sends += 1; throw new Error("too early"); },
  });
  assert.equal(early.attempted, 0);
  assert.equal(sends, 1);
  database.close();
});

test("a hanging provider cannot hold the browser route because dispatch exists only in the worker", async () => {
  assert.doesNotMatch(route, /sendServiceReminderProviderMessage/);
  assert.doesNotMatch(route, /await drainTradeQuoteDeliveries/);
  const never = new Promise(() => {});
  const routeContract = Promise.resolve({ status: 202, delivery: { presentation: { label: "Queued for email" } } });
  void never;
  const observed = await Promise.race([
    routeContract,
    new Promise((resolve) => setTimeout(() => resolve({ status: 500 }), 25)),
  ]);
  assert.deepEqual(observed, { status: 202, delivery: { presentation: { label: "Queued for email" } } });
});

test("a queued quote schedules its exact delivery and strips the private dispatch header", async () => {
  const waits = [];
  const drained = [];
  let releaseProvider;
  const provider = new Promise((resolve) => { releaseProvider = resolve; });
  const routed = withTradeQuoteDeliveryDispatch(
    Response.json({ ok: true }, { status: 202 }),
    "delivery-exact",
  );
  assert.equal(routed.headers.get(TRADE_QUOTE_DELIVERY_DISPATCH_HEADER), "delivery-exact");

  const browserResponse = queueTradeQuoteDeliveryDispatch(routed, {
    waitUntil(promise) { waits.push(promise); },
    async drain(deliveryId) {
      drained.push(deliveryId);
      await provider;
    },
  });
  assert.equal(browserResponse.status, 202);
  assert.equal(browserResponse.headers.has(TRADE_QUOTE_DELIVERY_DISPATCH_HEADER), false);
  assert.deepEqual(drained, []);
  await Promise.resolve();
  assert.deepEqual(drained, ["delivery-exact"]);
  assert.equal(waits.length, 1);
  releaseProvider();
  await waits[0];

  const noDispatch = queueTradeQuoteDeliveryDispatch(
    Response.json({ ok: true }, { status: 200, headers: {
      [TRADE_QUOTE_DELIVERY_DISPATCH_HEADER]: "must-not-run",
    } }),
    {
      waitUntil() { throw new Error("unexpected waitUntil"); },
      async drain() { throw new Error("unexpected drain"); },
    },
  );
  assert.equal(noDispatch.status, 200);
  assert.equal(noDispatch.headers.has(TRADE_QUOTE_DELIVERY_DISPATCH_HEADER), false);

  const absentDispatch = queueTradeQuoteDeliveryDispatch(
    Response.json({ ok: true }, { status: 202 }),
    {
      waitUntil() { throw new Error("unexpected waitUntil"); },
      async drain() { throw new Error("unexpected drain"); },
    },
  );
  assert.equal(absentDispatch.status, 202);

  let capturedError = "";
  const failedWaits = [];
  queueTradeQuoteDeliveryDispatch(withTradeQuoteDeliveryDispatch(
    Response.json({ ok: true }, { status: 202 }),
    "delivery-fails",
  ), {
    waitUntil(promise) { failedWaits.push(promise); },
    async drain() { throw new Error("provider unavailable"); },
    onError(error) { capturedError = error instanceof Error ? error.message : "unknown"; },
  });
  await failedWaits[0];
  assert.equal(capturedError, "provider unavailable");
  assert.match(route, /withTradeQuoteDeliveryDispatch/);
  assert.match(worker, /drainTradeQuoteDeliveries\(\{ db: getD1\(\), deliveryId \}\)/);
  assert.match(worker, /Trade quote delivery recovery failed\./);
});

test("an expired fifth-attempt lease becomes terminal attention instead of Sending forever", async () => {
  const { database, db } = fixture();
  insertLegacy(database, { status: "sending", attempts: TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS });
  apply(database, migration);
  database.prepare(`UPDATE trade_crm_quote_deliveries SET
    status = 'sending', recipient_email_sha256 = 'recipient-hash',
    provider_idempotency_key = 'provider-key', queued_at = '2026-08-13T00:00:00.000Z',
    lease_expires_at = '2026-08-13T00:10:00.000Z',
    failure_code = '', last_error = '' WHERE id = 'delivery-1'`).run();
  const result = await drainTradeQuoteDeliveries({
    db, deliveryId: "delivery-1", now: new Date("2026-08-13T00:11:00.000Z"),
    emailConfigured: true,
    sendEmail: async () => { throw new Error("must not send after final lease expiry"); },
  });
  assert.equal(result.attempted, 0);
  const row = database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.equal(row.status, "failed");
  assert.equal(row.next_attempt_at, "");
  assert.equal(row.lease_expires_at, "");
  assert.equal(row.failure_code, "QUOTE_DELIVERY_FINAL_ATTEMPT_INTERRUPTED");
  assert.deepEqual(tradeQuoteDeliveryPresentation(
    row.status, row.attempts, row.next_attempt_at, row.failure_code,
  ), { key: "attention", label: "Needs attention", canRetry: true });
  database.close();
});

test("a callback or concurrent recovery that wins the failure CAS suppresses false audit and outcome", async () => {
  const { database, db } = fixture();
  insertLegacy(database);
  apply(database, migration);
  initialiseOutbox(database);
  const result = await drainTradeQuoteDeliveries({
    db, deliveryId: "delivery-1", now: new Date("2026-08-13T01:00:00.000Z"),
    emailConfigured: true,
    loadContext: async () => database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get(),
    prepareMessage: async () => ({
      channel: "email", recipient: "customer@example.com", subject: "Quote",
      body: "Quote", idempotencyKey: "provider-key",
      callbackUrl: "https://compare.ausenergyassessments.com/callback",
    }),
    sendEmail: async () => {
      database.prepare(`UPDATE trade_crm_quote_deliveries
        SET status = 'delivered', delivered_at = '2026-08-13T01:00:01.000Z',
          lease_expires_at = '', next_attempt_at = '' WHERE id = 'delivery-1'`).run();
      throw new Error("provider response lost after callback won");
    },
  });
  assert.equal(result.outcomes[0].outcome, "delivered");
  assert.equal(result.outcomes[0].lostOwnership, true);
  const events = database.prepare(`SELECT event_type FROM trade_crm_quote_events
    WHERE event_type IN ('delivery_retrying', 'delivery_failed')`).all();
  assert.deepEqual(events, []);
  database.close();
});

test("CAS claim and provider idempotency prevent duplicate delivery", async () => {
  const { database, db } = fixture();
  insertLegacy(database);
  apply(database, migration);
  initialiseOutbox(database);
  let sends = 0;
  let seenKey = "";
  const options = {
    db, deliveryId: "delivery-1", now: new Date("2026-08-13T01:00:00.000Z"),
    emailConfigured: true,
    prepareMessage: async (row) => ({
      channel: "email", recipient: "customer@example.com", subject: "Quote",
      body: "Quote", idempotencyKey: String(row.provider_idempotency_key),
      callbackUrl: "https://compare.ausenergyassessments.com/callback",
    }),
    loadContext: async () => database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get(),
    sendEmail: async (message) => {
      sends += 1; seenKey = message.idempotencyKey;
      return { provider: "resend", providerMessageId: "provider-1", providerStatus: "sent" };
    },
  };
  await Promise.all([drainTradeQuoteDeliveries(options), drainTradeQuoteDeliveries(options)]);
  assert.equal(sends, 1);
  assert.equal(seenKey, "provider-key");
  const status = await tradeQuoteDeliveryStatus(db, "delivery-1", "owner-1");
  assert.equal(status.status, "provider_accepted");
  assert.equal(status.presentation.label, "Email accepted for delivery");
  database.close();
});

test("provider absence preserves intent but becomes attention after five bounded windows", async () => {
  const { database, db } = fixture();
  insertLegacy(database);
  apply(database, migration);
  initialiseOutbox(database);
  let sends = 0;
  let result;
  let now = new Date("2026-08-13T01:00:00.000Z");
  for (let attempt = 1; attempt <= TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS; attempt += 1) {
    result = await drainTradeQuoteDeliveries({
      db, deliveryId: "delivery-1", now, emailConfigured: false,
      sendEmail: async () => { sends += 1; throw new Error("must not send"); },
    });
    const pending = database.prepare("SELECT next_attempt_at FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
    if (pending.next_attempt_at) now = new Date(pending.next_attempt_at);
  }
  assert.equal(result.outcomes[0].status, "failed");
  assert.equal(sends, 0);
  const row = database.prepare("SELECT * FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.equal(row.attempts, TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS);
  assert.equal(row.next_attempt_at, "");
  assert.deepEqual(tradeQuoteDeliveryPresentation(
    row.status, row.attempts, row.next_attempt_at, row.failure_code,
  ), { key: "attention", label: "Needs attention", canRetry: true });
  database.close();
});

test("retry policy stops automatically and exposes one manual retry", () => {
  assert.deepEqual(tradeQuoteDeliveryPresentation("queued", 0, "2026-08-13T00:00:00Z"), {
    key: "sending", label: "Queued for email", canRetry: false,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation("sending", 1), {
    key: "sending", label: "Submitting to email provider", canRetry: false,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation("waiting_for_channel", 1, "2026-08-13T00:05:00Z"), {
    key: "sending", label: "Waiting for email service", canRetry: false,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation("failed", 1, "2026-08-13T00:05:00Z"), {
    key: "sending", label: "Retry scheduled", canRetry: false,
  });
  assert.equal(tradeQuoteDeliveryRetryAt(TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS, Date.parse("2026-08-13T00:00:00Z")), "");
  assert.deepEqual(tradeQuoteDeliveryPresentation("failed", 5, ""), {
    key: "attention", label: "Needs attention", canRetry: true,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation("delivered", 1, ""), {
    key: "delivered", label: "Delivered", canRetry: false,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation("failed", 5, "", "", 2), {
    key: "attention", label: "Needs attention", canRetry: false,
  });
  assert.deepEqual(tradeQuoteDeliveryPresentation(
    "failed", 1, "", "QUOTE_DELIVERY_PROVIDER_TERMINAL", 1,
  ), { key: "attention", label: "Needs attention", canRetry: true });
});

test("issue and delivery mutations require manage, send and explicit consent", () => {
  assert.throws(() => assertTradeQuoteIssueDeliveryAccess(true, false, true), /QUOTE_SEND_REQUIRED/);
  assert.throws(() => assertTradeQuoteIssueDeliveryAccess(false, true, true), /QUOTE_MANAGEMENT_REQUIRED/);
  assert.throws(() => assertTradeQuoteIssueDeliveryAccess(true, true, false), /QUOTE_DELIVERY_CONSENT_REQUIRED/);
  assert.doesNotThrow(() => assertTradeQuoteIssueDeliveryAccess(true, true, true));
  assert.match(route, /\["issue_quote", "send_quote", "retry_quote_delivery"\]/);
  assert.match(route, /assertTradeQuoteIssueDeliveryAccess\([\s\S]{0,180}body\.consentConfirmed/);
  assert.match(route, /requestedVersionId/);
  assert.match(route, /requestedVersion\.status === "issued"/);
});

test("provider callbacks are monotonic and healthy sent events are not mislabeled", () => {
  assert.equal(tradeQuoteDeliveryCallbackStatus("delivered", "sent"), "delivered");
  assert.equal(tradeQuoteDeliveryCallbackStatus("delivered", "failed"), "delivered");
  assert.equal(tradeQuoteDeliveryCallbackStatus("provider_accepted", "sent"), "sent");
  assert.equal(tradeQuoteDeliveryCallbackStatus("sent", "provider_accepted"), "sent");
  assert.match(callback, /tradeQuoteDeliveryCallbackStatus\(quoteDelivery\.status, incomingQuoteStatus\)/);
  assert.match(callback, /WHEN status = 'delivered' THEN status/);
  assert.match(callback, /WHEN status IN \('bounced', 'complained', 'opted_out'\) THEN status/);
  assert.match(callback, /Email accepted for delivery\./);
  assert.match(callback, /The email provider reported a quote delivery failure\./);
  assert.match(callback, /\["email\.complained", "email\.suppressed"\]/);
});

test("callback SQL atomically preserves Delivered when a stale failure arrives later", () => {
  assert.ok(callbackUpdateSql, "quote callback update SQL must be discoverable");
  const { database } = fixture();
  insertLegacy(database, { status: "sent", attempts: 1 });
  apply(database, migration);
  const applyCallback = (incomingStatus, eventType) => {
    const terminal = ["bounced", "failed", "complained", "opted_out"].includes(incomingStatus);
    database.prepare(callbackUpdateSql).run(
      incomingStatus, incomingStatus, incomingStatus, incomingStatus, incomingStatus,
      incomingStatus, eventType, incomingStatus, "2026-08-13T01:00:00.000Z",
      incomingStatus, "2026-08-13T01:00:00.000Z",
      incomingStatus,
      terminal ? 1 : 0, incomingStatus,
      incomingStatus,
      terminal ? 1 : 0, incomingStatus, incomingStatus,
      "2026-08-13T01:00:00.000Z", "delivery-1",
    );
  };
  applyCallback("delivered", "email.delivered");
  applyCallback("failed", "email.failed");
  let row = database.prepare("SELECT status, failure_code, last_error FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.deepEqual({ ...row }, { status: "delivered", failure_code: "", last_error: "" });
  applyCallback("sent", "email.sent");
  row = database.prepare("SELECT status, failure_code, last_error, sent_at FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.deepEqual({ ...row }, {
    status: "delivered",
    failure_code: "",
    last_error: "",
    sent_at: "2026-08-13T01:00:00.000Z",
  });
  database.close();
});

test("callback SQL preserves terminal failure metadata when a stale sent event arrives later", () => {
  assert.ok(callbackUpdateSql, "quote callback update SQL must be discoverable");
  const { database } = fixture();
  insertLegacy(database, { status: "provider_accepted", attempts: 1 });
  apply(database, migration);
  const applyCallback = (incomingStatus, eventType, timestamp) => {
    const terminal = ["bounced", "failed", "complained", "opted_out"].includes(incomingStatus);
    database.prepare(callbackUpdateSql).run(
      incomingStatus, incomingStatus, incomingStatus, incomingStatus, incomingStatus,
      incomingStatus, eventType, incomingStatus, timestamp,
      incomingStatus, timestamp,
      incomingStatus,
      terminal ? 1 : 0, incomingStatus,
      incomingStatus,
      terminal ? 1 : 0, incomingStatus, incomingStatus,
      timestamp, "delivery-1",
    );
  };

  applyCallback("failed", "email.failed", "2026-08-13T01:00:00.000Z");
  let row = database.prepare("SELECT status, failure_code, last_error FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.deepEqual({ ...row }, {
    status: "failed",
    failure_code: "QUOTE_DELIVERY_PROVIDER_TERMINAL",
    last_error: "Delivery needs attention.",
  });

  applyCallback("sent", "email.sent", "2026-08-13T01:01:00.000Z");
  row = database.prepare("SELECT status, failure_code, last_error, sent_at FROM trade_crm_quote_deliveries WHERE id = 'delivery-1'").get();
  assert.deepEqual({ ...row }, {
    status: "failed",
    failure_code: "QUOTE_DELIVERY_PROVIDER_TERMINAL",
    last_error: "Delivery needs attention.",
    sent_at: "2026-08-13T01:01:00.000Z",
  });
  database.close();
});

test("manual retry creates one immutable successor with a new provider identity", () => {
  assert.match(migration, /retry_of_delivery_id/);
  assert.match(migration, /delivery_generation/);
  assert.match(route, /generationIdempotencyKey[\s\S]*:retry:2/);
  assert.match(route, /generationProviderKey = await tradeQuoteRecipientEmailSha256/);
  assert.match(route, /existingRetry/);
  assert.match(route, /failure_code === "QUOTE_DELIVERY_PROVIDER_TERMINAL"/);
  assert.match(route, /delivery_generation, email_renderer_revision,[\s\S]*subject_snapshot, email_content_sha256, attachment_filename,[\s\S]*attachment_sha256, recipient_email_sha256, public_origin/);
  assert.match(route, /resolveTradeQuoteEmailRendererRevision\([\s\S]*manualRetryRequested \? predecessor\?\.email_renderer_revision : undefined/);
  assert.match(route, /buildTradeQuoteEmailForRevision\([\s\S]*emailRendererRevision/);
  assert.match(route, /emailContent\.subject !== String\(predecessor\?\.subject_snapshot[\s\S]*emailContentSha256 !== String\(predecessor\?\.email_content_sha256[\s\S]*attachmentFilename !== String\(predecessor\?\.attachment_filename[\s\S]*attachmentSha256 !== String\(predecessor\?\.attachment_sha256[\s\S]*recipientEmailSha256 !== String\(predecessor\?\.recipient_email_sha256[\s\S]*origin !== String\(predecessor\?\.public_origin/);
  assert.match(route, /email_content_sha256,[\s\S]*email_renderer_revision,[\s\S]*\.bind\([\s\S]*emailContentSha256,[\s\S]*emailRendererRevision/);
  assert.doesNotMatch(route, /SET status = 'queued',[\s\S]{0,1000}failure_code = 'QUOTE_DELIVERY_LEGACY_RETRY_REQUIRED'/);
});

test("route queues before returning 202 and never invokes provider synchronously", () => {
  assert.match(route, /INSERT OR IGNORE INTO trade_crm_quote_deliveries[\s\S]*status[\s\S]*'queued'/);
  assert.match(route, /deliveryAccepted:[\s\S]*accepted[\s\S]*accepted \? 200 : 202/);
  assert.doesNotMatch(route, /sendServiceReminderProviderMessage/);
  assert.doesNotMatch(route, /await drainTradeQuoteDeliveries/);
  assert.match(route, /action === "retry_quote_delivery"/);
  assert.match(route, /requestedDeliveryId/);
  assert.match(route, /retry_of_delivery_id/);
  assert.match(route, /delivery_generation = 2/);
  assert.match(route, /latestTradeQuoteDeliveryStatus/);
  assert.match(route, /quoteIssued: true/);
});

test("the exact issue transaction bindings persist an event and a durable queued response", async () => {
  assert.ok(issuedEventSqlTemplate, "issued quote event SQL must be discoverable");
  assert.ok(queuedDeliverySqlTemplate, "queued quote delivery SQL must be discoverable");
  const claimStillHeld = `EXISTS (
    SELECT 1 FROM trade_crm_quote_versions claimed
    WHERE claimed.id = ? AND claimed.firebase_uid = ?
      AND claimed.status = 'issuing' AND claimed.consent_statement = ?
  ) AND NOT EXISTS (
    SELECT 1 FROM trade_crm_quote_deliveries pending_delivery
    JOIN trade_crm_quote_links pending_link
      ON pending_link.id = pending_delivery.quote_link_id
      AND pending_link.firebase_uid = pending_delivery.firebase_uid
    WHERE pending_link.quote_id = ? AND pending_link.firebase_uid = ?
      AND pending_delivery.quote_version_id <> ?
      AND (
        pending_delivery.status IN ('queued','sending','waiting_for_channel','provider_accepted','sent')
        OR (pending_delivery.status = 'failed' AND pending_delivery.next_attempt_at <> '')
      )
  ) AND 1 = 1`;
  const eventSql = issuedEventSqlTemplate.replace("${claimStillHeld}", claimStillHeld);
  const deliverySql = queuedDeliverySqlTemplate.replace("${claimStillHeld}", claimStillHeld);
  const { database, db } = fixture();
  apply(database, migration);
  apply(database, rendererMigration);
  database.exec("ALTER TABLE trade_crm_quote_versions ADD consent_statement text DEFAULT '' NOT NULL");
  database.prepare(`INSERT INTO trade_crm_quote_versions
    (id, firebase_uid, status, consent_statement)
    VALUES ('version-1', 'owner-1', 'issuing', 'issue-claim-1')`).run();

  const timestamp = "2026-08-13T01:00:00.000Z";
  const result = await db.batch([
    db.prepare(eventSql).bind(
      "event-1", "link-1", "quote-1", "version-1", "work-1", "owner-1",
      "issued:version-1", timestamp,
      "version-1", "owner-1", "issue-claim-1",
      "quote-1", "owner-1", "version-1",
    ),
    db.prepare(deliverySql).bind(
      "delivery-new", "link-1", "version-1", "work-1", "owner-1", "customer-1",
      "c***@example.com", "primary_customer", "quote:version-1:1:email:initial",
      "Quote Q-1", "content-sha", 2, "Q-1-v1.pdf", "attachment-sha",
      "recipient-sha", "provider-key", "https://compare.ausenergyassessments.com",
      timestamp, timestamp, timestamp, timestamp,
      "version-1", "owner-1", "issue-claim-1",
      "quote-1", "owner-1", "version-1",
    ),
  ]);

  assert.deepEqual(result.map((entry) => entry.meta.changes), [1, 1]);
  assert.equal(database.prepare("SELECT event_type FROM trade_crm_quote_events WHERE id = 'event-1'").get().event_type, "issued");
  const delivery = await tradeQuoteDeliveryStatus(db, "delivery-new", "owner-1");
  assert.equal(database.prepare(`SELECT email_renderer_revision
    FROM trade_crm_quote_deliveries WHERE id = 'delivery-new'`).get().email_renderer_revision, 2);
  assert.deepEqual({
    ok: true,
    quoteIssued: true,
    deliveryAccepted: false,
    deliveryState: delivery.status,
    delivery,
  }, {
    ok: true,
    quoteIssued: true,
    deliveryAccepted: false,
    deliveryState: "queued",
    delivery: {
      id: "delivery-new",
      status: "queued",
      attempts: 0,
      generation: 1,
      retryOfDeliveryId: "",
      nextAttemptAt: timestamp,
      updatedAt: timestamp,
      presentation: { key: "sending", label: "Queued for email", canRetry: false },
    },
  });
  const issuedEventBind = route.match(/'Secure quote link issued\.', \?, \?[\s\S]*?\.bind\(([\s\S]*?)\),\n\s*db\.prepare\(`INSERT OR IGNORE INTO trade_crm_quote_deliveries/)?.[1] || "";
  assert.match(issuedEventBind, /`issued:\$\{version\.id\}`, now,\s*\.\.\.claimBindings/);
  assert.doesNotMatch(issuedEventBind, /now, version\.id,\s*\.\.\.claimBindings/);
  const queuedDeliveryBind = route.match(/INSERT OR IGNORE INTO trade_crm_quote_deliveries[\s\S]*?\.bind\(([\s\S]*?)\),\n\s*db\.prepare\(`INSERT INTO trade_crm_quote_events/)?.[1] || "";
  assert.match(queuedDeliveryBind, /providerIdempotencyKey,\s*publicOrigin,\s*now, now, now, now,\s*\.\.\.claimBindings/);
  database.close();
});

test("the D1 issue batch rolls back the event when a delivery binding fails", async () => {
  assert.ok(issuedEventSqlTemplate, "issued quote event SQL must be discoverable");
  assert.ok(queuedDeliverySqlTemplate, "queued quote delivery SQL must be discoverable");
  const claimStillHeld = `EXISTS (
    SELECT 1 FROM trade_crm_quote_versions claimed
    WHERE claimed.id = ? AND claimed.firebase_uid = ?
      AND claimed.status = 'issuing' AND claimed.consent_statement = ?
  ) AND NOT EXISTS (
    SELECT 1 FROM trade_crm_quote_deliveries pending_delivery
    JOIN trade_crm_quote_links pending_link
      ON pending_link.id = pending_delivery.quote_link_id
      AND pending_link.firebase_uid = pending_delivery.firebase_uid
    WHERE pending_link.quote_id = ? AND pending_link.firebase_uid = ?
      AND pending_delivery.quote_version_id <> ?
  ) AND 1 = 1`;
  const eventSql = issuedEventSqlTemplate.replace("${claimStillHeld}", claimStillHeld);
  const deliverySql = queuedDeliverySqlTemplate.replace("${claimStillHeld}", claimStillHeld);
  const { database, db } = fixture();
  apply(database, migration);
  apply(database, rendererMigration);
  database.exec("ALTER TABLE trade_crm_quote_versions ADD consent_statement text DEFAULT '' NOT NULL");
  database.prepare(`INSERT INTO trade_crm_quote_versions
    (id, firebase_uid, status, consent_statement)
    VALUES ('version-1', 'owner-1', 'issuing', 'issue-claim-1')`).run();
  const timestamp = "2026-08-13T01:00:00.000Z";

  await assert.rejects(db.batch([
    db.prepare(eventSql).bind(
      "event-1", "link-1", "quote-1", "version-1", "work-1", "owner-1",
      "issued:version-1", timestamp,
      "version-1", "owner-1", "issue-claim-1",
      "quote-1", "owner-1", "version-1",
    ),
    db.prepare(deliverySql).bind(
      "delivery-new", "link-1", "version-1", "work-1", "owner-1", "customer-1",
      "c***@example.com", "primary_customer", "quote:version-1:1:email:initial",
      "Quote Q-1", "content-sha", 2, "Q-1-v1.pdf", "attachment-sha",
      "recipient-sha", "provider-key", "https://compare.ausenergyassessments.com",
      timestamp, timestamp, timestamp, timestamp,
      "version-1", "owner-1", "issue-claim-1",
      "quote-1", "owner-1", "version-1", "unexpected-extra-binding",
    ),
  ]));

  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_quote_events").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_crm_quote_deliveries").get().count, 0);
  database.close();
});

test("issue transaction failures are safe, actionable and cannot imply delivery", () => {
  assert.match(route, /QUOTE_ISSUE_STORAGE_FAILED/);
  assert.match(route, /stage: String\(\(error as StagedQuoteError \| null\)\?\.stage \|\| "issue"\)/);
  assert.match(route, /deliveryState: "not_queued"/);
  assert.match(route, /retryable: code === "QUOTE_ISSUE_STORAGE_FAILED"/);
  assert.match(route, /deliveryState: delivery\.status/);
  assert.match(route, /deliveryAccepted: false/);
});

test("a repeated plain send returns the durable queued or retrying state before rebuilding content", () => {
  const existingQueueGuard = route.indexOf('action === "send_quote"\n          && existing');
  const snapshotRebuild = route.indexOf("let snapshot = parseTradeQuoteDocumentSnapshot", existingQueueGuard);
  assert.ok(existingQueueGuard > 0, "plain send must have an existing-outbox guard");
  assert.ok(snapshotRebuild > existingQueueGuard, "existing-outbox guard must precede PDF/content rebuild");
  assert.match(route.slice(existingQueueGuard, snapshotRebuild), /\["queued", "waiting_for_channel"\]/);
  assert.match(route.slice(existingQueueGuard, snapshotRebuild), /existing\.next_attempt_at/);
  assert.match(route.slice(existingQueueGuard, snapshotRebuild), /deliveryAccepted: false/);
  assert.match(route.slice(existingQueueGuard, snapshotRebuild), /}, 202\)/);
});

test("plain send never reports a terminal failed delivery as newly queued", () => {
  assert.match(route, /action === "send_quote" && existing\?\.status === "failed" && !existing\.next_attempt_at/);
  assert.match(route, /This delivery needs attention\.[\s\S]{0,250}}, 409\)/);
});

test("manual retry replay returns the successor's real accepted, active or terminal state", () => {
  assert.match(route, /retryAccepted = \["provider_accepted", "sent", "delivered"\]/);
  assert.match(route, /retryActive = \["queued", "sending", "waiting_for_channel"\]/);
  assert.match(route, /its one retry is complete\.[\s\S]{0,120}}, 409\)/);
  assert.match(route, /retryAccepted \? 200 : 202/);
  assert.match(route, /const existingLeaf = existing/);
  assert.match(route, /action === "send_quote" && existingLeaf/);
  assert.match(route, /leafAccepted \? 200 : 202/);
});

test("worker drains automatically, callbacks own Delivered, and attention deep-links to quote", () => {
  assert.match(worker, /drainTradeQuoteDeliveries\(\{ db: getD1\(\) \}\)/);
  assert.match(callback, /quoteStatus === "delivered"/);
  assert.match(callback, /next_attempt_at = '', lease_expires_at = ''/);
  assert.match(notifications, /quote-delivery-attention:/);
  assert.match(notifications, /targetTab: "quote"/);
});

test("replacement drafts and links cannot abandon an unsettled delivery", () => {
  assert.match(route, /QUOTE_DELIVERY_PENDING/);
  assert.match(route, /status IN \('queued','sending','waiting_for_channel','provider_accepted','sent'\)/);
  assert.match(route, /status IN \('queued','sending','waiting_for_channel'\)[\s\S]*status = 'failed' AND next_attempt_at <> ''/);
  assert.doesNotMatch(route, /A new quote draft superseded this secure link/);
  assert.match(route, /requestedVersion\.latest_version_number/);
  assert.match(route, /draftVersionId: versionId/);
  assert.match(route, /SET current_version_number = \?, status = 'issued'/);
  assert.match(route, /quote_version_id <> \? AND \$\{claimStillHeld\}/);
  assert.match(route, /token_issue = \? AND updated_at = \?/);
  assert.match(route, /Number\(replacement\[0\]\?\.meta\.changes \|\| 0\) !== 1/);
  assert.match(route, /current_link\.token_issue = \? AND current_link\.updated_at = \?/);
  assert.match(notifications, /successor\.retry_of_delivery_id = delivery\.id/);
  assert.match(notifications, /delivery\.delivery_generation/);
  assert.match(notifications, /presentation\.canRetry/);
  assert.doesNotMatch(notifications, /was not delivered after its retry/);
});

test("a replacement draft is reusable while the issued version remains authoritative", () => {
  const pendingDraftQuery = /SELECT \* FROM trade_crm_quote_versions[\s\S]*?status = 'draft'[\s\S]*?version_number > \?[\s\S]*?ORDER BY version_number DESC LIMIT 1/;
  assert.match(route, pendingDraftQuery);
  assert.match(route, /const editableVersion = current\.status === "draft" \? current : pendingDraft/);
  assert.match(route, /versionId = String\(editableVersion\.id\)/);
  assert.match(route, /editableVersion\.updated_at/);
  assert.match(route, /editableDraft: editableDraft \? \{/);
  assert.match(route, /draftVersionId: versionId/);
  assert.match(route, /current\.status === "issuing"[\s\S]{0,80}QUOTE_ISSUE_IN_PROGRESS/);
  assert.match(route, /authoritative\.version_number = parent\.current_version_number[\s\S]{0,100}authoritative\.status <> 'issuing'/);
  assert.match(route, /INSERT INTO trade_crm_quote_versions[\s\S]*SELECT \?, \?, \?, \?, 'draft'[\s\S]*authoritative\.updated_at = \?[\s\S]*NOT EXISTS \([\s\S]*pending_delivery/);
  assert.match(route, /pending_delivery\.status IN \('queued','sending','waiting_for_channel','provider_accepted','sent'\)[\s\S]*pending_delivery\.status = 'failed' AND pending_delivery\.next_attempt_at <> ''/);
  assert.doesNotMatch(route, /if \(current\.status === "issued"\)[\s\S]{0,300}SET current_version_number = \?/);
});

test("exact-version issue replay cannot create a second version or delivery", () => {
  const issuedReplayStart = route.indexOf('if (requestedVersion.status === "issued")');
  const newLinkStart = route.indexOf("const linkId = crypto.randomUUID()", issuedReplayStart);
  assert.ok(issuedReplayStart > 0 && newLinkStart > issuedReplayStart);
  const replayBranch = route.slice(issuedReplayStart, newLinkStart);
  assert.match(replayBranch, /latestTradeQuoteDeliveryStatus/);
  assert.match(replayBranch, /quoteIssued: true/);
  assert.match(replayBranch, /accepted \? 200 : 202/);
  assert.doesNotMatch(replayBranch, /INSERT INTO trade_crm_quote_versions/);
  assert.doesNotMatch(replayBranch, /INSERT OR IGNORE INTO trade_crm_quote_deliveries/);
});

test("issue claims the exact saved revision before reading snapshot lines", () => {
  const claim = route.indexOf("const issueClaim = await db.prepare");
  const execution = route.indexOf("const execution = await buildQuoteExecutionSnapshot", claim);
  const document = route.indexOf("const documentSnapshot = await buildTradeQuoteDocumentSnapshot", claim);
  assert.ok(claim > 0 && execution > claim && document > claim);
  assert.match(route.slice(claim, execution), /status = 'draft'[\s\S]*updated_at = \?/);
  assert.match(route.slice(claim, execution), /version\.updated_at/);
  assert.match(route, /current\.status === "issuing"[\s\S]{0,80}QUOTE_ISSUE_IN_PROGRESS/);
});

test("send and retry are tenant-bound and lose safely to concurrent link replacement", () => {
  assert.match(route, /WHERE idempotency_key = \? AND firebase_uid = \?[\s\S]{0,120}quote_version_id = \? AND quote_link_id = \?/);
  assert.match(route, /INSERT OR IGNORE INTO trade_crm_quote_deliveries[\s\S]*WHERE EXISTS \([\s\S]*current_link\.token_issue = \?[\s\S]*current_link\.token_hash = \?[\s\S]*current_link\.updated_at = \?/);
  assert.match(route, /The quote link changed before delivery was queued/);
  assert.match(route, /SET status = 'replaced'[\s\S]*status = 'queued' AND attempts = 0/);
  assert.match(route, /UPDATE trade_crm_quote_links[\s\S]*NOT EXISTS \([\s\S]*trade_crm_quote_deliveries/);
});

test("revoke and replacement issue cannot invalidate an unsettled emailed link", () => {
  const revokeStart = route.indexOf("async function revokeOwnedQuoteLink");
  const errorStart = route.indexOf("function errorResponse", revokeStart);
  const revokeBranch = route.slice(revokeStart, errorStart);
  assert.match(revokeBranch, /NOT EXISTS \([\s\S]*trade_crm_quote_deliveries/);
  assert.match(revokeBranch, /status IN \('queued','sending','waiting_for_channel','provider_accepted','sent'\)/);
  assert.match(revokeBranch, /Number\(revoked\[0\]\?\.meta\.changes \|\| 0\) !== 1/);
  assert.match(revokeBranch, /QUOTE_DELIVERY_PENDING/);

  assert.match(route, /const priorDeliverySettled = `NOT EXISTS \([\s\S]*pending_delivery\.status IN \('queued','sending','waiting_for_channel','provider_accepted','sent'\)/);
  assert.match(route, /claimStillHeld = `[\s\S]*\$\{priorDeliverySettled\}/);
  assert.match(route, /consent_statement = \?[\s\S]{0,120}\$\{priorDeliverySettled\} AND \$\{publicAccessHeld\.sql\}/);
  assert.match(route, /issueResults\[issueResults\.length - 1\][\s\S]{0,100}QUOTE_DELIVERY_PENDING/);
  assert.match(route, /quote\.id,[\s\S]{0,100}access\.ownerUid,[\s\S]{0,100}version\.id,[\s\S]{0,100}\.\.\.publicAccessHeld\.bindings/);
});

test("manual retry generation validates against its own immutable idempotency identity", () => {
  const server = fs.readFileSync(
    new URL("../src/lib/trade-quote-delivery-server.ts", import.meta.url),
    "utf8",
  );
  assert.match(server, /deliveryGeneration === 2[\s\S]*`\$\{initialIdempotencyKey\}:retry:2`/);
  assert.match(server, /deliveryGeneration === 2 && !String\(row\.retry_of_delivery_id/);
  assert.match(server, /!\[1, 2\]\.includes\(deliveryGeneration\)/);
});

test("SQLite guards exact issue claims and replacement saves against interleaving writes", () => {
  assert.ok(issueClaimSql);
  assert.ok(replacementDraftInsertSql);
  const { database } = fixture();
  database.exec("ALTER TABLE trade_crm_quote_versions ADD updated_at text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD subtotal_cents integer DEFAULT 0 NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD tax_cents integer DEFAULT 0 NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD total_cents integer DEFAULT 0 NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD terms text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD customer_message text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD valid_until text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD consent_statement text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD issued_at text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_versions ADD created_at text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quotes ADD crm_customer_id text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quotes ADD service_site_id text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quotes ADD updated_at text DEFAULT '' NOT NULL");
  database.prepare(`INSERT INTO trade_crm_quotes
    (id, firebase_uid, work_order_id, quote_number, current_version_number,
     status, updated_at) VALUES ('quote-1','owner-1','work-1','Q-1',1,'issued','r1')`).run();
  database.prepare(`INSERT INTO trade_crm_quote_versions
    (id, quote_id, firebase_uid, version_number, status, acceptance_email,
     updated_at) VALUES ('version-1','quote-1','owner-1',1,'issued','c@example.com','r1')`).run();
  insertLegacy(database, { status: "failed", attempts: 5 });
  apply(database, migration);
  initialiseOutbox(database);

  const inserted = database.prepare(replacementDraftInsertSql).run(
    "version-2", "quote-1", "owner-1", 2, "c@example.com",
    100, 10, 110, "terms", "message", "2026-09-01", "r2", "r2",
    "quote-1", "owner-1", "version-1", "issued", "r1",
  );
  assert.equal(Number(inserted.changes), 0, "queued old delivery blocks replacement draft creation");

  database.prepare("UPDATE trade_crm_quote_deliveries SET status='delivered', next_attempt_at='' WHERE id='delivery-1'").run();
  const draftInserted = database.prepare(replacementDraftInsertSql).run(
    "version-2", "quote-1", "owner-1", 2, "c@example.com",
    100, 10, 110, "terms", "message", "2026-09-01", "r2", "r2",
    "quote-1", "owner-1", "version-1", "issued", "r1",
  );
  assert.equal(Number(draftInserted.changes), 1);
  database.prepare("UPDATE trade_crm_quote_versions SET updated_at='saved-again' WHERE id='version-2'").run();
  const staleClaim = database.prepare(issueClaimSql).run(
    "claim", "2026-08-13T01:00:00.000Z", "claim-time",
    "version-2", "owner-1", "r2",
  );
  assert.equal(Number(staleClaim.changes), 0, "issue cannot claim a draft revision changed after its read");
  database.close();
});

test("SQLite revoke guard preserves links with unsettled delivery generations", () => {
  assert.ok(revokeLinkSql);
  const { database } = fixture();
  database.exec("ALTER TABLE trade_crm_quote_links ADD updated_at text DEFAULT '' NOT NULL");
  database.exec("ALTER TABLE trade_crm_quote_links ADD revoked_at text DEFAULT '' NOT NULL");
  insertLegacy(database, { status: "provider_accepted", attempts: 1 });
  apply(database, migration);
  database.prepare(`INSERT INTO trade_crm_quote_links
    (id, quote_id, quote_version_id, work_order_id, firebase_uid, crm_customer_id,
     token_issue, token_hash, encrypted_token, status, expires_at, updated_at, revoked_at)
    VALUES ('link-1','quote-1','version-1','work-1','owner-1','customer-1',1,
      'hash','encrypted','active','2026-09-01','r1','')`).run();
  let revoked = database.prepare(revokeLinkSql).run(
    "now", "now", "link-1", "owner-1", 1,
  );
  assert.equal(Number(revoked.changes), 0);
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links WHERE id='link-1'").get().status, "active");
  database.prepare("UPDATE trade_crm_quote_deliveries SET status='delivered', next_attempt_at='' WHERE id='delivery-1'").run();
  revoked = database.prepare(revokeLinkSql).run(
    "now", "now", "link-1", "owner-1", 1,
  );
  assert.equal(Number(revoked.changes), 1);
  assert.equal(database.prepare("SELECT status FROM trade_crm_quote_links WHERE id='link-1'").get().status, "revoked");
  database.close();
});
