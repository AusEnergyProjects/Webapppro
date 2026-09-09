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
  assert.doesNotMatch(wizard, /Job or profile details need attention/);
  assert.doesNotMatch(wizard, /TLink is missing system details/);
  assert.doesNotMatch(wizard, /Your work remains saved on this phone and will retry with the next save/);
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
  assert.match(wizard, /import \{ KeyboardAwareScrollView \} from '@\/components\/keyboard-aware-scroll-view'/);
  assert.match(wizard, /<KeyboardAwareScrollView/);
  assert.doesNotMatch(wizard, /scrollResponderScrollNativeHandleToKeyboard/);
  assert.match(wizard, /const transition = move\(1\);[\s\S]{0,100}if \(online\) queuePageSync\(fieldKeys\);[\s\S]{0,80}await transition;/);
  assert.match(wizard, /const syncWorkerRunning = useRef\(false\)/);
  assert.match(wizard, /const pendingSyncKeys = useRef\(new Set<string>\(\)\)/);
  assert.match(wizard, /const pendingFullUpload = useRef\(false\)/);
  assert.match(wizard, /if \(syncWorkerRunning\.current \|\| !online\) return/);
  assert.match(wizard, /do \{[\s\S]*\} while \(pendingFullUpload\.current \|\| pendingSyncKeys\.current\.size\)/);
  assert.match(wizard, /type PendingSignature =/);
  assert.match(wizard, /await syncPendingSignatures\(\)/);
  assert.match(wizard, /if \(online\) queuePageSync\(\[\], true\);/);
  assert.match(wizard, /Connectivity is the retry trigger/);
  assert.match(wizard, /import\s*\{[^}]*processActivityFormCompletionQueue[^}]*\}\s*from '@\/lib\/activity-form-completion'/s);
  assert.match(wizard, /Ready\. Tap Done once\. TLink will finish the upload and submission automatically in the background\./);
  assert.doesNotMatch(wizard, /Upload \{cache\.pending\.length\} pending files/);
  assert.doesNotMatch(wizard, /Submit completed form to Creditex/);
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

test('approved-product metadata drives the brand and filtered model choices for every supported activity', () => {
  const wizard = read('../src/components/ActivityFieldFormWizard.tsx');
  const library = read('../../src/lib/trade-activity-forms-library.ts');
  assert.match(wizard, /new URLSearchParams\(\{ recordId, view: 'official_products' \}\)/);
  assert.match(wizard, /field\.approvedProduct\?\.role === 'brand'/);
  assert.match(wizard, /field\.approvedProduct\?\.role === 'model'/);
  assert.match(wizard, /field\.approvedProduct\.brandFieldKey/);
  assert.match(wizard, /FieldSelect label="Choose approved brand"[\s\S]{0,160}options=\{approvedBrands\}/);
  assert.match(wizard, /FieldSelect label="Choose approved model"[\s\S]{0,180}options=\{approvedModels\[selectedBrand\] \|\| \[\]\}/);
  assert.match(wizard, /candidate\.approvedProduct\?\.role === 'model'[\s\S]{0,180}candidate\.approvedProduct\.brandFieldKey === field\.baseKey/);
  assert.match(wizard, /delete answers\[activityRepeatKey\(modelField\.key, field\.repeatIndex\)\]/);
  assert.match(wizard, /approvedBrands\.some\(\(option\) => option\.value === value\)/);
  assert.doesNotMatch(wizard, /activityTemplateId === 'veu-6'/);
  assert.doesNotMatch(wizard, /activity6Brand|activity6Model|selectedActivity6Brands/);
  assert.match(library, /"veu-3": \{ productKind: "veu_water_heater", veuActivityCodes: \["3C", "3D"\] \}/);
  assert.match(library, /"veu-6": \{ productKind: "veu_air_conditioner", veuActivityCodes: \["6"\] \}/);
  assert.match(wizard, /\$\{fieldMissing\.length\} required item/);
  assert.doesNotMatch(wizard, /\$\{record\.missing\.length\} required item/);
});

test('one signature page per signer covers every applicable declaration after the field pages', () => {
  const wizard = read('../src/components/ActivityFieldFormWizard.tsx');
  const { streamlinedActivityPages } = loadFunctions(wizard, ['streamlinedActivityPages']);
  const pages = [
    { key: 'before-fields', kind: 'fields', phase: 'before', section: 'Before', fields: [], legacyStepKeys: ['before-fields'] },
    { key: 'installer-a', kind: 'signature', phase: 'before', declaration: { key: 'installer-a', role: 'technician' }, legacyStepKeys: ['installer-a'] },
    { key: 'after-fields', kind: 'fields', phase: 'after', section: 'After', fields: [], legacyStepKeys: ['after-fields'] },
    { key: 'installer-b', kind: 'signature', phase: 'after', declaration: { key: 'installer-b', role: 'technician' }, legacyStepKeys: ['installer-b'] },
    { key: 'customer-a', kind: 'signature', phase: 'after', declaration: { key: 'customer-a', role: 'customer' }, legacyStepKeys: ['customer-a'] },
    { key: 'customer-b', kind: 'signature', phase: 'after', declaration: { key: 'customer-b', role: 'customer' }, legacyStepKeys: ['customer-b'] },
    { key: 'review', kind: 'review', legacyStepKeys: ['review'] },
  ];

  const result = streamlinedActivityPages(pages);
  assert.deepEqual(result.map((page) => page.kind), ['fields', 'fields', 'signature', 'signature', 'review']);
  assert.deepEqual(result[2].legacyStepKeys, ['installer-a', 'installer-b']);
  assert.deepEqual(result[3].legacyStepKeys, ['customer-a', 'customer-b']);
});

test('signature sync completes before-work declarations before any after-work signature', () => {
  const wizard = read('../src/components/ActivityFieldFormWizard.tsx');
  const { pendingSignatureToSync } = loadFunctions(wizard, ['pendingSignatureToSync']);
  const pending = [
    { declarationKey: 'installer-after', phase: 'after' },
    { declarationKey: 'customer-before', phase: 'before' },
    { declarationKey: 'customer-after', phase: 'after' },
  ];
  const requiredBefore = new Set(['installer-before', 'customer-before']);

  assert.equal(pendingSignatureToSync([pending[0]], requiredBefore, new Set(['installer-before'])), undefined);
  assert.equal(pendingSignatureToSync(pending, requiredBefore, new Set(['installer-before'])), pending[1]);
  assert.equal(pendingSignatureToSync([pending[0], pending[2]], requiredBefore,
    new Set(['installer-before', 'customer-before'])), pending[0]);
  assert.match(wizard, /activityWizardPages\(snapshot\.record\.form, snapshot\.answers\)[\s\S]{0,220}page\.declaration\.phase === 'before'[\s\S]{0,100}page\.declaration\.required/);
});

test('a grouped signature is retained for all covered declarations and final submission has a Done exit', () => {
  const wizard = read('../src/components/ActivityFieldFormWizard.tsx');
  assert.match(wizard, /const declarations = step\.legacyStepKeys\.flatMap[\s\S]{0,240}latest\.record\.form\.declarations\.find/);
  assert.match(wizard, /const queued = declarations\.filter[\s\S]{0,500}declarationKey: declaration\.key[\s\S]{0,500}strokes: signature\.strokes/);
  assert.match(wizard, /pendingSignatures: \[\.\.\.\(latest\.pendingSignatures \|\| \[\]\)\.filter[\s\S]{0,160}\.\.\.queued\]/);
  assert.match(wizard, /signatureReviewDeclaration[\s\S]{0,300}signatureDeclarations\.map/);
  assert.match(wizard, /One signature confirms all \{signatureDeclarations\.length\} declarations for this signer/);
  assert.match(wizard, /I have read and agree to \{signatureDeclarations\.length > 1 \? 'these declarations' : 'this declaration'\}/);
  assert.match(wizard, /const retryRevision = action === 'save' \|\| action === 'submit'/);
  assert.match(wizard, /step\?\.kind === 'review' \? 'Done'/);
  assert.match(wizard, /function finish\(\) \{\s*onReturnToJob\(\)/);
  assert.match(wizard, /async function finishImmediately\(\) \{[\s\S]{0,300}finishRequested: true[\s\S]{0,180}onReturnToJob\(\);[\s\S]{0,180}processActivityFormCompletionQueue\(cacheKey\)/);
  const finishImmediately = wizard.slice(wizard.indexOf('function finishImmediately()'), wizard.indexOf('async function share()'));
  assert.ok(finishImmediately.indexOf('onReturnToJob();') < finishImmediately.indexOf('processActivityFormCompletionQueue(cacheKey)'),
    'Done must return to the job before background completion starts');
  const beforeReturn = finishImmediately.slice(0, finishImmediately.indexOf('onReturnToJob();'));
  assert.match(beforeReturn, /await remember\(/, 'the durable local finish marker must be saved before returning');
  assert.doesNotMatch(beforeReturn, /apiRequest|processActivityFormCompletionQueue|request\(/,
    'Done must never wait for network work before returning');
  assert.match(wizard, /step\?\.kind === 'review' && record\.status === 'draft' \? void finishImmediately\(\)/);
  assert.match(wizard, /saved\.finishError[\s\S]{0,140}TLink could not finish this form in the background/);
  assert.doesNotMatch(wizard, /cache\.pending\.length > 0/);
  assert.doesNotMatch(wizard, /!online \|\| Boolean\(busy\).*review/);
  assert.match(wizard, /while \(true\) \{\s*const snapshot = cacheRef\.current;[\s\S]{0,500}const queued = pendingSignatureToSync/);
  assert.match(wizard, /const fieldMissing = steps\.flatMap/);
  assert.match(wizard, /for \(const signaturePage of pages\.filter\(\(page\) => page\.kind === 'signature'\)\)/);
  assert.doesNotMatch(wizard, /const fieldMissing = record\.missing\.filter/);
  assert.doesNotMatch(wizard, /step\?\.kind === 'review' \|\|/);
});
