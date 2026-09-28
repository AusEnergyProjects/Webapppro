import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import * as bounded from '../src/lib/bounded-request-body.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, dependencies, globals = {}) {
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, record, record.exports, ...Object.values(globals));
  return record.exports;
}

const actor = { ownerUid: 'business-a', actorUid: 'person-a', memberId: 'member-a1', displayName: 'Field technician', businessName: 'Trade A', fieldSessionId: 'field-session-a' };
const other = { ownerUid: 'business-b', actorUid: 'person-b', memberId: 'member-b1', displayName: 'Other technician', businessName: 'Trade B' };
const auth = 'TLinkField synthetic-device-session-a';
const deviceId = 'phone-device-a';
const origin = 'https://tlink.test';
const handoffPath = '/api/trade-team-handoff';
const nativeRequest = (extra = {}) => new Request(`${origin}${handoffPath}`, {
  method: 'POST', headers: { authorization: auth, 'x-aea-device-id': deviceId, ...extra },
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE trade_team_members(id TEXT PRIMARY KEY,owner_uid TEXT,member_uid TEXT,status TEXT);
    CREATE TABLE trade_field_sessions(id TEXT,owner_uid TEXT,team_member_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE trade_mobile_devices(id TEXT,owner_uid TEXT,member_id TEXT,actor_uid TEXT,device_id TEXT,status TEXT);
    INSERT INTO trade_team_members VALUES('member-a1','business-a','person-a','active'),('member-b1','business-b','person-b','active');
    INSERT INTO trade_field_sessions VALUES('field-session-a','business-a','member-a1','active','2099-01-01'),('field-session-b','business-b','member-b1','active','2099-01-01');
    INSERT INTO trade_mobile_devices VALUES('device-record-a','business-a','member-a1','person-a','phone-device-a','active');`);
  for (const path of ['../drizzle/0214_trade_messages.sql', '../drizzle/0216_trade_team_calls.sql', '../drizzle/0218_trade_communication_handoffs.sql']) {
    sqlite.exec(read(path).replaceAll('--> statement-breakpoint', ''));
  }
  const now = new Date().toISOString();
  for (const [id, owner, member] of [['thread-aaaa', actor.ownerUid, actor.memberId], ['thread-bbbb', other.ownerUid, other.memberId]]) {
    sqlite.prepare('INSERT INTO trade_message_threads(id,owner_uid,kind,subject,created_by_member_id,request_id,creation_hash,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, owner, 'group', 'Team', member, id, id, now, now);
    sqlite.prepare('INSERT INTO trade_message_participants(thread_id,owner_uid,member_id)VALUES(?,?,?)').run(id, owner, member);
  }
  let revoked = false;
  let beforeAuthority;
  let clockOffset = 0;
  const clockStart = Date.now();
  class ClockDate extends Date {
    constructor(...values) { super(...(values.length ? values : [clockStart + clockOffset])); }
    static now() { return clockStart + clockOffset; }
  }
  const seen = [];
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  });
  const db = { prepare: statement };
  const authority = async (request) => {
    if (beforeAuthority) { const action = beforeAuthority; beforeAuthority = undefined; action(); }
    seen.push({ authorization: request.headers.get('authorization'), deviceId: request.headers.get('x-aea-device-id') });
    if (revoked) throw new Error('AUTH_REQUIRED');
    if (request.headers.get('authorization') === 'Bearer other-account') return { ...other };
    if (request.headers.get('authorization') !== auth || request.headers.get('x-aea-device-id') !== deviceId) throw new Error('AUTH_REQUIRED');
    if (sqlite.prepare('SELECT status FROM trade_team_members WHERE id=?').get(actor.memberId)?.status !== 'active') throw new Error('AUTH_REQUIRED');
    return { ...actor };
  };
  const cryptoModule = load('../src/lib/trade-integration-crypto.ts', {
    'cloudflare:workers': { env: { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url') } },
    '@/lib/trade-integration-state': {},
  });
  const server = load('../src/lib/trade-communications-access.ts', {
    '../../db': { getD1: () => db },
    './trade-team-server': { requireInstallerTeamAccess: authority },
    './trade-integration-crypto': cryptoModule,
    './trade-message-media-access': load('../src/lib/trade-message-media-access.ts', {}),
  }, { Date: ClockDate });
  const route = load('../src/app/api/trade-team-handoff/route.ts', {
    '@/lib/admin-server': {
      sameOrigin: (request) => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin,
      adminJson: (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
      mfaErrorResponse: () => null,
    },
    '@/lib/bounded-request-body.mjs': bounded,
    '@/lib/trade-communications-access': server,
  });
  return { sqlite, server, route, seen, cryptoModule, revoke: () => { revoked = true; },
    advance: (milliseconds) => { clockOffset += milliseconds; },
    beforeNextAccess: (action) => { beforeAuthority = action; }, close: () => sqlite.close() };
}

async function issue(f, target = {}) {
  const issued = await f.server.issueCommunicationHandoff(nativeRequest(), target);
  const url = new URL(issued.url);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/direct-trade/messages');
  assert.equal(url.search, '');
  return { ...issued, code: url.hash.slice('#handoff='.length) };
}
async function redeem(f, issued) {
  return f.server.redeemCommunicationHandoff(new Request(`${origin}${handoffPath}`), issued.code);
}
const withCookie = (cookie, path = '/api/trade-messages', headers = {}) => new Request(`${origin}${path}`, {
  headers: { cookie: cookie.split(';')[0], 'x-tlink-comms-member': actor.memberId, ...headers },
});

test('one-use handoff stores hashed tokens and encrypted source auth, never customer credentials in the URL', async () => {
  const f = fixture(); try {
    const issued = await issue(f, { threadId: 'thread-aaaa' });
    const row = f.sqlite.prepare('SELECT * FROM trade_communication_handoffs').get();
    assert.notEqual(row.code_hash, issued.code);
    assert.equal(row.code_hash, await f.cryptoModule.integrationStateHash(issued.code));
    assert.ok(!issued.url.includes(auth) && !issued.url.includes(deviceId) && !issued.url.includes('thread-aaaa'));
    assert.ok(!row.encrypted_auth.includes(auth));
    assert.deepEqual(await f.cryptoModule.decryptProtectedPayload(row.encrypted_auth), { authorization: auth, deviceId });
    const result = await redeem(f, issued);
    assert.equal(result.threadId, 'thread-aaaa');
    assert.equal(result.actor.memberId, actor.memberId);
    assert.match(result.cookie, /^__Host-tlink-comms=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=3600; HttpOnly; Secure; SameSite=Strict$/);
    assert.equal((await f.server.requireTeamCommunicationAccess(withCookie(result.cookie))).memberId, actor.memberId);
    await assert.rejects(redeem(f, issued), /HANDOFF_EXPIRED/);
  } finally { f.close(); }
});

test('concurrent redemptions produce exactly one usable browser session', async () => {
  const f = fixture(); try {
    const issued = await issue(f);
    const results = await Promise.allSettled([redeem(f, issued), redeem(f, issued), redeem(f, issued)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected' && /HANDOFF_EXPIRED/.test(result.reason.message)).length, 2);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_communication_handoffs WHERE consumed_at<>'' AND session_hash<>''").get().n, 1);
  } finally { f.close(); }
});

test('expired redemption codes and expired browser sessions are rejected', async () => {
  const f = fixture(); try {
    const expired = await issue(f);
    f.sqlite.exec("UPDATE trade_communication_handoffs SET redeem_before='2020-01-01'");
    await assert.rejects(redeem(f, expired), /HANDOFF_EXPIRED/);
    const current = await issue(f), result = await redeem(f, current);
    f.sqlite.exec("UPDATE trade_communication_handoffs SET expires_at='2020-01-01'");
    await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie)), /AUTH_REQUIRED/);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_communication_handoffs').get().n, 1, 'issuing the current code purged the expired unredeemed code');
  } finally { f.close(); }
});

test('underlying access is revalidated during redemption and on every cookie-authenticated request', async () => {
  let f = fixture(); try {
    const issued = await issue(f); f.revoke();
    await assert.rejects(redeem(f, issued), /AUTH_REQUIRED/);
    assert.equal(f.sqlite.prepare('SELECT consumed_at FROM trade_communication_handoffs').get().consumed_at, '');
  } finally { f.close(); }
  f = fixture(); try {
    const result = await redeem(f, await issue(f));
    await f.server.requireTeamCommunicationAccess(withCookie(result.cookie));
    f.revoke();
    await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie)), /AUTH_REQUIRED/);
    assert.ok(f.seen.length >= 4);
    assert.deepEqual(f.seen.at(-1), { authorization: auth, deviceId });
  } finally { f.close(); }
});

test('a handoff or browser session expiring during authority validation is rejected before granting access', async () => {
  let f = fixture(); try {
    const issued = await issue(f);
    f.beforeNextAccess(() => f.advance(61_000));
    await assert.rejects(redeem(f, issued), /HANDOFF_EXPIRED/);
  } finally { f.close(); }
  f = fixture(); try {
    const result = await redeem(f, await issue(f));
    f.beforeNextAccess(() => f.advance(3_600_001));
    await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie)), /AUTH_REQUIRED/);
  } finally { f.close(); }
});

test('revoked or reassigned native devices cannot issue, redeem or keep browser communication sessions', async () => {
  const f = fixture(); try {
    const result = await redeem(f, await issue(f));
    const pending = await issue(f);
    f.sqlite.exec("UPDATE trade_mobile_devices SET status='revoked'");
    await assert.rejects(issue(f), /AUTH_REQUIRED|DEVICE_REVOKED/);
    await assert.rejects(redeem(f, pending), /AUTH_REQUIRED|DEVICE_REVOKED/);
    await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie)), /AUTH_REQUIRED|DEVICE_REVOKED/);
    await assert.rejects(f.server.requireTeamCommunicationAccess(new Request(`${origin}/api/trade-messages`, {
      headers: { authorization: auth, 'x-aea-device-id': deviceId },
    })), /AUTH_REQUIRED|DEVICE_REVOKED/);
    f.sqlite.exec("UPDATE trade_mobile_devices SET status='active', member_id='member-b1'");
    await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie)), /AUTH_REQUIRED|DEVICE_REVOKED/);
  } finally { f.close(); }
});

test('the cookie authorizes only the named communications routes and cannot mint another session', async () => {
  const f = fixture(); try {
    const result = await redeem(f, await issue(f));
    for (const path of ['/api/trade-messages', '/api/trade-message-media', '/api/trade-team-calls', '/api/trade-push', handoffPath]) {
      assert.equal((await f.server.requireTeamCommunicationAccess(withCookie(result.cookie, path))).memberId, actor.memberId);
    }
    for (const path of ['/api/trade-quotes', '/api/trade-team', '/api/trade-messages/extra', '/api/TRADE-messages', '/api/trade-message-media%2fprivate']) {
      await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie, path)), /AUTH_REQUIRED/);
    }
    await assert.rejects(f.server.issueCommunicationHandoff(withCookie(result.cookie, handoffPath), {}), /AUTH_REQUIRED/);
  } finally { f.close(); }
});

test('explicit Authorization has precedence and never falls back to a different cookie identity', async () => {
  const f = fixture(); try {
    const result = await redeem(f, await issue(f));
    assert.equal((await f.server.requireTeamCommunicationAccess(withCookie(result.cookie, '/api/trade-messages', { authorization: 'Bearer other-account' }))).memberId, other.memberId);
    for (const authorization of ['', 'Bearer invalid', 'TLinkField invalid']) {
      await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie, '/api/trade-messages', { authorization })), /AUTH_REQUIRED/);
    }
    assert.equal((await f.server.requireTeamCommunicationAccess(withCookie(result.cookie))).memberId, actor.memberId);
    await f.server.requireTeamCommunicationAccess(withCookie(result.cookie, '/api/trade-messages', { 'x-aea-device-id': 'unrelated-device' }));
    assert.deepEqual(f.seen.at(-1), { authorization: auth, deviceId }, 'untrusted browser headers cannot replace the original device binding');
  } finally { f.close(); }
});

test('stored owner/member identity cannot be substituted even with otherwise valid encrypted authorization', async () => {
  for (const update of ["owner_uid='business-b'", "member_id='member-b1'"]) {
    const f = fixture(); try {
      const result = await redeem(f, await issue(f));
      f.sqlite.exec(`UPDATE trade_communication_handoffs SET ${update}`);
      await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(result.cookie)), /AUTH_REQUIRED/);
    } finally { f.close(); }
  }
});

test('a cookie from a different browser tab cannot silently change identity or close another member session', async () => {
  const f = fixture(); try {
    const result = await redeem(f, await issue(f));
    for (const expected of ['', other.memberId]) {
      const request = withCookie(result.cookie, '/api/trade-messages', { 'x-tlink-comms-member': expected });
      await assert.rejects(f.server.requireTeamCommunicationAccess(request), /AUTH_REQUIRED/);
      await assert.rejects(f.server.closeCommunicationSession(request), /AUTH_REQUIRED/);
    }
    await assert.rejects(f.server.requireTeamCommunicationAccess(new Request(`${origin}/api/trade-messages`, {
      headers: { cookie: result.cookie.split(';')[0] },
    })), /AUTH_REQUIRED/);
    assert.equal((await f.server.requireTeamCommunicationAccess(withCookie(result.cookie))).memberId, actor.memberId);
  } finally { f.close(); }
});

test('thread membership and bounded identifiers guard handoff targets', async () => {
  const f = fixture(); try {
    await assert.rejects(issue(f, { threadId: 'thread-bbbb' }), /HANDOFF_ACCESS_REQUIRED/);
    await assert.rejects(issue(f, { threadId: 'thread-aaaa', callId: 'call-missing' }), /HANDOFF_ACCESS_REQUIRED/);
    for (const input of [{ threadId: '../admin' }, { threadId: 'x'.repeat(121) }, { callId: 'call-aaaa' }]) {
      await assert.rejects(issue(f, input), /HANDOFF_INVALID/);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM trade_communication_handoffs').get().n, 0);
    f.sqlite.prepare('INSERT INTO trade_team_calls(id,owner_uid,thread_id,mode,created_by_member_id,request_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('call-aaaa', actor.ownerUid, 'thread-aaaa', 'video', actor.memberId, 'request-call-a', new Date().toISOString(), '2099-01-01');
    const result = await redeem(f, await issue(f, { threadId: 'thread-aaaa', callId: 'call-aaaa' }));
    assert.equal(result.threadId, 'thread-aaaa');
    assert.equal(result.callId, 'call-aaaa');
  } finally { f.close(); }
});

test('per-member issuance is bounded and logout invalidates only that browser session', async () => {
  const f = fixture(); try {
    const issued = await Promise.all(Array.from({ length: 10 }, () => issue(f)));
    await assert.rejects(issue(f), /HANDOFF_RATE_LIMIT/);
    const first = await redeem(f, issued[0]), second = await redeem(f, issued[1]);
    await f.server.closeCommunicationSession(withCookie(first.cookie, handoffPath));
    await assert.rejects(f.server.requireTeamCommunicationAccess(withCookie(first.cookie)), /AUTH_REQUIRED/);
    assert.equal((await f.server.requireTeamCommunicationAccess(withCookie(second.cookie))).memberId, actor.memberId);
  } finally { f.close(); }
});

test('handoff HTTP routes reject foreign origins and oversize bodies, set no-store and keep credentials out of JSON', async () => {
  const f = fixture(); try {
    const post = (body, headers = {}) => new Request(`${origin}${handoffPath}`, { method: 'POST', headers: { authorization: auth, 'x-aea-device-id': deviceId, ...headers }, body: JSON.stringify(body) });
    assert.equal((await f.route.POST(post({ action: 'issue' }, { origin: 'https://foreign.test' }))).status, 403);
    assert.equal(f.seen.length, 0);
    assert.equal((await f.route.POST(post({ action: 'issue', extra: 'x'.repeat(2500) }))).status, 413);
    const issuedResponse = await f.route.POST(post({ action: 'issue', threadId: 'thread-aaaa' }));
    assert.equal(issuedResponse.status, 200);
    assert.equal(issuedResponse.headers.get('cache-control'), 'no-store');
    const issued = await issuedResponse.json();
    const code = new URL(issued.url).hash.slice('#handoff='.length);
    const response = await f.route.POST(new Request(`${origin}${handoffPath}`, { method: 'POST', body: JSON.stringify({ action: 'redeem', code }) }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
    const json = await response.json();
    assert.deepEqual(json, { ok: true, access: { memberId: actor.memberId, name: actor.displayName, businessName: actor.businessName }, threadId: 'thread-aaaa', callId: '' });
    assert.ok(!JSON.stringify(json).includes(auth) && !JSON.stringify(json).includes(code));
    const session = response.headers.get('set-cookie');
    assert.equal((await f.route.GET(withCookie(session, handoffPath))).status, 200);
    const closed = await f.route.DELETE(withCookie(session, handoffPath));
    assert.equal(closed.status, 200);
    assert.match(closed.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await f.route.GET(withCookie(session, handoffPath))).status, 401);
  } finally { f.close(); }
});
