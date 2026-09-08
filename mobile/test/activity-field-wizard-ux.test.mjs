import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function loadFunctions(source, names) {
  const sourceFile = ts.createSourceFile('subject.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = sourceFile.statements.filter((statement) => ts.isFunctionDeclaration(statement) && statement.name && names.includes(statement.name.text));
  assert.deepEqual(declarations.map((statement) => statement.name.text), names);
  const output = ts.transpileModule(declarations.map((statement) => statement.getFullText(sourceFile)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(`${output}\nreturn { ${names.join(', ')} };`)();
}

const helperSource = read('../src/lib/activity-field-wizard.ts');
const helperCode = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const helperExports = {};
const flowCode = ts.transpileModule(read('../../src/lib/trade-activity-form-flow.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const flowExports = {};
new Function('exports', flowCode)(flowExports);
new Function('exports', 'require', helperCode)(helperExports, () => flowExports);

const { activityCurrentSignatureKeys, activityOptionLabel, activityProgress, activitySectionProgress,
  activitySignerDefault, mergeActivityAnswers } = helperExports;

test('sequential saves reconcile disjoint server changes without dropping phone answers', () => {
  const result = mergeActivityAnswers(
    { customer: 'Sam', systemDelivery: 'pending' },
    { customer: 'Sam', systemDelivery: 'pending', existingSystem: 'ducted gas' },
    { customer: 'Sam', systemDelivery: 'emailed' },
  );
  assert.deepEqual(result, {
    merged: { customer: 'Sam', systemDelivery: 'emailed', existingSystem: 'ducted gas' },
    conflicts: [],
  });
});

test('the current phone answer wins automatically when the same answer changed remotely', () => {
  const result = mergeActivityAnswers(
    { existingSystem: 'gas' },
    { existingSystem: 'electric' },
    { existingSystem: 'wood' },
  );
  assert.deepEqual(result.conflicts, ['existingSystem']);
  assert.equal(result.merged.existingSystem, 'electric');
});

test('system-derived answers always follow the latest portal record', () => {
  const derived = new Set(['installer.name']);
  const result = mergeActivityAnswers(
    { 'installer.name': 'Old team member', existingSystem: 'gas' },
    { 'installer.name': 'Typed over on phone', existingSystem: 'electric' },
    { 'installer.name': 'Assigned technician', existingSystem: 'gas' },
    derived,
  );
  assert.deepEqual(result, {
    merged: { 'installer.name': 'Assigned technician', existingSystem: 'electric' },
    conflicts: [],
  });
});

test('resolving a same-key conflict preserves every disjoint edit', () => {
  const base = { existingSystem: 'gas', customerNote: 'Gate closed', officeNote: 'Call ahead' };
  const local = { existingSystem: 'electric', customerNote: 'Gate open', officeNote: 'Call ahead' };
  const remote = { existingSystem: 'wood', customerNote: 'Gate closed', officeNote: 'Tenant confirmed' };
  assert.deepEqual(mergeActivityAnswers(base, local, remote, new Set(), 'remote').merged, {
    existingSystem: 'wood', customerNote: 'Gate open', officeNote: 'Tenant confirmed',
  });
  assert.deepEqual(mergeActivityAnswers(base, local, remote, new Set(), 'local').merged, {
    existingSystem: 'electric', customerNote: 'Gate open', officeNote: 'Tenant confirmed',
  });
});

test('raw option codes always have a readable fallback while explicit governed labels win', () => {
  assert.equal(activityOptionLabel('retain_unsafe_or_impractical'), 'Retain because removal is unsafe or impractical');
  assert.equal(activityOptionLabel('iii'), 'Scenario III');
  assert.equal(activityOptionLabel('some'), 'Some');
  assert.equal(activityOptionLabel('iii', 'Scenario III: Ducted gas heater replaced by a multi-split system'), 'Scenario III: Ducted gas heater replaced by a multi-split system');
});

test('overall and section progress count required work and local evidence only', () => {
  const steps = [
    { key: 'customer', kind: 'field', field: { key: 'customer', section: 'Customer', phase: 'before', type: 'text', required: true } },
    { key: 'existing-photo', kind: 'field', field: { key: 'existing-photo', section: 'Existing equipment', phase: 'before', type: 'photo', required: true } },
    { key: 'notes', kind: 'field', field: { key: 'notes', section: 'Existing equipment', phase: 'before', type: 'text', required: false } },
    { key: 'installer-declaration:read:0', kind: 'declaration' },
    { key: 'installer-declaration:read:1', kind: 'declaration' },
    { key: 'installer-signature', kind: 'signature', declaration: { key: 'installer-signature', required: true } },
    { key: 'optional-declaration:read:0', kind: 'declaration' },
    { key: 'optional-signature', kind: 'signature', declaration: { key: 'optional-signature', required: false } },
    { key: 'review', kind: 'review' },
  ];
  const evidence = new Set(['existing-photo']);
  const answers = { customer: 'Sam', notes: 'Optional note already supplied' };
  assert.deepEqual(activityProgress(steps, answers, evidence, new Set(['optional-signature'])), { complete: 2, total: 3 });
  assert.deepEqual(activityProgress(steps, answers, evidence, new Set(['installer-signature', 'optional-signature'])), { complete: 3, total: 3 });
  assert.deepEqual(activitySectionProgress(steps, answers, evidence), [
    { key: 'before:Customer', phase: 'before', label: 'Customer', firstStepKey: 'customer', complete: 1, total: 1 },
    { key: 'before:Existing equipment', phase: 'before', label: 'Existing equipment', firstStepKey: 'existing-photo', complete: 1, total: 1 },
  ]);
});

test('invalidated audit signatures do not count as current progress', () => {
  const signatures = [{ declarationKey: 'customer-signature' }, { declarationKey: 'technician-signature' }];
  const current = activityCurrentSignatureKeys(signatures, [
    { key: 'customer-signature', kind: 'signature' },
    { key: 'missing-photo', kind: 'evidence' },
  ]);
  assert.deepEqual([...current], ['technician-signature']);
});

test('only customer and technician signatures use their matching profile default', () => {
  const record = { signerDefaults: { customer: 'Casey Customer', technician: 'Alex Worker' } };
  assert.equal(activitySignerDefault(record, 'customer'), 'Casey Customer');
  assert.equal(activitySignerDefault(record, 'technician'), 'Alex Worker');
  assert.equal(activitySignerDefault(record, 'designer'), '');
  assert.equal(activitySignerDefault(record, 'retailer'), '');
  assert.equal(activitySignerDefault(record, 'other'), '');
});

test('untouched F4-style optional steps cannot produce a misleading 59 of 61 total', () => {
  const optionalSteps = Array.from({ length: 59 }, (_, index) => ({
    key: `optional-${index}`,
    kind: 'field',
    field: { key: `optional-${index}`, section: 'Imported context', phase: 'before', type: 'text', required: false },
  }));
  const steps = [
    ...optionalSteps,
    { key: 'customer-signature', kind: 'signature', declaration: { key: 'customer-signature', required: true } },
    { key: 'technician-signature', kind: 'signature', declaration: { key: 'technician-signature', required: true } },
  ];
  assert.deepEqual(activityProgress(steps, {}, new Set(), new Set()), { complete: 0, total: 2 });
});

test('an optional-only section stays navigable without inflating progress', () => {
  const steps = [
    { key: 'optional-note', kind: 'field', field: { key: 'optional-note', section: 'Optional notes', phase: 'after', type: 'text', required: false } },
    { key: 'review', kind: 'review' },
  ];
  const answers = { 'optional-note': 'Still useful' };
  assert.deepEqual(activityProgress(steps, answers, new Set(), new Set()), { complete: 0, total: 0 });
  assert.deepEqual(activitySectionProgress(steps, answers, new Set()), [
    { key: 'after:Optional notes', phase: 'after', label: 'Optional notes', firstStepKey: 'optional-note', complete: 0, total: 0 },
  ]);
});

test('customer signer follows the latest booked contact until the signer edits or draws', () => {
  const wizard = read('../src/components/ActivityFieldFormWizard.tsx');
  const { signatureDraft, rebaseUntouchedSignatureDraft } = loadFunctions(wizard, ['signatureDraft', 'rebaseUntouchedSignatureDraft']);

  const priorDefault = signatureDraft('customer', 'Jordan Old');
  assert.deepEqual(
    rebaseUntouchedSignatureDraft(priorDefault, 'customer', 'Jordan Old', 'Casey Customer'),
    signatureDraft('customer', 'Casey Customer'),
  );
  assert.deepEqual(
    rebaseUntouchedSignatureDraft(signatureDraft('customer', ''), 'customer', 'Jordan Old', 'Casey Customer'),
    signatureDraft('customer', 'Casey Customer'),
  );

  const alternateSigner = { ...priorDefault, signerName: 'Taylor Tenant' };
  assert.strictEqual(
    rebaseUntouchedSignatureDraft(alternateSigner, 'customer', 'Jordan Old', 'Casey Customer'),
    alternateSigner,
  );

  const drawnSignature = { ...priorDefault, strokes: [{ strokeKey: 'stroke-1', points: [{ x: 1, y: 2, t: 3 }] }] };
  assert.strictEqual(
    rebaseUntouchedSignatureDraft(drawnSignature, 'customer', 'Jordan Old', 'Casey Customer'),
    drawnSignature,
  );
  assert.match(wizard, /setSignature\(\(current\) => rebaseUntouchedSignatureDraft\(current, target\.declaration\.role, previousDefault, nextDefault\)\)/);
});

test('the native wizard uses Expo 57 File parts and hierarchical back navigation', () => {
  const wizard = read('../src/components/ActivityFieldFormWizard.tsx');
  assert.match(wizard, /await file\.copy\(kept\)/);
  assert.match(wizard, /form\.append\('file', originalFile\)/);
  assert.match(wizard, /form\.append\('preview', new File\(previewUri\)\)/);
  assert.doesNotMatch(wizard, /as unknown as Blob/);
  assert.match(wizard, /usePreventRemove\(true/);
  assert.match(wizard, /if \(!overview\) \{\s*setOverview\(true\)/);
  assert.match(wizard, /activityOptionLabel\(value, field\?\.optionLabels\?\.\[value\]\)/);
  assert.doesNotMatch(wizard, /resend_activity_customer_documents|Resend customer documents|Customer documents need attention/);
  assert.match(wizard, /Job or profile details need attention/);
  assert.match(wizard, /TLink is missing system details/);
  assert.match(wizard, /step\.declaration\.role === 'technician' \? latest\.record\.signerDefaults\.technician : signature\.signerName\.trim\(\)/);
  assert.match(wizard, /identitySource: technicianSignature \? 'assigned_worker'/);
  assert.match(wizard, /Technician identity comes from the active team member assigned to this job/);
  assert.match(wizard, /value=\{signature\.signerName\} placeholder="Signer's full name"/);
  assert.match(wizard, /signatureDraft\(target\.declaration\.role, activitySignerDefault\(value\.record, target\.declaration\.role\)\)/);
  assert.doesNotMatch(wizard, /FieldSelect label="Activity type"/);
  assert.match(wizard, /total \? `\$\{complete\}\/\$\{total\}` : 'Optional'/);
  assert.doesNotMatch(wizard, /Review latest saved version/);
  assert.doesNotMatch(wizard, /Your latest work is saved on this phone\. Tap Next to continue saving/);
  assert.match(wizard, /await waitForBackgroundSync\(\)/);
  assert.doesNotMatch(wizard, /disabled=\{[^}]*syncing/);
  assert.match(wizard, /disabled=\{!editable \|\| Boolean\(busy\) \|\| repeatItemHasSavedEvidence\}/);
  assert.match(wizard, /scrollResponderScrollNativeHandleToKeyboard\(event\.target, 96, true\)/);
  assert.match(wizard, /const transition = move\(1\);[\s\S]{0,100}if \(online\) queuePageSync\(fieldKeys\);[\s\S]{0,80}await transition;/);
  assert.match(wizard, /syncs\.current = syncs\.current\.catch\(\(\) => undefined\)\.then/);
  assert.match(wizard, /type PendingSignature =/);
  assert.match(wizard, /await syncPendingSignatures\(\)/);
  assert.match(wizard, /if \(online\) queuePageSync\(\[\], true\);/);
  assert.match(wizard, /Connectivity is the retry trigger/);
  assert.match(wizard, /await waitForBackgroundSync\(\); await saveAnswers\(\); await syncPendingSignatures\(\); await request\('submit'\)/);
  assert.match(wizard, /Signature saved on this phone\. TLink is syncing it automatically\./);
  assert.match(wizard, /signingUserContentChanged/);
  assert.doesNotMatch(wizard, /The details to sign have changed/);
  const instantSignatureStart = wizard.indexOf("if (step.kind === 'signature' && !currentSignature && !pendingSignature)");
  const nextPerformStart = wizard.indexOf("await perform('next'", instantSignatureStart);
  assert.ok(instantSignatureStart >= 0 && nextPerformStart > instantSignatureStart);
  const instantSignature = wizard.slice(instantSignatureStart, nextPerformStart);
  assert.doesNotMatch(instantSignature, /await (?:saveAnswers|waitForBackgroundSync|request\('sign'|syncs\.current)/);
  assert.match(instantSignature, /void transition\.catch/);
  assert.doesNotMatch(wizard, /const locked =/);
  assert.doesNotMatch(wizard, /ACTIVITY_SIGNED_SCOPE_LOCKED/);
  assert.match(wizard, /mergeActivityAnswers\(snapshot\.answers, current\.answers, nextRecord\.answers/);
  assert.match(wizard, /showRepeatActions && repeatField\?\.repeatGroup/);
  assert.match(wizard, /variant="secondary"/);
  assert.match(wizard, />Add another \{repeatItemLabel\}<\/FieldButton>/);
  assert.match(wizard, /variant="danger"/);
  assert.match(wizard, />Remove this \{repeatItemLabel\}<\/FieldButton>/);
  assert.doesNotMatch(wizard, /field\.repeatGroup\.replaceAll/);
  assert.doesNotMatch(wizard, /Step \{stepIndex \+ 1\} of \{steps\.length\}/);
});
