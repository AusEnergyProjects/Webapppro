import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { certificateTestDependency } from './helpers/creditex-training-fixture.mjs';

function fixture(mode) {
  const objects = new Map();
  let retained = null;
  let verifiedOwnership = false;
  const database = {
    prepare(query) {
      const statement = { query, values: [], bind(...values) { return { ...statement, values }; },
        async first() {
          if (query.includes('COUNT(*)')) return { count: 0 };
          assert.match(query, /WHERE id=\? AND owner_uid=\? AND object_key=\?/);
          assert.equal(this.values[1], 'owner');
          assert.equal(this.values[2], `creditex-onboarding/owner/${this.values[0]}`);
          verifiedOwnership = true;
          if (mode === 'uncertain-read') throw new Error('D1 read acknowledgement lost');
          return retained;
        },
      };
      return statement;
    },
    async batch(statements) {
      const inserted = statements.find(statement => statement.query.startsWith('INSERT INTO creditex_onboarding_documents'));
      assert.ok(inserted);
      if (mode !== 'not-committed') retained = { id: inserted.values[0] };
      throw new Error('D1 batch acknowledgement lost');
    },
  };
  const mocks = {
    'cloudflare:workers': { env: { EVIDENCE: {
      put: async (key, value) => { objects.set(key, value); },
      delete: async key => { assert.equal(verifiedOwnership, true); objects.delete(key); },
    } } },
    '../../../../db': { getD1: () => database },
    '@/lib/admin-server': { sameOrigin: () => true },
    '@/lib/creditex-onboarding-api': {
      requireCreditexOnboardingAccess: async () => ({ ownerUid: 'owner', actorUid: 'owner', isOwner: true }),
      creditexJson: (body, status = 200) => Response.json(body, { status }),
      creditexApiError: () => Response.json({ ok: false, code: 'CREDITEX_COMPLIANCE_UNAVAILABLE' }, { status: 503 }),
    },
    '@/lib/creditex-onboarding-server': certificateTestDependency('creditex-onboarding-server'),
    '@/lib/trade-team-member-files-server': {
      inspectTeamMemberFile: async file => ({ fileName: file.name, contentType: 'application/pdf',
        value: await file.arrayBuffer(), sizeBytes: file.size, sha256: 'a'.repeat(64) }),
    },
  };
  const output = ts.transpileModule(fs.readFileSync('src/app/api/creditex-onboarding/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(specifier => mocks[specifier] || {}, loaded, loaded.exports);
  return { route: loaded.exports, objects, retained: () => retained, verified: () => verifiedOwnership };
}
for (const [mode, objectCount] of [['not-committed', 0], ['committed', 1], ['uncertain-read', 1]]) {
  test(`private onboarding upload retains evidence safely after ${mode} batch acknowledgement`, async () => {
    const f = fixture(mode);
    const form = new FormData(); form.set('action', 'upload'); form.set('kind', 'insurance');
    form.set('file', new File(['%PDF-1.7 test'], 'insurance.pdf', { type: 'application/pdf' }));
    const response = await f.route.POST(new Request('https://example.test/api/creditex-onboarding', { method: 'POST', body: form }));
    assert.equal(response.status, 503, 'an uncertain write must not report success');
    assert.equal((await response.json()).ok, false);
    assert.equal(f.verified(), true);
    assert.equal(f.objects.size, objectCount);
    assert.equal(Boolean(f.retained()), mode !== 'not-committed');
  });
}
