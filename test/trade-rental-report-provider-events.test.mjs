import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as receipts from '../src/lib/trade-rental-report-provider-events.ts';
import { verifyResendWebhook } from '../src/lib/service-reminder-delivery.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const recipient = 'hello@appliedtradeservices.com.au';
const recipientHash = hash(recipient);
const pdfHash = hash('the issued PDF');
const requestKey = hash(`rental-report-email|owner-a|report-a|${pdfHash}|${recipientHash}`);
const secretBytes = Buffer.from('rental-report-callback-test-secret');
const secret = `whsec_${secretBytes.toString('base64')}`;
const occurredAt = '2026-10-26T02:46:17.000Z';
const readInput = { ownerUid: 'owner-a', inspectionId: 'inspection-a', reportId: 'report-a', recipientSha256: recipientHash };
const eventInput = (overrides = {}) => ({ providerMessageId: 'provider-a', eventId: 'event-a',
  eventType: 'email.delivered', recipientEmails: [recipient], occurredAt, ...overrides });

function loadRoute(dependencies) {
  const source = fs.readFileSync(new URL('../src/app/api/service-reminder-provider-events/resend/route.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

function fixture({ accepted = true, otherDelivery = false } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE trade_rental_inspections(id TEXT PRIMARY KEY, firebase_uid TEXT);
    CREATE TABLE trade_rental_reports(id TEXT PRIMARY KEY, inspection_id TEXT, firebase_uid TEXT, pdf_sha256 TEXT);
    CREATE TABLE trade_email_submissions(id TEXT PRIMARY KEY, owner_uid TEXT, request_key TEXT, recipient_email TEXT,
      provider TEXT, status TEXT, provider_message_id TEXT, updated_at TEXT DEFAULT '2026-10-26T02:46:00.000Z', UNIQUE(owner_uid, request_key));
    CREATE TABLE trade_rental_inspection_events(id TEXT PRIMARY KEY, inspection_id TEXT, report_id TEXT, firebase_uid TEXT,
      actor_type TEXT, actor_uid TEXT, event_type TEXT, request_id TEXT, summary TEXT, metadata TEXT, created_at TEXT);
    CREATE UNIQUE INDEX rental_request ON trade_rental_inspection_events(inspection_id, request_id) WHERE request_id <> '';
    INSERT INTO trade_rental_inspections VALUES('inspection-a', 'owner-a');`);
  database.prepare('INSERT INTO trade_rental_reports VALUES(?,?,?,?)').run('report-a', 'inspection-a', 'owner-a', pdfHash);
  database.prepare('INSERT INTO trade_email_submissions(id,owner_uid,request_key,recipient_email,provider,status,provider_message_id) VALUES(?,?,?,?,?,?,?)')
    .run('submission-a', 'owner-a', requestKey, recipient, 'resend', 'accepted', 'provider-a');
  const insertAccepted = (id = 'accepted-a', key = requestKey, providerMessageId = 'provider-a', at = '2026-10-26T02:46:00.000Z') => {
    database.prepare(`INSERT INTO trade_rental_inspection_events
      (id,inspection_id,report_id,firebase_uid,actor_type,actor_uid,event_type,request_id,summary,metadata,created_at)
      VALUES(?, 'inspection-a','report-a','owner-a','system','','report_email_accepted',?,'',?,?)`)
      .run(id, `report-email:${key}:accepted`, JSON.stringify({ reportId: 'report-a', recipientSha256: recipientHash,
        provider: 'resend', providerMessageId }), at);
  };
  if (accepted) insertAccepted();
  const statements = [], writes = [];
  const db = { prepare(query) {
    statements.push(query);
    const statement = values => ({
      bind: (...bound) => statement(bound),
      first: async () => {
        if (/FROM (service_reminder_deliveries|appointment_notification_deliveries|trade_crm_photo_request_deliveries|trade_crm_quote_deliveries|trade_crm_quick_invoices|trade_opportunity_notification_deliveries|customer_project_activity_deliveries|trade_activity_customer_document_deliveries|public_plan_customer_email_deliveries)\b/.test(query)) {
          return otherDelivery && query.includes('FROM service_reminder_deliveries') ? { id: 'service-a' } : null;
        }
        return database.prepare(query).get(...values) || null;
      },
      all: async () => ({ results: database.prepare(query).all(...values) }),
      run: async () => { writes.push(query); const result = database.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; },
    });
    return statement([]);
  } };
  const route = loadRoute({
    '../../../../../db': { getD1: () => db },
    '@/lib/service-reminder-delivery': { verifyResendWebhook },
    '@/lib/trade-quick-invoice-server': { QUICK_INVOICE_PROVIDER_EVENT_UPDATE_SQL: '' },
    '@/lib/trade-quote-delivery-policy.mjs': { tradeQuoteDeliveryCallbackStatus: () => { throw new Error('Unexpected quote update'); } },
    '@/lib/trade-rental-report-provider-events': receipts,
  });
  const callback = async (overrides = {}, { signature = true, id = 'event-a' } = {}) => {
    const body = JSON.stringify({ type: 'email.delivered', created_at: occurredAt, data: { email_id: 'provider-a', to: [recipient] }, ...overrides });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64');
    const previous = process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SECRET = secret;
    try {
      return await route.POST(new Request('https://example.test/api/service-reminder-provider-events/resend', {
        method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature ? signed : 'wrong'}` }, body,
      }));
    } finally {
      if (previous === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = previous;
    }
  };
  const countReceipts = () => database.prepare("SELECT COUNT(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_provider_event'").get().n;
  return { database, db, callback, statements, writes, insertAccepted, countReceipts };
}

test('signed rental callback records recipient-bound delivery evidence without changing send idempotency', async () => {
  const f = fixture();
  const response = await f.callback();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, replay: false });
  assert.deepEqual({ ...await receipts.readRentalReportProviderReceipt(f.db, readInput) }, {
    providerStatus: 'delivered', providerMessageId: 'provider-a', occurredAt,
  });
  const event = f.database.prepare("SELECT * FROM trade_rental_inspection_events WHERE event_type='report_email_provider_event'").get();
  assert.equal(event.actor_type, 'system'); assert.equal(event.firebase_uid, 'owner-a');
  assert.equal(event.inspection_id, 'inspection-a'); assert.equal(event.report_id, 'report-a');
  assert.equal(JSON.parse(event.metadata).source, 'webhook');
  assert.equal(event.metadata.includes(recipient), false, 'journal stores the recipient hash, not an email address');
  assert.equal(f.database.prepare('SELECT status FROM trade_email_submissions').get().status, 'accepted');
  assert.ok(f.writes.every(query => query.startsWith('INSERT OR IGNORE INTO trade_rental_inspection_events')));
});

test('invalid provider signature cannot read or write rental or other delivery state', async () => {
  const f = fixture();
  assert.equal((await f.callback({}, { signature: false })).status, 401);
  assert.equal(f.statements.length, 0); assert.equal(f.countReceipts(), 0);
});

test('callback before accepted journal binding is retryable and the same event succeeds after binding', async () => {
  const f = fixture({ accepted: false });
  let response = await f.callback();
  assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '5');
  assert.equal((await response.json()).retryable, true); assert.equal(f.countReceipts(), 0);
  f.insertAccepted();
  response = await f.callback(); assert.equal(response.status, 200);
  assert.equal(f.countReceipts(), 1);
  response = await f.callback(); assert.deepEqual(await response.json(), { ok: true, replay: true });
  assert.equal(f.countReceipts(), 1);
  assert.equal(f.database.prepare('SELECT status FROM trade_email_submissions').get().status, 'accepted');
});

test('unknown provider messages and mismatched or additional recipients never attach to a rental report', async () => {
  for (const data of [
    { email_id: 'provider-other', to: [recipient] },
    { email_id: 'provider-a', to: ['other@example.test'] },
    { email_id: 'provider-a', to: [recipient, 'other@example.test'] },
    { email_id: 'provider-a', to: [] },
    { email_id: 'provider-a', to: [recipient, {}] },
  ]) {
    const f = fixture();
    assert.equal((await f.callback({ data })).status, 503);
    assert.equal(f.countReceipts(), 0);
  }
  const f = fixture();
  assert.equal((await f.callback({ data: { email_id: 'provider-a', to: [recipient.toUpperCase()] } })).status, 200);
});

test('accepted evidence must match the exact submission owner, report, PDF, recipient hash and request key', async () => {
  for (const mutation of [
    "UPDATE trade_email_submissions SET owner_uid='other-owner'",
    "UPDATE trade_rental_reports SET firebase_uid='other-owner'",
    "UPDATE trade_rental_reports SET inspection_id='other-inspection'",
    "UPDATE trade_rental_inspection_events SET report_id='other-report'",
    "UPDATE trade_rental_inspections SET firebase_uid='other-owner'",
    "UPDATE trade_email_submissions SET provider='google'",
    "UPDATE trade_email_submissions SET status='sending'",
    "UPDATE trade_email_submissions SET request_key='other-key'",
    "UPDATE trade_email_submissions SET recipient_email='other@example.test'",
    "UPDATE trade_rental_reports SET pdf_sha256='different-pdf'",
    "UPDATE trade_rental_inspection_events SET metadata=json_set(metadata,'$.recipientSha256','wrong')",
  ]) {
    const f = fixture(); f.database.exec(mutation);
    assert.deepEqual(await receipts.recordRentalReportProviderEvent(f.db, eventInput()), { matched: false }, mutation);
    assert.equal(f.countReceipts(), 0, mutation);
  }
});

test('invalid signed timestamp is rejected instead of inventing a delivery event time', async () => {
  const f = fixture();
  assert.equal((await f.callback({ created_at: 'invalid' })).status, 400);
  assert.equal(f.countReceipts(), 0);
});

test('delayed and sent events cannot downgrade delivery, and every terminal adverse receipt defeats delivery', async () => {
  for (const adverse of ['bounced', 'failed', 'suppressed', 'complained']) {
    for (const reverse of [false, true]) {
      const f = fixture();
      const events = [
        ['sent', '2026-10-26T02:46:01.000Z'], ['delivered', '2026-10-26T02:46:17.000Z'],
        [adverse, '2026-10-26T02:46:18.000Z'], ['delivery_delayed', '2026-10-26T02:46:19.000Z'],
        ['sent', '2026-10-26T02:46:20.000Z'], ['delivered', '2026-10-26T02:46:21.000Z'],
      ];
      for (const [status, at] of reverse ? events.reverse() : events) {
        await receipts.recordRentalReportProviderEvent(f.db, eventInput({ eventId: `${status}:${at}`, eventType: `email.${status}`, occurredAt: at }));
      }
      assert.deepEqual({ ...await receipts.readRentalReportProviderReceipt(f.db, readInput) }, {
        providerStatus: adverse, providerMessageId: 'provider-a', occurredAt: '2026-10-26T02:46:18.000Z',
      });
      assert.equal(f.database.prepare('SELECT status FROM trade_email_submissions').get().status, 'accepted');
    }
  }
  const f = fixture();
  await receipts.recordRentalReportProviderEvent(f.db, eventInput());
  await receipts.recordRentalReportProviderEvent(f.db, eventInput({ eventType: 'email.sent', eventId: 'late-sent' }));
  await receipts.recordRentalReportProviderEvent(f.db, eventInput({ eventType: 'email.delivery_delayed', eventId: 'late-delay' }));
  assert.equal((await receipts.readRentalReportProviderReceipt(f.db, readInput)).providerStatus, 'delivered');
});

test('multiple terminal receipts use provider occurrence time rather than callback arrival order', async () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    const events = [eventInput({ eventType: 'email.bounced', eventId: 'bounce', occurredAt: '2026-10-26T02:46:18.000Z' }),
      eventInput({ eventType: 'email.complained', eventId: 'complaint', occurredAt: '2026-10-26T02:47:18.000Z' })];
    for (const event of reverse ? events.reverse() : events) await receipts.recordRentalReportProviderEvent(f.db, event);
    assert.equal((await receipts.readRentalReportProviderReceipt(f.db, readInput)).providerStatus, 'complained');
  }
});

test('receipt lookup is scoped to exact owner, inspection, report and recipient', async () => {
  const f = fixture();
  await receipts.recordRentalReportProviderEvent(f.db, eventInput());
  for (const [key, value] of [['ownerUid', 'other-owner'], ['inspectionId', 'other-inspection'], ['reportId', 'other-report'], ['recipientSha256', hash('other')]]) {
    assert.equal(await receipts.readRentalReportProviderReceipt(f.db, { ...readInput, [key]: value }), null);
  }
});

test('the latest accepted attempt cannot inherit a historical attempt receipt', async () => {
  const f = fixture();
  await receipts.recordRentalReportProviderEvent(f.db, eventInput());
  f.database.prepare('INSERT INTO trade_email_submissions(id,owner_uid,request_key,recipient_email,provider,status,provider_message_id) VALUES(?,?,?,?,?,?,?)')
    .run('submission-b', 'owner-a', 'replacement-key', recipient, 'resend', 'accepted', 'provider-b');
  f.insertAccepted('accepted-b', 'replacement-key', 'provider-b', '2026-10-26T03:46:00.000Z');
  assert.equal(await receipts.readRentalReportProviderReceipt(f.db, readInput), null);
});

test('provider API observations share recipient-bound tracking and retain their evidence source', async () => {
  const f = fixture();
  const result = await receipts.recordRentalReportProviderEvent(f.db, eventInput({ source: 'provider_api', eventId: 'verification:provider-a:delivered' }));
  assert.equal(result.matched, true);
  const metadata = JSON.parse(f.database.prepare("SELECT metadata FROM trade_rental_inspection_events WHERE event_type='report_email_provider_event'").get().metadata);
  assert.equal(metadata.source, 'provider_api'); assert.equal(metadata.occurredAt, occurredAt);
});

test('delayed callbacks are tracked for rentals while existing delivery categories retain their ignored response', async () => {
  const f = fixture();
  assert.equal((await f.callback({ type: 'email.delivery_delayed' })).status, 200);
  assert.equal((await receipts.readRentalReportProviderReceipt(f.db, readInput)).providerStatus, 'delivery_delayed');
  const existing = fixture({ otherDelivery: true });
  const response = await existing.callback({ type: 'email.delivery_delayed' });
  assert.deepEqual(await response.json(), { ok: true, ignored: true }); assert.equal(existing.writes.length, 0);
});

function loseAcceptance(f) {
  f.database.prepare(`UPDATE trade_rental_inspection_events SET event_type='report_email_requested',request_id=?,metadata=? WHERE id='accepted-a'`)
    .run(`report-email:${requestKey}:1`, JSON.stringify({ reportId: 'report-a', recipientSha256: recipientHash }));
}

test('interrupted acceptance journalling is recovered from the exact accepted submission before recording callback', async () => {
  const f = fixture(); loseAcceptance(f);
  const before = { ...f.database.prepare('SELECT * FROM trade_email_submissions').get() };
  assert.equal((await f.callback()).status, 200);
  const accepted = f.database.prepare("SELECT * FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").all();
  assert.equal(accepted.length, 1); assert.equal(accepted[0].request_id, `report-email:${requestKey}:accepted`);
  assert.equal(accepted[0].created_at, before.updated_at); assert.equal(JSON.parse(accepted[0].metadata).recoveredFromSubmission, true);
  assert.equal(f.countReceipts(), 1);
  assert.equal((await receipts.readRentalReportProviderReceipt(f.db, readInput)).providerStatus, 'delivered');
  assert.deepEqual({ ...f.database.prepare('SELECT * FROM trade_email_submissions').get() }, before);
  assert.equal(await receipts.recoverRentalReportAcceptedEvent(f.db, 'provider-a'), true);
  assert.deepEqual(await (await f.callback()).json(), { ok: true, replay: true });
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").get().n, 1);
  assert.equal(f.countReceipts(), 1);
});

test('acceptance recovery rejects unaccepted submissions and unrelated or corrupted requested report bindings', async () => {
  for (const mutation of [
    "UPDATE trade_email_submissions SET status='sending'",
    "UPDATE trade_email_submissions SET status='failed'",
    "UPDATE trade_email_submissions SET status='uncertain'",
    "UPDATE trade_email_submissions SET provider='google'",
    "UPDATE trade_email_submissions SET owner_uid='other-owner'",
    "UPDATE trade_email_submissions SET recipient_email='other@example.test'",
    "UPDATE trade_email_submissions SET request_key='wrong-key'",
    "UPDATE trade_rental_reports SET pdf_sha256='wrong-pdf'",
    "UPDATE trade_rental_reports SET firebase_uid='other-owner'",
    "UPDATE trade_rental_reports SET inspection_id='other-inspection'",
    "UPDATE trade_rental_inspection_events SET report_id='other-report'",
    "UPDATE trade_rental_inspection_events SET metadata=json_set(metadata,'$.recipientSha256','wrong')",
    "UPDATE trade_rental_inspection_events SET request_id=request_id || ':failed'",
    "UPDATE trade_rental_inspection_events SET event_type='report_email_failed'",
  ]) {
    const f = fixture(); loseAcceptance(f); f.database.exec(mutation);
    assert.equal(await receipts.recoverRentalReportAcceptedEvent(f.db, 'provider-a'), false, mutation);
    assert.equal(f.writes.length, 0, mutation); assert.equal(f.countReceipts(), 0, mutation);
  }
});
