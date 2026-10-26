import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
function load(mocks, path = '../src/lib/trade-rental-report-provider-verification.ts') {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => mocks[name] || {}, module, module.exports);
  return module.exports;
}
function testD1(database) {
  const statement = (sql, values = []) => ({
    bind: (...args) => statement(sql, args),
    first: async () => database.prepare(sql).get(...values) || null,
    all: async () => ({ results: database.prepare(sql).all(...values) }),
    run: async () => ({ success: true, meta: { changes: Number(database.prepare(sql).run(...values).changes) } }),
  });
  return { prepare: sql => statement(sql) };
}
function fixture({ pdf = Buffer.from('%PDF-1.7\nJames Winstanley rental report'), provider = 'resend', apiKey = 'secret-server-only' } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE trade_work_orders(id text,firebase_uid text,partner_type text,record_status text);
    CREATE TABLE trade_rental_reports(id text,inspection_id text,firebase_uid text,status text,report_number text,pdf_sha256 text,pdf_size_bytes integer);
    CREATE TABLE trade_rental_inspections(id text PRIMARY KEY,firebase_uid text,work_order_id text,status text,issued_report_id text);
    INSERT INTO trade_work_orders VALUES('job','owner','installer','active');
    INSERT INTO trade_rental_inspections VALUES('inspection','owner','job','issued','report');`);
  const migration = read('../drizzle/0160_trade_rental_inspections.sql');
  database.exec(migration.slice(migration.indexOf('CREATE TABLE `trade_rental_inspection_events`')).replaceAll('--> statement-breakpoint', ''));
  database.exec(read('../drizzle/0196_trade_outgoing_email.sql').replaceAll('--> statement-breakpoint', ''));
  const recipient = 'hello@appliedtradeservices.com.au';
  const recipientSha256 = sha(recipient);
  const pdfSha256 = sha(pdf);
  const key = sha(`rental-report-email|owner|report|${pdfSha256}|${recipientSha256}`);
  const now = new Date().toISOString();
  const messageId = 'provider-message-1';
  database.prepare('INSERT INTO trade_rental_reports VALUES(?,?,?,?,?,?,?)').run('report','inspection','owner','issued','RMS-X5FZU6EZ-R1',pdfSha256,pdf.length);
  database.prepare(`INSERT INTO trade_email_submissions
    (id,owner_uid,actor_uid,connection_id,request_key,content_hash,sender_email,recipient_email,subject,provider,status,provider_message_id,error_code,created_at,updated_at)
    VALUES('submission','owner','actor','platform',?,'hash','service@example.test',?,'Report',?,'accepted',?,'',?,?)`)
    .run(key,recipient,provider,messageId,now,now);
  database.prepare(`INSERT INTO trade_rental_inspection_events
    (id,inspection_id,report_id,firebase_uid,event_type,request_id,metadata,created_at)
    VALUES('accepted','inspection','report','owner','report_email_accepted',?,?,?)`)
    .run(`report-email:${key}:accepted`,JSON.stringify({ provider, providerMessageId: messageId, recipientSha256 }),now);
  const db = testD1(database);
  const providerEvents = [];
  const requests = [];
  const responses = {
    email: { id: messageId, to: [recipient], from: 'service@example.test', subject: 'Report', created_at: '2026-10-01T00:00:00Z', last_event: 'delivered' },
    attachments: { data: [{ id: 'attachment', filename: 'RMS-X5FZU6EZ-R1.pdf', size: pdf.length,
      content_type: 'application/pdf', content_disposition: 'attachment',
      download_url: 'https://outbound-cdn.resend.com/path/report.pdf?token=opaque', expires_at: '2030-01-01T00:00:00Z' }], has_more: false },
    pdf,
  };
  const hooks = { fetch: null };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (hooks.fetch) {
      const replacement = await hooks.fetch(url, options);
      if (replacement) return replacement;
    }
    if (url === `https://api.resend.com/emails/${messageId}`) return Response.json(responses.email);
    if (url === `https://api.resend.com/emails/${messageId}/attachments`) return Response.json(responses.attachments);
    if (url === responses.attachments.data[0]?.download_url) return new Response(responses.pdf);
    throw new Error('Unexpected request');
  };
  const providerApi = load({}, '../src/lib/trade-rental-report-provider-events.ts');
  const api = load({ '../../db': { getD1: () => db }, './trade-rental-report-provider-events': {
    readRentalReportProviderReceipt: providerApi.readRentalReportProviderReceipt,
    recoverRentalReportAcceptedEvent: providerApi.recoverRentalReportAcceptedEvent,
    recordRentalReportProviderEvent: async (actualDb, input) => {
      assert.equal(actualDb, db);
      providerEvents.push(input);
      return providerApi.recordRentalReportProviderEvent(actualDb, input);
    },
  } });
  const input = { ownerUid: 'owner', actorUid: 'admin', workOrderId: 'job', reportId: 'report', expectedRecipientEmail: recipient };
  const readerInput = { ownerUid: 'owner', inspectionId: 'inspection', reportId: 'report', recipientSha256, providerMessageId: messageId };
  return { api, database, db, requests, providerEvents, responses, hooks, input, readerInput, pdfSha256,
    loseAccepted: () => database.prepare(`UPDATE trade_rental_inspection_events SET event_type='report_email_requested',
      request_id=?, metadata=? WHERE id='accepted'`).run(`report-email:${key}:1`, JSON.stringify({ reportId: 'report', recipientSha256 })),
    recordProvider: status => providerApi.recordRentalReportProviderEvent(db, { providerMessageId: messageId,
      eventId: `callback-${status}`, eventType: `email.${status}`, recipientEmails: [recipient], occurredAt: now, source: 'webhook' }),
    verify: (overrides = {}) => api.verifyRentalReportProviderDelivery({ ...input, ...overrides }, { db, fetchImpl, apiKey }),
    evidence: () => api.readRentalReportAttachmentVerification(db, readerInput),
    events: () => database.prepare("SELECT * FROM trade_rental_inspection_events WHERE event_type='report_email_attachment_verified'").all(),
  };
}

test('the 10.3 MB PDF is verified by exact size and checksum without sending or exposing provider credentials', async () => {
  const pdf = Buffer.alloc(Math.ceil(10.3 * 1024 * 1024), 7);
  pdf.write('%PDF-1.7');
  const f = fixture({ pdf });
  const result = await f.verify();
  assert.equal(result.status, 'verified');
  assert.equal(result.providerStatus, 'delivered');
  assert.equal(result.attachment.filename, 'RMS-X5FZU6EZ-R1.pdf');
  assert.equal(result.attachment.sizeBytes, pdf.length);
  assert.equal(result.attachment.sha256, sha(pdf));
  assert.match(result.message, /recipient mail server accepted/);
  assert.match(result.message, /Inbox placement and reading are not confirmed/);
  assert.equal(f.requests.length, 3);
  for (const request of f.requests) {
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'manual');
    assert.ok(request.options.signal instanceof AbortSignal);
  }
  assert.equal(f.requests[0].options.headers.Authorization, 'Bearer secret-server-only');
  assert.equal(f.requests[1].options.headers.Authorization, 'Bearer secret-server-only');
  assert.equal(f.requests[2].options.headers, undefined);
  assert.equal(f.providerEvents[0].source, 'provider_api');
  assert.equal(f.providerEvents[0].eventType, 'email.delivered');
  assert.notEqual(f.providerEvents[0].occurredAt, f.responses.email.created_at);
  assert.equal(f.events().length, 1);
  assert.equal(f.events()[0].actor_uid, 'admin');
  assert.equal(JSON.stringify(result).includes('secret-server-only'), false);
  assert.equal(f.events()[0].metadata.includes('opaque'), false);
});

test('repeated verification persists one attachment receipt and keeps its first verified time', async () => {
  const f = fixture();
  const first = await f.verify();
  const second = await f.verify();
  assert.equal(second.status, 'verified');
  assert.equal(f.events().length, 1);
  assert.deepEqual(second.attachment, first.attachment);
});

test('an interrupted accepted journal is recovered from the exact requested event and accepted submission without resending', async () => {
  const f = fixture(); f.loseAccepted();
  const result = await f.verify();
  assert.equal(result.status, 'verified');
  assert.equal(result.providerStatus, 'delivered');
  assert.equal(f.database.prepare("SELECT count(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").get().n, 1);
  assert.equal(f.database.prepare("SELECT status FROM trade_email_submissions WHERE id='submission'").get().status, 'accepted');
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.every(request => request.options.method === 'GET'));
  await f.verify();
  assert.equal(f.database.prepare("SELECT count(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").get().n, 1);
});

for (const mutation of ['missing-request', 'request-owner', 'request-key', 'request-report', 'request-recipient', 'submission-owner', 'changed-pdf']) {
  test(`interrupted acceptance is not recovered from ${mutation}`, async () => {
    const f = fixture(); f.loseAccepted();
    if (mutation === 'missing-request') f.database.exec('DELETE FROM trade_rental_inspection_events');
    if (mutation === 'request-owner') f.database.exec("UPDATE trade_rental_inspection_events SET firebase_uid='other'");
    if (mutation === 'request-key') f.database.exec("UPDATE trade_rental_inspection_events SET request_id='report-email:other:1'");
    if (mutation === 'request-report') f.database.exec("UPDATE trade_rental_inspection_events SET report_id='other'");
    if (mutation === 'request-recipient') f.database.exec("UPDATE trade_rental_inspection_events SET metadata=json_set(metadata,'$.recipientSha256','wrong')");
    if (mutation === 'submission-owner') f.database.exec("UPDATE trade_email_submissions SET owner_uid='other'");
    if (mutation === 'changed-pdf') f.database.prepare('UPDATE trade_rental_reports SET pdf_sha256=?').run('a'.repeat(64));
    await assert.rejects(f.verify(), /REPORT_DELIVERY_VERIFICATION_NOT_FOUND/);
    assert.equal(f.database.prepare("SELECT count(*) n FROM trade_rental_inspection_events WHERE event_type='report_email_accepted'").get().n, 0);
    assert.equal(f.requests.length, 0);
  });
}

test('sent is not presented as delivery even with a matching attachment', async () => {
  const f = fixture(); f.responses.email.last_event = 'sent';
  const result = await f.verify();
  assert.equal(result.status, 'verified');
  assert.equal(result.providerStatus, 'sent');
  assert.match(result.message, /Delivery to the recipient mail server is not confirmed/);
});

test('an unknown provider status cannot invent delivery evidence', async () => {
  const f = fixture(); f.responses.email.last_event = 'opened';
  const result = await f.verify();
  assert.equal(result.status, 'verified');
  assert.equal(result.providerStatus, null);
  assert.equal(f.providerEvents.length, 0);
});

test('an existing bounce outranks a provider API delivered event and prevents a false delivery claim', async () => {
  const f = fixture(); await f.recordProvider('bounced');
  const result = await f.verify();
  assert.equal(result.status, 'verified');
  assert.equal(result.providerStatus, 'bounced');
  assert.match(result.message, /reports this email as bounced/);
  assert.equal(result.message.includes('mail server accepted'), false);
});

test('an attachment lookup permission failure keeps the delivery evidence already received by webhook', async () => {
  const f = fixture(); await f.recordProvider('delivered');
  f.hooks.fetch = () => new Response(null, { status: 403 });
  const result = await f.verify();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.providerStatus, 'delivered');
  assert.match(result.message, /^The recipient mail server accepted this email\./);
  assert.equal(result.attachment, null);
});

test('a bounce arriving during PDF retrieval is included in the final verification result', async () => {
  const f = fixture();
  f.hooks.fetch = async url => { if (url.startsWith('https://outbound-cdn.resend.com/')) await f.recordProvider('bounced'); };
  const result = await f.verify();
  assert.equal(result.status, 'verified');
  assert.equal(result.providerStatus, 'bounced');
  assert.match(result.message, /reports this email as bounced/);
});

test('a bounce arriving during a failed PDF retrieval is included in the failure message', async () => {
  const f = fixture();
  f.hooks.fetch = async url => {
    if (url.startsWith('https://outbound-cdn.resend.com/')) {
      await f.recordProvider('bounced');
      return new Response('different PDF');
    }
  };
  const result = await f.verify();
  assert.equal(result.status, 'unverified');
  assert.equal(result.providerStatus, 'bounced');
  assert.match(result.message, /reports this email as bounced/);
  assert.equal(result.message.includes('mail server accepted'), false);
});

for (const mutation of ['recipient', 'message-id', 'extra-recipient']) test(`wrong ${mutation} prevents both delivery and attachment evidence`, async () => {
  const f = fixture();
  if (mutation === 'recipient') f.responses.email.to = ['someone@example.test'];
  if (mutation === 'message-id') f.responses.email.id = 'another-message';
  if (mutation === 'extra-recipient') f.responses.email.to.push('someone@example.test');
  const result = await f.verify();
  assert.equal(result.status, 'unverified');
  assert.equal(result.providerStatus, null);
  assert.equal(f.requests.length, 1);
  assert.equal(f.providerEvents.length, 0);
  assert.equal(f.events().length, 0);
});

test('a sending-only API key reports an actionable limitation without creating an account or resending', async () => {
  const f = fixture(); f.hooks.fetch = () => new Response('secret provider detail', { status: 403 });
  const result = await f.verify();
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /enable read access on the existing credential/);
  assert.equal(result.message.includes('secret provider detail'), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.events().length, 0);
});

for (const missing of ['credential', 'other-provider']) test(`${missing} makes no outbound requests`, async () => {
  const f = fixture(missing === 'credential' ? { apiKey: '' } : { provider: 'google' });
  assert.equal((await f.verify()).status, 'unavailable');
  assert.equal(f.requests.length, 0);
});

for (const mismatch of ['missing', 'duplicate', 'filename', 'size', 'type', 'disposition', 'paged']) test(`${mismatch} attachment metadata preserves delivery but cannot verify attachment`, async () => {
  const f = fixture(); const attachment = f.responses.attachments.data[0];
  if (mismatch === 'missing') f.responses.attachments.data = [];
  if (mismatch === 'duplicate') f.responses.attachments.data.push({ ...attachment });
  if (mismatch === 'filename') attachment.filename = 'different.pdf';
  if (mismatch === 'size') attachment.size += 1;
  if (mismatch === 'type') attachment.content_type = 'text/plain';
  if (mismatch === 'disposition') attachment.content_disposition = 'inline';
  if (mismatch === 'paged') f.responses.attachments.has_more = true;
  const result = await f.verify();
  assert.equal(result.status, 'unverified');
  assert.equal(result.providerStatus, 'delivered');
  assert.equal(result.attachment, null);
  assert.match(result.message, /^The recipient mail server accepted this email\./);
  assert.equal(f.requests.length, 2);
  assert.equal(f.events().length, 0);
});

for (const address of [
  'http://outbound-cdn.resend.com/file.pdf', 'https://example.test/file.pdf',
  'https://outbound-cdn.resend.com.attacker.test/file.pdf', 'https://outbound-cdn.resend.com:444/file.pdf',
  'https://username:password@outbound-cdn.resend.com/file.pdf', 'not a url',
]) test(`an unsafe attachment URL is never requested: ${address}`, async () => {
  const f = fixture(); f.responses.attachments.data[0].download_url = address;
  const result = await f.verify();
  assert.equal(result.status, 'unverified');
  assert.equal(f.requests.length, 2);
  assert.equal(f.events().length, 0);
});

test('the attachment download cannot redirect to another host', async () => {
  const f = fixture();
  f.hooks.fetch = url => url.startsWith('https://outbound-cdn.resend.com/') ? new Response(null, { status: 302, headers: { location: 'https://example.test/' } }) : null;
  assert.equal((await f.verify()).status, 'unavailable');
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].options.redirect, 'manual');
  assert.equal(f.events().length, 0);
});

for (const mismatch of ['hash', 'short', 'oversized', 'declared-oversized']) test(`${mismatch} PDF bytes cannot create attachment evidence`, async () => {
  const f = fixture();
  if (mismatch === 'hash') f.responses.pdf = Buffer.alloc(f.responses.pdf.length, 5);
  if (mismatch === 'short') f.responses.pdf = f.responses.pdf.subarray(0, -1);
  if (mismatch === 'oversized') f.responses.pdf = Buffer.concat([f.responses.pdf, Buffer.from('extra')]);
  if (mismatch === 'declared-oversized') f.hooks.fetch = url => url.startsWith('https://outbound-cdn.resend.com/')
    ? new Response(f.responses.pdf, { headers: { 'content-length': String(f.responses.pdf.length + 1) } }) : null;
  const result = await f.verify();
  assert.equal(result.status, 'unverified');
  assert.equal(result.providerStatus, 'delivered');
  assert.equal(result.attachment, null);
  assert.equal(f.events().length, 0);
});

for (const mutation of ['owner', 'job', 'report', 'recipient', 'submission-message', 'submission-key', 'submission-status', 'current-report']) test(`${mutation} binding is rejected before provider access`, async () => {
  const f = fixture(); const overrides = {};
  if (mutation === 'owner') overrides.ownerUid = 'someone-else';
  if (mutation === 'job') overrides.workOrderId = 'another-job';
  if (mutation === 'report') overrides.reportId = 'another-report';
  if (mutation === 'recipient') overrides.expectedRecipientEmail = 'someone@example.test';
  if (mutation === 'submission-message') f.database.exec("UPDATE trade_email_submissions SET provider_message_id='other'");
  if (mutation === 'submission-key') f.database.exec("UPDATE trade_email_submissions SET request_key='other'");
  if (mutation === 'submission-status') f.database.exec("UPDATE trade_email_submissions SET status='sending'");
  if (mutation === 'current-report') f.database.exec("UPDATE trade_rental_inspections SET issued_report_id='new-report'");
  await assert.rejects(f.verify(overrides), /REPORT_DELIVERY_VERIFICATION_NOT_FOUND/);
  assert.equal(f.requests.length, 0);
});

test('a report replaced during provider retrieval cannot acquire attachment evidence', async () => {
  const f = fixture();
  f.hooks.fetch = url => { if (url.startsWith('https://outbound-cdn.resend.com/')) f.database.exec("UPDATE trade_rental_inspections SET issued_report_id='new-report'"); };
  await assert.rejects(f.verify(), /REPORT_DELIVERY_VERIFICATION_NOT_FOUND/);
  assert.equal(f.events().length, 0);
});

test('persisted attachment evidence is scoped to the exact owner, report, recipient, message and current PDF', async () => {
  const f = fixture(); await f.verify();
  assert.equal((await f.evidence()).sha256, f.pdfSha256);
  for (const field of ['ownerUid','inspectionId','reportId','recipientSha256','providerMessageId']) {
    assert.equal(await f.api.readRentalReportAttachmentVerification(f.db, { ...f.readerInput, [field]: 'other' }), null);
  }
  f.database.exec("UPDATE trade_rental_reports SET pdf_sha256='changed'");
  assert.equal(await f.evidence(), null);
});

for (const response of ['invalid-json', 'non-object', 'oversized-json', 'network-error']) test(`${response} cannot claim verification or leak errors`, async () => {
  const f = fixture();
  f.hooks.fetch = () => {
    if (response === 'invalid-json') return new Response('{bad json');
    if (response === 'non-object') return Response.json(['wrong']);
    if (response === 'oversized-json') return new Response('x'.repeat(256 * 1024 + 1));
    throw new Error('secret credential or network detail');
  };
  const result = await f.verify();
  assert.notEqual(result.status, 'verified');
  assert.equal(result.message.includes('secret'), false);
  assert.equal(f.events().length, 0);
});
