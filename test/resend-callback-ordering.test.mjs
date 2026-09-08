import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const callbackSource = fs.readFileSync(
  new URL(
    "../src/app/api/service-reminder-provider-events/resend/route.ts",
    import.meta.url,
  ),
  "utf8",
);

function callbackUpdateSql(table) {
  const match = callbackSource.match(
    new RegExp(
      String.raw`db\.prepare\(\`(UPDATE ${table}[\s\S]*?updated_at = \? WHERE id = \?)\`\)\s*\.bind\(`,
    ),
  );
  assert.ok(match, `${table} callback update SQL must remain identifiable`);
  return match[1];
}

function scheduledDocumentCallbackUpdateSql() {
  const match = callbackSource.match(
    /db\.prepare\(`(UPDATE trade_activity_customer_document_deliveries[\s\S]*?WHERE id = \? AND provider = 'resend' AND provider_message_id = \?)`\)\s*\.bind\(/,
  );
  assert.ok(match, "scheduled customer-document callback update SQL must remain identifiable");
  return match[1];
}

function scheduledDocumentSuppressionUpdateSql() {
  const match = callbackSource.match(
    /db\.prepare\(`(UPDATE trade_activity_customer_document_deliveries\s+SET status = 'suppressed'[\s\S]*?status IN \('queued','sending','provider_accepted','sent','delivered'\))`\)\s*\.bind\(/,
  );
  assert.ok(match, "scheduled customer-document recipient suppression SQL must remain identifiable");
  return match[1];
}

function scheduledDocumentSuppressionEscalationSql() {
  const match = callbackSource.match(
    /db\.prepare\(`(UPDATE trade_activity_customer_document_deliveries\s+SET status = \?, provider_status = \?[\s\S]*?status IN \('failed','bounced'\))`\)\s*\.bind\(/,
  );
  assert.ok(match, "scheduled customer-document complaint escalation SQL must remain identifiable");
  return match[1];
}

function deliveryDatabase(table) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE ${table} (
    id text PRIMARY KEY NOT NULL,
    status text NOT NULL,
    provider_status text NOT NULL DEFAULT '',
    delivered_at text NOT NULL DEFAULT '',
    failed_at text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT '',
    updated_at text NOT NULL
  )`);
  return db;
}

function applyProviderEvent(update, {
  id,
  incoming,
  eventType,
  occurredAt,
  terminal,
}) {
  update.run(
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    incoming,
    eventType,
    incoming,
    occurredAt,
    terminal ? 1 : 0,
    occurredAt,
    terminal ? 1 : 0,
    eventType,
    incoming,
    occurredAt,
    id,
  );
}

function applyScheduledDocumentProviderEvent(update, {
  id,
  providerMessageId,
  incoming,
  eventType,
  occurredAt,
  terminal,
}) {
  update.run(
    incoming,
    incoming,
    incoming,
    incoming,
    eventType,
    incoming,
    occurredAt,
    incoming,
    occurredAt,
    terminal ? 1 : 0,
    occurredAt,
    terminal ? 1 : 0,
    `Customer document delivery invalidated by ${eventType}.`,
    incoming,
    occurredAt,
    id,
    providerMessageId,
  );
}

test("authenticated mapped callbacks retry until their provider message binding is visible", () => {
  assert.match(
    callbackSource,
    /if \(!providerMessageId \|\| !status\) return Response\.json\(\{ ok: true, ignored: true \}\)/,
    "unmapped or malformed provider events should remain safely ignored",
  );
  assert.match(
    callbackSource,
    /if \(!delivery\) \{[\s\S]*?retryable: true,[\s\S]*?status: 503,[\s\S]*?"Retry-After": "5"[\s\S]*?\n  \}/,
    "a verified event that arrives before its delivery binding must receive a retryable response",
  );
  assert.doesNotMatch(
    callbackSource,
    /if \(!delivery\) return Response\.json\(\{ ok: true, ignored: true \}\)/,
    "the callback must not acknowledge and lose an event before provider_message_id is persisted",
  );
});

for (const table of [
  "trade_opportunity_notification_deliveries",
  "customer_project_activity_deliveries",
]) {
  test(`${table} preserves provider failure when delivered arrives out of order`, () => {
    const db = deliveryDatabase(table);
    const initialAt = "2026-07-31T00:00:00.000Z";
    const failedAt = "2026-07-31T00:01:00.000Z";
    const deliveredAt = "2026-07-31T00:02:00.000Z";
    db.prepare(`INSERT INTO ${table}
      (id, status, provider_status, delivered_at, failed_at, last_error, updated_at)
      VALUES (?, 'sent', 'email.sent', '', '', '', ?)`)
      .run("delivery-1", initialAt);

    const update = db.prepare(callbackUpdateSql(table));
    applyProviderEvent(update, {
      id: "delivery-1",
      incoming: "provider_failed",
      eventType: "email.failed",
      occurredAt: failedAt,
      terminal: true,
    });
    applyProviderEvent(update, {
      id: "delivery-1",
      incoming: "delivered",
      eventType: "email.delivered",
      occurredAt: deliveredAt,
      terminal: false,
    });

    assert.deepEqual(
      {
        ...db.prepare(`SELECT status, provider_status, delivered_at, failed_at, last_error
          FROM ${table} WHERE id = ?`).get("delivery-1"),
      },
      {
        status: "provider_failed",
        provider_status: "email.failed",
        delivered_at: "",
        failed_at: failedAt,
        last_error: "email.failed",
      },
    );
    db.close();
  });

  test(`${table} preserves delivery when failure arrives out of order`, () => {
    const db = deliveryDatabase(table);
    const initialAt = "2026-07-31T00:00:00.000Z";
    const deliveredAt = "2026-07-31T00:01:00.000Z";
    const failedAt = "2026-07-31T00:02:00.000Z";
    db.prepare(`INSERT INTO ${table}
      (id, status, provider_status, delivered_at, failed_at, last_error, updated_at)
      VALUES (?, 'sent', 'email.sent', '', '', '', ?)`)
      .run("delivery-1", initialAt);

    const update = db.prepare(callbackUpdateSql(table));
    applyProviderEvent(update, {
      id: "delivery-1",
      incoming: "delivered",
      eventType: "email.delivered",
      occurredAt: deliveredAt,
      terminal: false,
    });
    applyProviderEvent(update, {
      id: "delivery-1",
      incoming: "provider_failed",
      eventType: "email.failed",
      occurredAt: failedAt,
      terminal: true,
    });

    assert.deepEqual(
      {
        ...db.prepare(`SELECT status, provider_status, delivered_at, failed_at, last_error
          FROM ${table} WHERE id = ?`).get("delivery-1"),
      },
      {
        status: "delivered",
        provider_status: "email.delivered",
        delivered_at: deliveredAt,
        failed_at: "",
        last_error: "",
      },
    );
    db.close();
  });

  test(`${table} allows a hard bounce to supersede a provider failure`, () => {
    const db = deliveryDatabase(table);
    const initialAt = "2026-07-31T00:00:00.000Z";
    const failedAt = "2026-07-31T00:01:00.000Z";
    const bouncedAt = "2026-07-31T00:02:00.000Z";
    db.prepare(`INSERT INTO ${table}
      (id, status, provider_status, delivered_at, failed_at, last_error, updated_at)
      VALUES (?, 'sent', 'email.sent', '', '', '', ?)`)
      .run("delivery-1", initialAt);

    const update = db.prepare(callbackUpdateSql(table));
    applyProviderEvent(update, {
      id: "delivery-1",
      incoming: "provider_failed",
      eventType: "email.failed",
      occurredAt: failedAt,
      terminal: true,
    });
    applyProviderEvent(update, {
      id: "delivery-1",
      incoming: "bounced",
      eventType: "email.bounced",
      occurredAt: bouncedAt,
      terminal: true,
    });

    assert.deepEqual(
      {
        ...db.prepare(`SELECT status, provider_status, delivered_at, failed_at, last_error
          FROM ${table} WHERE id = ?`).get("delivery-1"),
      },
      {
        status: "bounced",
        provider_status: "email.bounced",
        delivered_at: "",
        failed_at: bouncedAt,
        last_error: "email.bounced",
      },
    );
    db.close();
  });
}

test("scheduled customer documents are invalidated when a bounce follows delivery", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_activity_customer_document_deliveries (
    id text PRIMARY KEY NOT NULL,
    provider text NOT NULL,
    provider_message_id text NOT NULL,
    status text NOT NULL,
    provider_status text NOT NULL DEFAULT '',
    sent_at text NOT NULL DEFAULT '',
    delivered_at text NOT NULL DEFAULT '',
    failed_at text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT '',
    updated_at text NOT NULL
  )`);
  const acceptedAt = "2026-09-08T00:00:00.000Z";
  const deliveredAt = "2026-09-08T00:01:00.000Z";
  const bouncedAt = "2026-09-08T00:02:00.000Z";
  db.prepare(`INSERT INTO trade_activity_customer_document_deliveries
    (id, provider, provider_message_id, status, provider_status, sent_at, updated_at)
    VALUES (?, 'resend', ?, 'provider_accepted', 'sent', ?, ?)`).run(
    "delivery-1",
    "provider-1",
    acceptedAt,
    acceptedAt,
  );
  const update = db.prepare(scheduledDocumentCallbackUpdateSql());
  applyScheduledDocumentProviderEvent(update, {
    id: "delivery-1",
    providerMessageId: "provider-1",
    incoming: "delivered",
    eventType: "email.delivered",
    occurredAt: deliveredAt,
    terminal: false,
  });
  applyScheduledDocumentProviderEvent(update, {
    id: "delivery-1",
    providerMessageId: "provider-1",
    incoming: "bounced",
    eventType: "email.bounced",
    occurredAt: bouncedAt,
    terminal: true,
  });
  assert.deepEqual({ ...db.prepare(`SELECT status, provider_status, delivered_at, failed_at, last_error
    FROM trade_activity_customer_document_deliveries WHERE id = ?`).get("delivery-1") }, {
    status: "bounced",
    provider_status: "email.bounced",
    delivered_at: deliveredAt,
    failed_at: bouncedAt,
    last_error: "Customer document delivery invalidated by email.bounced.",
  });
  db.close();
});

test("scheduled customer-document terminal status cannot be restored by a late delivered event", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_activity_customer_document_deliveries (
    id text PRIMARY KEY NOT NULL,
    provider text NOT NULL,
    provider_message_id text NOT NULL,
    status text NOT NULL,
    provider_status text NOT NULL DEFAULT '',
    sent_at text NOT NULL DEFAULT '',
    delivered_at text NOT NULL DEFAULT '',
    failed_at text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT '',
    updated_at text NOT NULL
  )`);
  const bouncedAt = "2026-09-08T00:01:00.000Z";
  const lateDeliveredAt = "2026-09-08T00:02:00.000Z";
  db.prepare(`INSERT INTO trade_activity_customer_document_deliveries
    (id, provider, provider_message_id, status, provider_status, failed_at, last_error, updated_at)
    VALUES (?, 'resend', ?, 'bounced', 'email.bounced', ?, 'Customer document delivery invalidated by email.bounced.', ?)`).run(
    "delivery-1",
    "provider-1",
    bouncedAt,
    bouncedAt,
  );
  const update = db.prepare(scheduledDocumentCallbackUpdateSql());
  applyScheduledDocumentProviderEvent(update, {
    id: "delivery-1",
    providerMessageId: "provider-1",
    incoming: "delivered",
    eventType: "email.delivered",
    occurredAt: lateDeliveredAt,
    terminal: false,
  });
  assert.deepEqual({ ...db.prepare(`SELECT status, provider_status, delivered_at, failed_at, last_error
    FROM trade_activity_customer_document_deliveries WHERE id = ?`).get("delivery-1") }, {
    status: "bounced",
    provider_status: "email.bounced",
    delivered_at: "",
    failed_at: bouncedAt,
    last_error: "Customer document delivery invalidated by email.bounced.",
  });
  db.close();
});

test("a complaint supersedes an earlier scheduled-document bounce and remains a durable recipient block", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_activity_customer_document_deliveries (
    id text PRIMARY KEY NOT NULL,
    provider text NOT NULL,
    provider_message_id text NOT NULL,
    status text NOT NULL,
    provider_status text NOT NULL DEFAULT '',
    sent_at text NOT NULL DEFAULT '',
    delivered_at text NOT NULL DEFAULT '',
    failed_at text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT '',
    updated_at text NOT NULL
  )`);
  const bouncedAt = "2026-09-08T00:01:00.000Z";
  const complainedAt = "2026-09-08T00:02:00.000Z";
  db.prepare(`INSERT INTO trade_activity_customer_document_deliveries
    (id, provider, provider_message_id, status, provider_status, failed_at, last_error, updated_at)
    VALUES (?, 'resend', ?, 'bounced', 'email.bounced', ?, 'Customer document delivery invalidated by email.bounced.', ?)`).run(
    "delivery-1",
    "provider-1",
    bouncedAt,
    bouncedAt,
  );
  db.prepare(scheduledDocumentSuppressionEscalationSql()).run(
    "complained",
    "email.complained",
    complainedAt,
    "Customer document delivery invalidated by email.complained.",
    complainedAt,
    "delivery-1",
    "provider-1",
  );
  assert.deepEqual({ ...db.prepare(`SELECT status, provider_status, failed_at, last_error
    FROM trade_activity_customer_document_deliveries WHERE id = ?`).get("delivery-1") }, {
    status: "complained",
    provider_status: "email.complained",
    failed_at: bouncedAt,
    last_error: "Customer document delivery invalidated by email.complained.",
  });
  db.close();
});

test("a complaint suppresses queued, claimed and provider-bound documents for the same owner and recipient", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE trade_activity_customer_document_deliveries (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    recipient_email_sha256 text NOT NULL,
    provider_message_id text NOT NULL,
    status text NOT NULL,
    provider_status text NOT NULL DEFAULT '',
    failed_at text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT '',
    updated_at text NOT NULL
  )`);
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  const initialAt = "2026-09-08T00:00:00.000Z";
  const rows = [
    ["source", "owner-1", hash, "provider-source", "complained"],
    ["accepted", "owner-1", hash, "provider-accepted", "provider_accepted"],
    ["delivered", "owner-1", hash, "provider-delivered", "delivered"],
    ["other-owner", "owner-2", hash, "provider-other-owner", "provider_accepted"],
    ["other-recipient", "owner-1", otherHash, "provider-other-recipient", "provider_accepted"],
    ["unbound", "owner-1", hash, "", "queued"],
    ["claimed", "owner-1", hash, "", "sending"],
  ];
  const insert = db.prepare(`INSERT INTO trade_activity_customer_document_deliveries
    (id, firebase_uid, recipient_email_sha256, provider_message_id, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const row of rows) insert.run(...row, initialAt);

  const suppressedAt = "2026-09-08T00:01:00.000Z";
  db.prepare(scheduledDocumentSuppressionUpdateSql()).run(
    "email.complained",
    suppressedAt,
    suppressedAt,
    "owner-1",
    hash,
    "source",
  );

  assert.deepEqual(
    db.prepare(`SELECT id, status FROM trade_activity_customer_document_deliveries ORDER BY id`).all()
      .map((row) => ({ ...row })),
    [
      { id: "accepted", status: "suppressed" },
      { id: "claimed", status: "suppressed" },
      { id: "delivered", status: "suppressed" },
      { id: "other-owner", status: "provider_accepted" },
      { id: "other-recipient", status: "provider_accepted" },
      { id: "source", status: "complained" },
      { id: "unbound", status: "suppressed" },
    ],
  );
  assert.match(callbackSource, /SELECT id, work_order_id, firebase_uid, status, recipient_email_sha256/);
  assert.match(callbackSource, /\["email\.complained", "email\.suppressed"\]\.includes\(eventType\)/);
  db.close();
});
