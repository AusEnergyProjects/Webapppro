import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as sms from '../src/lib/trade-sms.ts';
import * as reminders from '../src/lib/service-reminder-delivery.ts';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports);
  return record.exports;
}

const origin = 'https://tlink.test';
const deviceId = 'native-phone';
const field = { ownerUid: 'business', actorUid: 'field-member:worker', memberId: 'worker', displayName: 'Jane',
  isOwner: false, businessName: 'Trade business', canSendSms: true, fieldSessionId: 'field-session' };
const owner = { ...field, actorUid: 'business', memberId: 'owner', displayName: 'Business', isOwner: true, fieldSessionId: undefined };
const request = (path, { method = 'GET', body, authorization = 'TLinkField field-token', device = deviceId, headers = {} } = {}) => new Request(`${origin}${path}`, {
  method, headers: { ...(authorization ? { authorization } : {}), ...(device ? { 'x-aea-device-id': device } : {}), ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE trade_mobile_devices(id TEXT,owner_uid TEXT,member_id TEXT,device_id TEXT,status TEXT);
    INSERT INTO trade_mobile_devices VALUES('phone','business','worker','native-phone','active');
    CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT,job_scope TEXT);
    CREATE TABLE trade_field_sessions(id TEXT PRIMARY KEY,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_crm_customers(id TEXT PRIMARY KEY,firebase_uid TEXT,phone TEXT,record_status TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY,firebase_uid TEXT,partner_type TEXT,record_status TEXT,source_type TEXT,assignee_member_id TEXT,work_number TEXT,created_at TEXT);
    CREATE TABLE trade_crm_job_details(work_order_id TEXT PRIMARY KEY,firebase_uid TEXT,crm_customer_id TEXT,customer_source TEXT);`);
  for (const file of ['0182_trade_sms.sql', '0212_trade_team_sms.sql']) sqlite.exec(read(`../drizzle/${file}`).replaceAll('--> statement-breakpoint', ''));
  sqlite.exec(`INSERT INTO trade_team_members VALUES('worker','business','','active','own',1),('owner','business','business','active','team',1);
    INSERT INTO trade_field_sessions VALUES('field-session','business','worker','active','2099-01-01');
    INSERT INTO trade_crm_customers VALUES('customer','business','0412345678','active'),('foreign','another-business','0498765432','active');
    INSERT INTO trade_work_orders VALUES('job','business','installer','active','manual','worker','TLJ-ONE','2026-01-01'),
      ('other-job','business','installer','active','manual','another-worker','TLJ-TWO','2026-01-01'),
      ('private-job','business','installer','active','opportunity','worker','TLJ-PRIVATE','2026-01-01');
    INSERT INTO trade_crm_job_details VALUES('job','business','customer','internal'),('other-job','business','customer','internal'),('private-job','business','customer','platform_private');`);
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next), first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare: statement };
  let authorityFailure = '';
  const authorityCalls = [];
  const access = load('../src/lib/trade-communications-access.ts', {
    '../../db': { getD1: () => db },
    './trade-team-server': { requireInstallerTeamAccess: async input => {
      authorityCalls.push(input);
      if (authorityFailure) throw new Error(authorityFailure);
      const token = input.headers.get('authorization');
      if (token === 'Bearer owner-token') return { ...owner };
      if (!['TLinkField field-token', 'Bearer worker-token'].includes(token)) throw new Error('AUTH_REQUIRED');
      return { ...field, ...(token.startsWith('Bearer') ? { actorUid: 'worker-account', fieldSessionId: undefined } : {}) };
    } },
    './trade-integration-crypto': {}, './trade-message-media-access': {},
  });
  const server = load('../src/lib/trade-sms-server.ts', {
    '../../db': { getD1: () => db }, '@/lib/trade-integration-crypto': {}, '@/lib/service-reminder-delivery': reminders,
    './trade-sms': sms, './trade-sms-provider': {},
  });
  const api = load('../src/app/api/trade-sms/route.ts', {
    '@/lib/admin-server': { sameOrigin: input => !input.headers.get('origin') || input.headers.get('origin') === new URL(input.url).origin,
      mfaErrorResponse: () => null, adminJson: (body, status = 200) => Response.json(body, { status }) },
    '@/lib/trade-access-server': { TradeAccessError: class extends Error {} },
    '@/lib/trade-communications-access': access, '@/lib/trade-sms-server': server, '@/lib/trade-sms-provider': {},
  });
  return { sqlite, access, api, authorityCalls, deny: code => { authorityFailure = code; }, close: () => sqlite.close() };
}

test('native team inbox, call, and media access uses the existing Field/Bearer identity with its registered device', async () => {
  const f = fixture(); try {
    for (const path of ['/api/trade-messages', '/api/trade-team-calls', '/api/trade-message-media']) {
      for (const authorization of ['TLinkField field-token', 'Bearer worker-token']) {
        const actor = await f.access.requireTeamCommunicationAccess(request(path, { authorization }));
        assert.equal(actor.ownerUid, 'business'); assert.equal(actor.memberId, 'worker');
        assert.equal(f.authorityCalls.at(-1).headers.get('authorization'), authorization);
        assert.equal(f.authorityCalls.at(-1).headers.get('x-aea-device-id'), deviceId);
      }
    }
  } finally { f.close(); }
});

test('native communication access rejects missing field device, revoked device, reassignment, and other business device', async () => {
  const f = fixture(); try {
    const paths = ['/api/trade-messages', '/api/trade-team-calls', '/api/trade-message-media'];
    for (const path of paths) await assert.rejects(f.access.requireTeamCommunicationAccess(request(path, { device: '' })), /AUTH_REQUIRED/);
    for (const mutation of ["status='revoked'", "status='active',member_id='someone-else'", "member_id='worker',owner_uid='another-business'"]) {
      f.sqlite.exec(`UPDATE trade_mobile_devices SET ${mutation}`);
      for (const path of paths) await assert.rejects(f.access.requireTeamCommunicationAccess(request(path)), /AUTH_REQUIRED/);
      assert.equal((await f.api.GET(request('/api/trade-sms?customerId=customer&workOrderId=job'))).status, 401);
    }
  } finally { f.close(); }
});

test('native SMS reads only the permissioned customer/job through the same device gate, without an Origin header', async () => {
  const f = fixture(); try {
    const response = await f.api.GET(request('/api/trade-sms?customerId=customer&workOrderId=job'));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.customerPhone, '+61412345678'); assert.equal(data.jobNumber, 'TLJ-ONE');
    assert.equal(data.canManageConnection, false); assert.deepEqual(data.jobs, []);
    for (const suffix of ['customerId=customer', 'customerId=customer&workOrderId=other-job', 'customerId=customer&workOrderId=private-job', 'customerId=foreign&workOrderId=job']) {
      const denied = await f.api.GET(request(`/api/trade-sms?${suffix}`));
      assert.equal(denied.status, 403); assert.equal((await denied.json()).customerPhone, undefined);
    }
    f.sqlite.exec('UPDATE trade_team_members SET can_send_sms=0');
    assert.equal((await f.api.GET(request('/api/trade-sms?customerId=customer&workOrderId=job'))).status, 403);
  } finally { f.close(); }
});

test('a revoked native device cannot reserve an SMS send or record customer consent', async () => {
  const f = fixture(); try {
    f.sqlite.exec("UPDATE trade_mobile_devices SET status='revoked'");
    for (const action of ['send', 'consent']) {
      const response = await f.api.POST(request('/api/trade-sms', { method: 'POST', body: {
        action, customerId: 'customer', workOrderId: 'job', body: 'See you soon', requestId: 'sms-native-request-0001', consentNote: 'Customer agreed on phone',
      } }));
      assert.equal(response.status, 401);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_sms_messages').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_sms_recipients').get().n, 0);
  } finally { f.close(); }
});

test('the native SMS path retains authoritative business checks, denies cookie escalation, and leaves web owner setup available', async () => {
  const f = fixture(); try {
    const webOwner = await f.api.GET(request('/api/trade-sms', { authorization: 'Bearer owner-token', device: '' }));
    assert.equal(webOwner.status, 200); assert.equal((await webOwner.json()).canManageConnection, true);
    assert.equal((await f.api.GET(request('/api/trade-sms', { authorization: '', device: '', headers: { cookie: `__Host-tlink-comms=${'A'.repeat(43)}` } }))).status, 401);
    for (const action of ['inspect', 'connect', 'disconnect', 'link_reply']) {
      const method = action === 'disconnect' ? 'PATCH' : 'POST';
      assert.equal((await f.api[method](request('/api/trade-sms', { method, body: { action } }))).status, 403);
    }
    for (const code of ['ABN_REVIEW_REQUIRED', 'ACCOUNT_INACTIVE', 'TEAM_ACCESS_RECORD_REQUIRED']) {
      f.deny(code);
      assert.equal((await f.api.GET(request('/api/trade-sms?customerId=customer&workOrderId=job'))).status, 403);
      await assert.rejects(f.access.requireTeamCommunicationAccess(request('/api/trade-messages')), new RegExp(code));
    }
  } finally { f.close(); }
});
