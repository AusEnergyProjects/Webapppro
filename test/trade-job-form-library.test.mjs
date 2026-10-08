import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import * as catalogue from '../src/lib/australian-government-program-catalogue.ts';
import * as activityForms from '../src/lib/trade-activity-forms-library.ts';
import * as rental from '../src/lib/trade-rental-assessment.mjs';
import * as piesa from '../src/lib/veu-electrical-safety-form.ts';
import * as supporting from '../src/lib/trade-form-library.mjs';
import * as services from '../src/lib/energy-service-catalogue.mjs';
import * as contracts from '../src/lib/trade-job-form-library.ts';

function compile(path, dependencies) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(name in dependencies, `Unmapped dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return record.exports;
}
const intent = compile('src/lib/trade-compliance-intent.ts', { './australian-government-program-catalogue': catalogue });
function builder(loader = {}) {
  return compile('src/lib/trade-job-form-library-server.ts', {
    './australian-government-program-catalogue': catalogue, './trade-activity-forms-library': activityForms,
    './trade-compliance-intent': intent, './trade-rental-assessment.mjs': rental,
    './veu-electrical-safety-form': piesa, './trade-form-templates-server': loader, './trade-job-form-library': contracts,
  });
}
const template = (extras = {}) => ({ key: 'business-electrical-check', version: 3, name: 'Our electrical form',
  jurisdiction: 'AU', categories: ['electrical'], description: 'Published by this business', guidance: '', fields: [], governed: false, ...extras });
const input = (extras = {}) => ({ serviceCategory: 'electrical', addressState: 'VIC', buildingType: 'house_townhouse', businessTemplates: [], ...extras });

test('one library lists every actual Creditex activity, four canonical rental forms and PIESA without invented supporting forms', () => {
  const options = builder().buildTradeJobFormLibrary(input());
  assert.equal(options.filter(option => option.selection.kind === 'creditex').length, activityForms.activityFieldCatalogue().length);
  assert.equal(options.filter(option => option.selection.kind === 'rental').length, 4);
  assert.ok(options.some(option => option.selection.kind === 'rental' && option.selection.moduleKey === 'minimum_standards'));
  const electrical = options.find(option => option.selection.kind === 'piesa');
  assert.equal(electrical.name, piesa.createVeuElectricalForm().title);
  assert.equal(electrical.id, 'piesa:veu-pre-installation-electrical-safety-assessment');
  assert.equal(new Set(options.map(option => option.id)).size, options.length);
  assert.doesNotMatch(JSON.stringify(options), /Pre-start risk and site readiness|Scheduled service visit record|"fields"|"answers"/);
  for (const option of options) assert.equal(option.id, contracts.tradeJobFormSelectionId(option.selection));
});

test('actual premises variants and jurisdiction availability are derived from the canonical rules', () => {
  const residential = builder().buildTradeJobFormLibrary(input());
  const business = builder().buildTradeJobFormLibrary(input({ buildingType: 'commercial_office' }));
  const unknown = builder().buildTradeJobFormLibrary(input({ buildingType: 'not_sure' }));
  for (const id of ['veu-1', 'veu-3', 'veu-6']) {
    const find = list => list.find(option => option.selection.kind === 'creditex' && option.selection.activityTemplateId === id);
    assert.match(find(residential).selection.variantId, /_residential$/);
    assert.match(find(business).selection.variantId, /_business$/);
    assert.match(find(unknown).unavailableReason, /Choose residential or business premises/);
  }
  const nsw = builder().buildTradeJobFormLibrary(input({ addressState: 'NSW' }));
  assert.match(nsw.find(option => option.selection.kind === 'rental').unavailableReason, /Victorian/);
  assert.match(nsw.find(option => option.selection.kind === 'piesa').unavailableReason, /Victorian/);
  assert.match(nsw.find(option => option.selection.kind === 'creditex' && option.jurisdiction === 'VIC').unavailableReason, /not available|closed|commenced|specialist/);
  assert.ok(nsw.some(option => option.selection.kind === 'creditex' && option.jurisdiction === 'AU' && !option.unavailableReason));
});

test('published business forms across categories remain searchable with precise unavailable reasons', () => {
  const options = builder().buildTradeJobFormLibrary(input({ businessTemplates: [template(), template({ key: 'business-solar', name: 'Solar handover', categories: ['solar'] }),
    template({ key: 'business-nsw', name: 'NSW electrical', jurisdiction: 'NSW' })] }));
  const own = options.find(option => option.selection.kind === 'business' && option.name === 'Our electrical form');
  assert.equal(own.unavailableReason, ''); assert.deepEqual(own.categories, ['electrical']);
  assert.match(own.searchText, /our electrical form.*business forms.*au.*published by this business.*electrical/);
  assert.match(options.find(option => option.name === 'Solar handover').unavailableReason, /work type/);
  assert.match(options.find(option => option.name === 'NSW electrical').unavailableReason, /NSW properties/);
});

test('saved job library preserves actual worker eligibility and already attached IDs, without job answers', () => {
  const saved = { revision: 7, canAdd: true, unavailableReason: '', activities: [{ id: 'veu-1', programTemplateId: 'vic-veu', added: true, unavailableReason: 'Assigned worker must complete training.' }],
    rentalModules: [{ id: 'minimum_standards', added: true, unavailableReason: '' }, { id: 'electrical_safety_check', added: false, unavailableReason: 'A current electrician credential is required.' }] };
  // Use the canonical programme identity rather than assuming its ID.
  saved.activities[0].programTemplateId = catalogue.GOVERNMENT_PROGRAM_TEMPLATES.find(program => program.programCode === 'VEU').templateId;
  const options = builder().buildTradeJobFormLibrary(input({ saved, businessTemplates: [template()], attachedBusinessIds: ['business:business-electrical-check:3'], piesaAdded: true }));
  assert.equal(options.find(option => option.selection.kind === 'creditex' && option.selection.activityTemplateId === 'veu-1').added, true);
  assert.equal(options.find(option => option.selection.kind === 'creditex' && option.selection.activityTemplateId === 'veu-1').unavailableReason, 'Assigned worker must complete training.');
  assert.equal(options.find(option => option.selection.kind === 'rental' && option.selection.moduleKey === 'minimum_standards').added, true);
  assert.match(options.find(option => option.selection.kind === 'rental' && option.selection.moduleKey === 'electrical_safety_check').unavailableReason, /electrician credential/);
  assert.equal(options.find(option => option.selection.kind === 'business').added, true);
  assert.equal(options.find(option => option.selection.kind === 'piesa').added, true);
  assert.match(options.find(option => option.selection.kind === 'creditex' && option.selection.activityTemplateId !== 'veu-1' && option.jurisdiction === 'VIC').unavailableReason, /cannot be added|closed|commenced|specialist/);
});

test('published library loader scopes all categories to owner/global and excludes drafts, retired versions and generic defaults', async t => {
  const database = new DatabaseSync(':memory:'); t.after(() => database.close());
  database.exec(`CREATE TABLE trade_form_templates(template_key TEXT,version INTEGER,name TEXT,jurisdiction TEXT,categories TEXT,description TEXT,guidance TEXT,fields TEXT,status TEXT,scope_owner_uid TEXT);
    INSERT INTO trade_form_templates VALUES
    ('owner-electric',1,'Own electrical','AU','["electrical"]','','','[]','published','owner'),
    ('owner-solar',1,'Own solar','AU','["solar"]','','','[]','published','owner'),
    ('global-form',1,'Global published','AU','["insulation"]','','','[]','published',''),
    ('foreign-secret',1,'Foreign secret','AU','["electrical"]','','','[]','published','foreign'),
    ('owner-draft',1,'Unpublished draft','AU','["electrical"]','','','[]','draft','owner'),
    ('owner-retired',1,'Old published','AU','["electrical"]','','','[]','published','owner'),
    ('owner-retired',2,'Retired latest','AU','["electrical"]','','','[]','retired','owner');`);
  const db = { prepare: sql => ({ bind: (...bindings) => ({ all: async () => ({ results: database.prepare(sql).all(...bindings) }) }) }) };
  const loader = compile('src/lib/trade-form-templates-server.ts', { '../../db': { getD1: () => db }, '@/lib/trade-form-library.mjs': supporting });
  const all = await loader.publishedTradeFormTemplatesFor('electrical', db, 'owner', { allCategories: true, includeBuiltIns: false });
  assert.deepEqual(all.map(form => form.name).sort(), ['Global published', 'Own electrical', 'Own solar']);
  const existing = await loader.publishedTradeFormTemplatesFor('electrical', db, 'owner');
  assert.ok(existing.some(form => form.key === 'pre-start-risk-readiness'));
  assert.ok(existing.some(form => form.key === 'owner-electric'));
  assert.ok(!existing.some(form => form.key === 'owner-solar'));
  const result = await builder(loader).loadTradeJobFormLibrary(input(), db, 'owner');
  assert.deepEqual(result.filter(option => option.selection.kind === 'business').map(option => option.name).sort(), all.map(form => form.name).sort());
  assert.doesNotMatch(JSON.stringify(result), /Foreign secret|Unpublished draft|Old published|Retired latest|Pre-start risk and site readiness/);
});

class TradeFormSelectionError extends Error { constructor(message, status) { super(message); this.status = status; } }
class TradeBusinessContextError extends Error {}
function routeFixture(overrides = {}) {
  const calls = [];
  const access = { ownerUid: 'owner', actorUid: 'owner', canManageFieldEvidence: true, ...overrides.access };
  const db = { prepare: sql => ({ bind: (...bindings) => {
    calls.push({ sql, bindings });
    return { first: async () => sql.includes('FROM trade_work_orders') ? { service_category: 'electrical', stage: overrides.stage || 'scheduled', building_type: 'house_townhouse', address_state: 'VIC' }
      : sql.includes('trade_veu_electrical_assessments') ? { id: 'existing-piesa' } : null,
    all: async () => ({ results: [{ template_key: 'business-electrical-check', template_version: 3 }] }) };
  } }) };
  const captured = [];
  const route = compile('src/app/api/trade-job-form-library/route.ts', {
    '../../../../db': { getD1: () => db }, '@/lib/admin-server': { adminJson: (body, status = 200) => Response.json(body, { status }),
      mfaErrorResponse: () => null, sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin },
    '@/lib/trade-team-server': { requireInstallerTeamAccess: async () => { if (overrides.authError) throw new Error(overrides.authError); return access; } },
    '@/lib/trade-business-context-server': { TradeBusinessContextError },
    '@/lib/trade-job-form-attachment-server': { TradeFormSelectionError, assertTradeFormAttachmentAccess: async () => { if (!access.canManageFieldEvidence) throw new TradeFormSelectionError('Field form access is required.', 403); } },
    '@/lib/energy-service-catalogue.mjs': services,
    '@/lib/trade-job-form-library-server': { loadTradeJobFormLibrary: async (input, database, ownerUid) => { captured.push({ input, database, ownerUid }); return [{ id: 'rental:minimum_standards' }]; } },
    '../field/job-activities/route': { GET: async request => {
      captured.push({ activityRequest: request });
      return overrides.activityResponse || Response.json({ ok: true, revision: 8, canAdd: true, unavailableReason: '', activities: [],
        rentalModules: [{ id: 'minimum_standards', added: true, unavailableReason: '' }], answers: { secret: 'Never return this' }, customerEmail: 'private@example.test' });
    } },
  });
  return { calls, captured, get: (query, headers = {}) => route.GET(new Request(`https://example.test/api/trade-job-form-library?${query}`, { headers })) };
}

test('new catalogue rejects cross-origin, denied access and invalid context before listing metadata', async () => {
  const f = routeFixture(); assert.equal((await f.get('serviceCategory=electrical', { origin: 'https://foreign.test' })).status, 403);
  assert.equal((await routeFixture({ access: { canManageFieldEvidence: false } }).get('serviceCategory=electrical')).status, 403);
  assert.equal((await routeFixture({ authError: 'EMAIL_VERIFICATION_REQUIRED' }).get('serviceCategory=electrical')).status, 403);
  for (const query of ['serviceCategory=made-up', 'serviceCategory=electrical&addressState=NOPE', 'serviceCategory=electrical&buildingType=made-up']) assert.equal((await f.get(query)).status, 400);
  assert.equal(f.captured.length, 0);
  const result = await f.get('serviceCategory=electrical&addressState=vic&buildingType=house_townhouse');
  assert.equal(result.status, 200); assert.equal(f.captured[0].input.addressState, 'VIC'); assert.equal(f.captured[0].ownerUid, 'owner');
});

test('saved catalogue forwards original auth and uses actual job context, attached IDs and revision without leaking unrelated fields', async () => {
  const f = routeFixture();
  const response = await f.get('workOrderId=job&serviceCategory=solar&addressState=NSW&buildingType=commercial_office', { authorization: 'Bearer fixture', 'x-trade-owner-uid': 'owner' });
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.revision, 8); assert.doesNotMatch(JSON.stringify(body), /secret|Never return|private@example|answers/);
  assert.equal(new URL(f.captured[0].activityRequest.url).search, '?workOrderId=job');
  assert.equal(f.captured[0].activityRequest.headers.get('authorization'), 'Bearer fixture');
  assert.equal(f.captured[0].activityRequest.headers.get('x-trade-owner-uid'), 'owner');
  const loaded = f.captured[1]; assert.equal(loaded.input.serviceCategory, 'electrical'); assert.equal(loaded.input.addressState, 'VIC');
  assert.equal(loaded.input.buildingType, 'house_townhouse'); assert.deepEqual(loaded.input.attachedBusinessIds, ['business:business-electrical-check:3']); assert.equal(loaded.input.piesaAdded, true);
  for (const call of f.calls) assert.deepEqual(call.bindings, ['job', 'owner']);
});

test('saved catalogue retains unavailable job failures and never substitutes an unscoped list', async () => {
  const f = routeFixture({ activityResponse: Response.json({ ok: false, error: 'This job is not available.' }, { status: 404 }) });
  assert.equal((await f.get('workOrderId=foreign-job')).status, 404); assert.equal(f.calls.length, 0); assert.equal(f.captured.length, 1);
  const malformed = routeFixture({ activityResponse: Response.json({ ok: true, revision: 9, activities: [] }) });
  assert.equal((await malformed.get('workOrderId=job')).status, 503); assert.equal(malformed.calls.length, 0);
});

test('completed job marks generic and PIESA forms unavailable as well as canonical activity eligibility', async () => {
  const f = routeFixture({ stage: 'completed' }); await f.get('workOrderId=job');
  assert.match(f.captured[1].input.piesaUnavailableReason, /completed/);
  assert.match(f.captured[1].input.businessUnavailableReason, /completed/);
  const options = builder().buildTradeJobFormLibrary(input({ businessTemplates: [template()], businessUnavailableReason: 'Completed job is locked.' }));
  assert.equal(options.find(option => option.selection.kind === 'business').unavailableReason, 'Completed job is locked.');
});
