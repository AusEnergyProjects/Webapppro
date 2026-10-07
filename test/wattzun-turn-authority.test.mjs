import assert from 'node:assert/strict';
import test from 'node:test';
import { turnAuthorityContract as authority } from './helpers/wattzun-turn-authority-fixture.mjs';

const team = { ownerUid: 'business-one', actorUid: 'actor-one', businessName: 'Synthetic Trade', memberId: 'member-one', isOwner: true };
function fixture() {
  const db = {}, calls = [], controller = new AbortController();
  const request = new Request('https://example.test/api/wattzun/voice', { method: 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Length': '3' }, body: 'abc', signal: controller.signal });
  const deps = { team: async scoped => { calls.push(scoped); return structuredClone(team); }, database: () => db,
    access: async (_, portal, scopeId) => ({ db, actorUid: team.actorUid, scope: { portal, scopeId, label: 'Council One' } }) };
  return { db, calls, controller, request, deps };
}
test('trade turn authority performs one canonical scoped read without consuming the original audio body', async () => {
  const f = fixture(), value = await authority.readWattzunTurnAuthority(f.request, 'trade', team.ownerUid, undefined, f.deps);
  assert.equal(f.calls.length, 1); assert.equal(value.access.db, f.db); assert.deepEqual(value.tradeTeam, team);
  assert.equal(f.calls[0].headers.get('X-TLink-Business'), team.ownerUid); assert.equal(f.calls[0].headers.get('Content-Length'), null);
  assert.equal(f.calls[0].headers.get('Authorization'), 'Bearer synthetic'); assert.equal(await f.calls[0].text(), '');
  assert.equal(await f.request.text(), 'abc'); assert.equal(authority.requireWattzunTurnTeam(value), value.tradeTeam);
});
test('every final read is independent and rejects actor, business and workspace label changes', async () => {
  for (const changed of [{ actorUid: 'other' }, { ownerUid: 'other' }, { businessName: 'Changed business' }]) {
    const f = fixture(), first = await authority.readWattzunTurnAuthority(f.request, 'trade', team.ownerUid, undefined, f.deps);
    f.deps.team = async () => ({ ...team, ...changed });
    await assert.rejects(authority.readWattzunTurnAuthority(f.request, 'trade', team.ownerUid, first, f.deps), error => error.status === 403);
  }
  const f = fixture(); await Promise.all([authority.readWattzunTurnAuthority(f.request, 'trade', team.ownerUid, undefined, f.deps), authority.readWattzunTurnAuthority(f.request, 'trade', team.ownerUid, undefined, f.deps)]);
  assert.equal(f.calls.length, 2);
});
test('Council and Creditex continue using their canonical portal access checks', async () => {
  for (const portal of ['council', 'creditex']) {
    const f = fixture(), value = await authority.readWattzunTurnAuthority(f.request, portal, 'scope-one', undefined, f.deps);
    assert.equal(value.tradeTeam, undefined); assert.equal(value.access.scope.portal, portal); assert.equal(f.calls.length, 0);
    assert.throws(() => authority.requireWattzunTurnTeam(value), error => error.status === 403);
  }
});
test('cancelled authority reads cannot return a usable snapshot', async () => {
  for (const timing of ['before', 'during']) {
    const f = fixture(); if (timing === 'before') f.controller.abort();
    else f.deps.team = async () => { f.controller.abort(); return team; };
    await assert.rejects(authority.readWattzunTurnAuthority(f.request, 'trade', team.ownerUid, undefined, f.deps), error => error.name === 'AbortError');
    if (timing === 'before') assert.equal(f.calls.length, 0);
  }
});
test('trusted team handoff rejects mismatched actor, scope, label and nontrade input', () => {
  const access = { actorUid: team.actorUid, scope: { portal: 'trade', scopeId: team.ownerUid, label: team.businessName } };
  for (const value of [{ access }, { access: { ...access, actorUid: 'other' }, tradeTeam: team },
    { access: { ...access, scope: { ...access.scope, label: 'other' } }, tradeTeam: team },
    { access: { ...access, scope: { ...access.scope, scopeId: 'other' } }, tradeTeam: team },
    { access: { ...access, scope: { ...access.scope, portal: 'council' } }, tradeTeam: team }]) {
    assert.throws(() => authority.requireWattzunTurnTeam(value), error => error.status === 403);
  }
});
