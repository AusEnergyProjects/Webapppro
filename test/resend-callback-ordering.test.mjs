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
