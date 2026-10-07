import assert from 'node:assert/strict';
import test from 'node:test';
import { creditexAuditFromSearch, creditexAuditHref, creditexAuditPanelFromHash } from '../src/lib/creditex-workspace-navigation.ts';

test('exact audit links round-trip through the narrow Creditex parser without granting authority', () => {
  for (const id of ['synthetic-audit', 'activity:one_2', 'a'.repeat(180)]) {
    for (const panel of ['creditex-full-audit-title', 'audit-records', 'audit-files', 'audit-requirements', 'audit-findings']) {
      const link = new URL(creditexAuditHref(id, panel), 'https://example.test');
      assert.equal(link.pathname, '/creditex/compliance'); assert.equal(link.hash, `#${panel}`);
      assert.equal(creditexAuditFromSearch(link.search), id);
      assert.equal(creditexAuditPanelFromHash(link.hash), panel);
      assert.equal(link.searchParams.get('workspace'), 'cases');
      assert.equal(link.searchParams.get('actorMode'), null); assert.equal(link.searchParams.get('organisationId'), null);
    }
  }
});

test('missing, malformed or ambiguous audit selection cannot select a private record', () => {
  for (const search of ['', '?workspace=cases', '?workspace=cases&intentId=', '?workspace=home&intentId=a',
    '?workspace=cases&workspace=cases&intentId=a', '?workspace=cases&intentId=a&intentId=b', '?workspace=cases&intentId=..%2Fa',
    '?workspace=cases&intentId=https%3A%2F%2Fevil.invalid', '?workspace=cases&intentId=bad%20name', `?workspace=cases&intentId=${'a'.repeat(181)}`]) {
    assert.equal(creditexAuditFromSearch(search), null, search);
  }
  for (const id of ['', '../escape', 'https://evil.invalid', 'a'.repeat(181)]) assert.throws(() => creditexAuditHref(id));
  for (const hash of ['', '#', '#foreign-id', '#audit-files?intentId=other']) assert.equal(creditexAuditPanelFromHash(hash), null);
});
