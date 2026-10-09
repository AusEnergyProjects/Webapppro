import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { rentalAssessorFields, rentalObservationNumberIsValid, rentalObservationBlockers, rentalSharedObservationResponse, rentalObservationFieldIsVisible } from '../../src/lib/rental-quotation.mjs';
import { rentalAssessorCheckPresentation, rentalAssessorEvidenceRequirement, rentalAssessorMetadataField, rentalAssessorOutcomePatch } from '../../src/lib/rental-assessor-workflow.mjs';
import { RENTAL_ASSESSMENT_TEMPLATE_VERSION, rentalAssessmentTemplateSnapshot } from '../../src/lib/trade-rental-assessment.mjs';

const code = ts.transpileModule(readFileSync(new URL('../src/lib/rental-inspection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('exports', code)(exports);
const { rentalObservationsComplete, deliverRentalPhoto, rentalCompletionTarget, rentalPendingCompletionBlockers, newRentalItem } = exports;

test('final declarations require real observation and evidence completion', () => {
  const result = (blockers) => ({ completion: { assessment: { complete: false, blockers } } });
  assert.equal(rentalObservationsComplete({}, 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'check:heating:working', label: 'Missing answer' }]), 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'evidence:heating', label: 'Missing photo' }]), 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'finding:heating', label: 'Missing finding' }]), 'assessment'), false);
  assert.equal(rentalObservationsComplete(result([{ key: 'metadata:assessorDeclaration', label: 'Final declaration' }]), 'assessment'), true);
});

test('a failed photo link retries its durably remembered media file without uploading a duplicate', async () => {
  const calls = [];
  let remembered;
  const upload = async () => { calls.push('upload'); return 'job-photo-1'; };
  const remember = async (id) => { calls.push('remember'); remembered = id; };
  await assert.rejects(() => deliverRentalPhoto({ upload, remember, link: async (id) => {
    calls.push('link'); assert.equal(id, remembered); throw new Error('Connection dropped');
  } }), /Connection dropped/);
  const result = await deliverRentalPhoto({ mediaId: remembered, upload, remember, link: async (id) => { calls.push('retry-link'); return { mediaId: id }; } });
  assert.equal(result.mediaId, 'job-photo-1');
  assert.deepEqual(calls, ['upload', 'remember', 'link', 'retry-link']);
});

test('photo linking cannot run before its upload reference has been saved locally', async () => {
  let linked = false;
  await assert.rejects(() => deliverRentalPhoto({ upload: async () => 'media-1', remember: async () => { throw new Error('Local storage full'); },
    link: async () => { linked = true; } }), /Local storage full/);
  assert.equal(linked, false);
});

const source = readFileSync(new URL('../src/components/rental-inspection-workflow.tsx', import.meta.url), 'utf8');
const findingHelper = ts.transpileModule(source.slice(source.indexOf('function findingChoices('), source.indexOf('export function RentalInspectionWorkflow')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { findingDescription, findingChoices } = new Function(`${findingHelper}; return { findingDescription, findingChoices };`)();

function mountedOpenQueuedAnswer(environment) {
  const implementation = source.slice(source.indexOf('  function openQueuedAnswer('), source.indexOf('  function openCompletionIssue('));
  const compiled = ts.transpileModule(`export ${implementation.trim()}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', `with (environment) { const exports = {}; ${compiled}; return exports.openQueuedAnswer; }`)(environment);
}

function photoReviewEnvironment() {
  const changes = {};
  return {
    changes, saves: [],
    data: {
      modules: [{ id: 'assessment', template: { sections: [{ key: 'heating', checks: [{ key: 'heater_works' }] }] } }],
      evidence: [{ id: 'mistaken-photo', itemId: 'heater-answer' }],
      items: [{ id: 'heater-answer', moduleId: 'assessment', sectionKey: 'heating', checkKey: 'heater_works', instanceKey: 'property' }],
    },
    setModuleId(value) { changes.moduleId = value; }, setCursor(value) { changes.cursor = value; },
    setPage(value) { changes.page = value; }, setError(value) { changes.error = value; },
  };
}

test('a legacy photo-removal conflict opens its actual saved photo question without body module fields', () => {
  const env = photoReviewEnvironment();
  mountedOpenQueuedAnswer(env)({ module: { id: 'assessment' }, body: { action: 'unlink_evidence' }, photoRemoval: { evidenceId: 'mistaken-photo' } });
  assert.deepEqual(env.changes, { moduleId: 'assessment', cursor: { sectionKey: 'heating', checkIndex: 0, instanceKey: 'property' }, page: 'answer', error: '' });
});

test('a pending-photo removal opens the source answer before that answer has synced', () => {
  const env = photoReviewEnvironment();
  env.saves = [{ id: 'local-save', body: { sectionKey: 'heating', checkKey: 'heater_works', instanceKey: 'heater-2' } }];
  mountedOpenQueuedAnswer(env)({ module: { id: 'assessment' }, body: { action: 'unlink_evidence' }, photoRemoval: { sourceSaveId: 'local-save', uri: 'local-photo' } });
  assert.deepEqual(env.changes.cursor, { sectionKey: 'heating', checkIndex: 0, instanceKey: 'heater-2' });
  assert.equal(env.changes.page, 'answer');
});

test('a missing photo target returns to sections with an explanation instead of opening an unrelated answer', () => {
  const env = photoReviewEnvironment();
  mountedOpenQueuedAnswer(env)({ module: { id: 'assessment' }, body: { action: 'unlink_evidence' }, photoRemoval: { evidenceId: 'missing-photo' } });
  assert.equal(env.changes.page, 'categories');
  assert.match(env.changes.error, /review its latest photos/);
  assert.equal(env.changes.cursor, undefined);
});

test('rental metadata inputs remain visible above the device keyboard', () => {
  assert.match(source, /<KeyboardAwareScrollView ref=\{scroll\}/);
  assert.match(source, /keyboardDismissMode="on-drag"/);
  assert.doesNotMatch(source, /scrollResponderScrollNativeHandleToKeyboard/);
});

test('camera is available before an answer exists and metadata mutations use the server revision contract', () => {
  const capture = source.slice(source.indexOf('async function capture('), source.indexOf('async function updatePhoto'));
  assert.ok(capture.indexOf('observeLocation(true)') < capture.indexOf('await ImagePicker.launchCameraAsync'), 'GPS starts while the camera is open');
  assert.doesNotMatch(capture, /await locationCapture|await observeLocation/);
  assert.doesNotMatch(capture, /if \(!item\.id\)|if \(!draft\.item\.id\)/);
  assert.match(source, /Remove pending photo/);
  assert.match(source, /action: 'save_module_answers', moduleId: active\.id, expectedRevision: active\.revision/);
  assert.match(source, /rentalObservationsComplete\(data, active\.id\) && !activeHasDraft/);
  assert.match(source, /onPress=\{\(\) => void finishAssessment\(\)\}/);
  assert.match(source, /else advanceQuestion\(\)/);
});

function mountedSaveAnswer(environment) {
  const implementation = source.slice(source.indexOf('  async function saveAnswer('), source.indexOf('  async function next()'));
  const compiled = ts.transpileModule(`export ${implementation.trim()}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', `with (environment) { const exports = {}; ${compiled}; return exports.saveAnswer; }`)(environment);
}

test('actual rendered answer branches expose professional PDF actions for property and appliance records', () => {
  const ast = ts.createSourceFile('rental-inspection-workflow.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let answer;
  function visit(node) {
    if (ts.isConditionalExpression(node) && node.condition.getText(ast) === "page === 'answer'" && ts.isJsxFragment(node.whenTrue)) answer = node.whenTrue;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(answer, 'Render the real answer-page JSX conditionals');
  const branches = answer.children.filter((node) => /Save answer and attach professional PDF|Retry retained PDF/.test(node.getText(ast)));
  assert.ok(branches.length);
  const output = ts.transpileModule(`export function render() { return <>${branches.map((node) => node.getText(ast)).join('')}</>; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (_type, props) => props.children;
  for (const repeatBy of ['property', 'appliance']) {
    const environment = { check: { repeatBy, requiredPdfCount: 1 }, active: { key: 'electrical_safety_check', template: { safetyVisitVersion: 1 } },
      editable: true, busy: '', online: true, item: { id: 'record-item' }, documents: [{ id: 'retained-pdf', itemId: 'record-item', name: 'report.pdf' }],
      styles: {}, cursor: { checkIndex: 0 }, section: {}, repeatInstances: () => [], draft: { locationLabel: 'Appliance 1' },
      FieldButton: 'button', View: 'view', Text: 'text', RentalTextField: 'input', FieldSelect: 'select' };
    const render = new Function('environment', 'require', `with(environment) { const exports = {}; ${output}; return exports.render; }`)(environment,
      (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'fragment' }; });
    const rendered = render().flat(Infinity).filter((value) => typeof value === 'string').join(' ');
    assert.match(rendered, /Save answer and attach professional PDF/, repeatBy);
    assert.match(rendered, /Retry retained PDF/, repeatBy);
    assert.match(rendered, /Remove retained PDF/, repeatBy);
  }
});

function saveEnvironment() {
  const captured = new Date().toISOString();
  const draft = { outcome: 'meets', locationLabel: '', publicNotes: '', internalNotes: '', response: {},
    photos: [1, 2].map((id) => ({ uri: `photo-${id}`, capture: { captureObservedAtUtc: captured },
      location: { location: { state: 'captured', accuracyMetres: 12, mocked: false, observedAtUtc: captured } } })) };
  return {
    active: { id: 'module', revision: 1, template: { templateVersion: 3 } }, item: { revision: 0, instanceKey: 'property', sortOrder: 0 }, storedItem: undefined,
    section: { key: 'bathroom' }, check: { key: 'bathroom', repeatBy: 'property', requiredEvidenceCount: 1, prompt: 'Bathroom condition' },
    draft, saves: [], data: { findings: [] }, evidence: [], simpleReview: false, RENTAL_ADVERSE_OUTCOMES: new Set(), rentalAssessorFields, rentalObservationNumberIsValid, rentalObservationFieldIsVisible, findingDescription,
    rentalAssessorEvidenceRequirement, rentalObservationBlockers,
    workOrderId: 'job', key: 'draft', cacheRef: { current: { drafts: { draft }, answers: {} } },
    setSaves() {}, setCache() {}, persist: async () => {}, advanced: false,
    onChanged() { throw new Error('Parent network refresh must not block Next'); },
    request() { throw new Error('Network request must not run inside Next'); },
  };
}

test('the actual Next save waits for local durability, then advances with 50 photos still queued', async () => {
  const env = saveEnvironment();
  env.draft.photos = Array.from({ length: 50 }, (_, index) => ({ ...env.draft.photos[0], uri: `photo-${index}` }));
  let releaseStorage;
  let queued;
  const storage = new Promise((resolve) => { releaseStorage = resolve; });
  env.enqueueRentalSave = async (input) => { queued = input; await storage; return { id: 'saved-on-phone' }; };
  env.advanceQuestion = () => { env.advanced = true; };
  const saving = mountedSaveAnswer(env)();
  await Promise.resolve();
  assert.equal(env.advanced, false, 'Never advance before the queue is durable');
  releaseStorage();
  await saving;
  assert.equal(env.advanced, true);
  assert.equal(queued.photos.length, 50);
  assert.equal(queued.draftKey, 'draft');
  assert.equal(env.cacheRef.current.drafts.draft, undefined);
});

test('local storage failure retains the answer and both photos on the current screen', async () => {
  const env = saveEnvironment();
  env.enqueueRentalSave = async () => { throw new Error('Storage full'); };
  env.advanceQuestion = () => { env.advanced = true; };
  await assert.rejects(mountedSaveAnswer(env), /Storage full/);
  assert.equal(env.advanced, false);
  assert.equal(env.cacheRef.current.drafts.draft.photos.length, 2);
});

test('Next saves and advances while the retained photo has no GPS fix yet', async () => {
  const env = saveEnvironment();
  env.draft.photos = [{ ...env.draft.photos[0], location: null, locationPending: true }];
  env.enqueueRentalSave = async (input) => { env.queued = input; return { id: 'saved' }; };
  env.advanceQuestion = () => { env.advanced = true; };
  await mountedSaveAnswer(env)();
  assert.equal(env.advanced, true);
  assert.equal(env.queued.photos[0].locationPending, true);
  assert.equal(env.queued.photos[0].location, null, 'A location is never invented to let Next continue');
});

test('assessor screens use observable fields without requiring a trade specification', () => {
  assert.match(source, /rentalAssessorFields\(check, \{ templateVersion:/);
  assert.match(source, /rentalFindingDescriptionLabel\(draft\.outcome\)/);
  assert.doesNotMatch(source, /label="Recommended next step"|label="Quantity for the work"|RENTAL_QUOTATION_FIELDS\.map/);
  assert.doesNotMatch(source, /!draft\.scopeSummary\.trim\(\)/);
});

test('editing one property answer retains only dirty fields, without hidden profile blockers', () => {
  const implementation = source.slice(source.indexOf('  function changeAnswer('), source.indexOf('  async function capture('));
  const compiled = ts.transpileModule(`export ${implementation.trim()}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const environment = { timing: { activity() {} }, active: { id: 'module' }, answers: { assessorName: 'From Team', address: 'Saved address' },
    cacheRef: { current: { drafts: {}, answers: { module: { areasNotAccessed: 'Garage' } } } }, setCache() {} };
  new Function('environment', `with (environment) { const exports = {}; ${compiled}; exports.changeAnswer('inspectionDate', '2026-09-09'); }`)(environment);
  assert.deepEqual(environment.cacheRef.current.answers.module, { areasNotAccessed: 'Garage', inspectionDate: '2026-09-09' });
});

function mountedNext(environment) {
  const implementation = source.slice(source.indexOf('  async function next()'), source.indexOf('  async function saveMetadata()'));
  const compiled = ts.transpileModule('export ' + implementation.trim(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', 'with (environment) { const exports = {}; ' + compiled + '; return exports.next; }')(environment);
}
function nextEnvironment() {
  const env = { draft: { outcome: 'meets', response: { applianceType: 'Split system' }, findingDescription: '', severity: 'required' },
    check: { responseType: 'outcome' }, simpleReview: false, editable: true, page: 'answer', responseFields: [{ key: 'applianceType' }],
    RENTAL_ADVERSE_OUTCOMES: new Set(['does_not_meet', 'specialist_verification_required']), calls: [],
    detailIndex: 0, detailField: undefined, findingDescription };
  env.setPage = (page) => { env.page = page; env.calls.push(page); };
  env.setDetailIndex = (index) => { env.detailIndex = index; };
  env.setError = (error) => env.calls.push(error);
  env.perform = async (_name, action) => action();
  env.saveAnswer = async () => { env.calls.push('saved'); };
  env.advanceQuestion = () => { env.calls.push('advanced'); };
  return env;
}

test('Next saves each ordinary heater check directly without showing the same equipment page again', async () => {
  for (const key of ['main_living_heater', 'heater_operation', 'heater_efficiency', 'heating_2027_readiness']) {
    const env = nextEnvironment(); env.check.key = key;
    await mountedNext(env)();
    assert.deepEqual(env.calls, ['saved'], key);
  }
});

test('an explicitly tapped observation saves inline and immediate danger still requires its safety page', async () => {
  const env = nextEnvironment(); env.draft.outcome = 'specialist_verification_required';
  env.draft.findingDescription = 'Visible condition recorded; specialist verification needed';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['saved']);
  env.calls.length = 0; env.draft.severity = 'immediate_safety_risk';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['safety']);
});

test('a missing observation and a missing licensed test result cannot be silently skipped', async () => {
  const env = nextEnvironment(); env.draft.outcome = 'does_not_meet';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['Choose what you noticed above. Additional details are optional.']);
  env.calls.length = 0; env.draft.outcome = 'meets'; env.check.responseType = 'test_result';
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['details']);
  env.calls.length = 0; env.detailField = { key: 'testResult', required: true };
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['Record this result before continuing.']);
});

test('choosing an observation advances with blank optional details, while legacy notes remain valid', async () => {
  for (const patch of [{ findingObservation: 'Gaps visible', findingDescription: '' }, { findingDescription: 'Existing recorded window condition' }]) {
    const env = nextEnvironment(); env.draft.outcome = 'does_not_meet'; Object.assign(env.draft, patch);
    await mountedNext(env)(); assert.deepEqual(env.calls, ['saved']);
  }
  assert.equal(findingDescription({ findingObservation: 'Gaps visible', findingDescription: ' ' }), 'Gaps visible');
  assert.equal(findingDescription({ findingObservation: 'Gaps visible', findingDescription: 'Kitchen window' }), 'Gaps visible: Kitchen window');
});

test('a selected window observation queues a factual finding without a typed optional note', async () => {
  const env = saveEnvironment();
  Object.assign(env.draft, { outcome: 'does_not_meet', locationLabel: 'Property', publicNotes: '', internalNotes: '', findingTitle: '',
    findingObservation: 'Gaps visible', findingDescription: '', scopeSummary: '', quotation: {}, severity: 'required', immediateAction: '', notified: false,
    response: { sealLengthMetres: '8', limitationStatus: 'No limitation' } });
  env.active.key = 'minimum_standards'; env.check.key = 'windows_2027_readiness'; env.RENTAL_ADVERSE_OUTCOMES.add('does_not_meet');
  env.readable = value => value.replaceAll('_', ' ');
  let saved; env.enqueueRentalSave = async input => { saved = input; return { id: 'saved' }; }; env.advanceQuestion = () => {};
  await mountedSaveAnswer(env)();
  assert.equal(saved.body.finding.description, 'Gaps visible');
  assert.equal(saved.draftSnapshot.findingDescription, '');
  assert.equal(saved.draftSnapshot.findingObservation, 'Gaps visible');
});

test('quick observation and optional details are separate actual controls', () => {
  const select = (node, ast) => ts.isConditionalExpression(node) && node.condition.getText(ast) === "check.responseType === 'outcome' && !simpleReview && RENTAL_ADVERSE_OUTCOMES.has(draft.outcome)";
  const env = { check: { responseType: 'outcome' }, simpleReview: false, RENTAL_ADVERSE_OUTCOMES: new Set(['does_not_meet']),
    draft: { outcome: 'does_not_meet', findingObservation: 'Gaps visible', findingDescription: '' }, editable: true, busy: '', styles: {},
    findingChoices, rentalFindingDescriptionLabel: () => 'What did you notice?', View: 'view', Text: 'text', Pressable: 'button', FieldButton: 'button', RentalTextField: 'input',
    change(patch) { Object.assign(env.draft, patch); } };
  const render = () => renderedNativeBranch(select, env);
  const input = () => renderedNodes(render(), node => node.type === 'input')[0];
  assert.equal(input().props.label, 'Additional details (optional)'); assert.equal(input().props.value, '');
  input().props.onChange('Bedroom');
  assert.equal(env.draft.findingObservation, 'Gaps visible');
  renderedNodes(render(), node => node.type === 'button' && renderedText(node) === 'Missing')[0].props.onPress();
  assert.equal(env.draft.findingObservation, 'Missing'); assert.equal(env.draft.findingDescription, 'Bedroom');
});

test('a locked queued answer has an actionable edit button beside the question', () => {
  const select = (node, ast) => ts.isConditionalExpression(node) && node.condition.getText(ast) === 'queuedAnswer' && ts.isJsxElement(node.whenTrue);
  const env = { queuedAnswer: { status: 'conflict' }, canReviewQueuedAnswer: true, busy: '', styles: {}, View: 'view', Text: 'text', FieldButton: 'button',
    reviewQueuedAnswer() { env.edited = true; } };
  const render = () => renderedNativeBranch(select, env);
  const button = () => renderedNodes(render(), node => node.type === 'button')[0];
  assert.equal(renderedText(button()), 'Edit saved answer'); button().props.onPress(); assert.equal(env.edited, true);
  env.queuedAnswer.status = 'queued'; assert.equal(button().props.disabled, false);
  env.busy = 'restore'; assert.equal(button().props.disabled, true);
  env.canReviewQueuedAnswer = false; assert.equal(button(), undefined);
});

test('queued read-only answers advance and compact controls use numeric keyboards rather than giant textareas', async () => {
  const env = nextEnvironment(); env.editable = false;
  await mountedNext(env)();
  assert.deepEqual(env.calls, ['advanced']);
  const control = source.slice(source.indexOf('function RentalObservationInput'), source.indexOf('function findingChoices'));
  assert.match(control, /<FieldSelect/);
  assert.match(control, /multiline=\{field.input === 'textarea'\}/);
  const compiled = ts.transpileModule('export ' + control, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const element = (type, props) => ({ type, props });
  const environment = { require: () => ({ jsx: element, jsxs: element }),
    View: 'View', Text: 'Text', TextInput: 'TextInput', FieldSelect: 'FieldSelect', styles: {}, Platform: { OS: 'android' } };
  const render = new Function('environment', 'with(environment) { const exports = {}; ' + compiled + '; return exports.RentalObservationInput; }')(environment);
  for (const [os, key, keyboardType, inputMode] of [['android', 'joistClearWidthMm', 'number-pad', 'numeric'], ['android', 'areaSquareMetres', 'decimal-pad', 'decimal'], ['ios', 'joistClearWidthMm', 'number-pad', 'numeric'], ['ios', 'areaSquareMetres', 'numbers-and-punctuation', undefined]]) {
    environment.Platform.OS = os;
    const field = rentalAssessorFields({ key: 'ceiling_2027_readiness' }).find((entry) => entry.key === key);
    let changed;
    const rendered = render({ field, value: '', editable: true, onChange(value) { changed = value; } });
    const input = rendered.props.children.find((entry) => entry.type === 'TextInput');
    assert.equal(input.props.keyboardType, keyboardType);
    assert.equal(input.props.inputMode, inputMode);
    assert.equal(input.props.multiline, false);
    input.props.onChangeText('15,2'); assert.equal(changed, key === 'areaSquareMetres' ? '15.2' : '15,2');
    if (key === 'areaSquareMetres') {
      for (const [value, expected] of [['15,', '15.'], [',5', '.5'], ['15.2', '15.2'], ['1,2,3', '1,2,3'], ['1.2,3', '1.2,3'], ['-1,2', '-1,2']]) {
        input.props.onChangeText(value); assert.equal(changed, expected);
      }
    }
  }
  let narrative;
  const textField = render({ field: { input: 'textarea', label: 'Notes' }, value: '', editable: true, onChange(value) { narrative = value; } });
  const note = textField.props.children.find(entry => entry.type === 'TextInput'); note.props.onChangeText('Gate, roof and unit');
  assert.equal(narrative, 'Gate, roof and unit'); assert.equal(note.props.keyboardType, 'default'); assert.equal(note.props.inputMode, 'text');
  for (const [key, value] of [['areaSquareMetres', '1,2,3'], ['areaSquareMetres', '1.2,3'], ['joistClearWidthMm', '450,5'], ['nonIc4DownlightCount', '2,5']]) {
    assert.equal(rentalObservationNumberIsValid(value, key), false, key + ': ' + value);
  }
});

function nativeObservationFields(checkKey, response, sharedObservation = { recordedKeys: [] }, templateVersion = 4) {
  const declaration = source.slice(source.indexOf('  const responseFields ='), source.indexOf('  const detailField ='));
  const compiled = ts.transpileModule(declaration + '\nreturn responseFields;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const environment = { draft: { outcome: 'meets', response }, active: { key: 'minimum_standards', template: { templateVersion } },
    check: { key: checkKey }, showerCheck: false, rentalAssessorFields, rentalObservationFieldIsVisible, sharedObservation, editEquipmentKey: '', key: 'draft' };
  return new Function('environment', 'with(environment){' + compiled + '}')(environment);
}

function renderNativeObservation(field, value = '', onChange = () => {}) {
  const control = source.slice(source.indexOf('function RentalObservationInput'), source.indexOf('function findingChoices'));
  const compiled = ts.transpileModule('export ' + control, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const element = (type, props) => ({ type, props });
  const environment = { require: () => ({ jsx: element, jsxs: element }),
    View: 'view', Text: 'text', TextInput: 'input', FieldSelect: 'select', styles: {}, Platform: { OS: 'ios' } };
  const render = new Function('environment', 'with(environment){const exports = {};' + compiled + ';return exports.RentalObservationInput;}')(environment);
  return render({ field, value, editable: true, onChange });
}

test('native asks both proposed RCAC distances once for gas replacement and a property without a heater', () => {
  const labels = ['Estimated cable run from the switchboard to the proposed outdoor RCAC unit',
    'Estimated distance from the proposed outdoor RCAC unit to the indoor unit'];
  for (const applianceType of ['Gas heater', 'No heater']) {
    for (const templateVersion of [2, 4]) {
      const response = { applianceType, cableMeasurementStatus: 'Estimated' };
      const screens = ['main_living_heater', 'heater_operation', 'heater_efficiency', 'heating_2027_readiness'].map(checkKey => ({
        checkKey, controls: nativeObservationFields(checkKey, response, undefined, templateVersion).map(field => renderNativeObservation(field)),
      }));
      for (const label of labels) {
        const matching = screens.flatMap(screen => screen.controls.flatMap(tree => renderedNodes(tree,
          node => node.type === 'input' && node.props.accessibilityLabel === label).map(input => ({ checkKey: screen.checkKey, input, tree }))));
        assert.equal(matching.length, 1, `${applianceType}, v${templateVersion}: ${label}`);
        assert.equal(matching[0].checkKey, 'heating_2027_readiness');
        assert.match(renderedText(matching[0].tree), /\(m\)/);
        assert.equal(matching[0].input.props.keyboardType, 'numbers-and-punctuation');
        assert.equal(matching[0].input.props.multiline, false);
      }
    }
  }
});

test('native keeps legacy combined runs without hiding or inventing either proposed RCAC distance', () => {
  for (const total of [0, '0', '22']) {
    const original = { applianceType: 'Gas heater', cableMeasurementStatus: 'Estimated', airconTotalCableMetres: total,
      cableRouteBasis: 'Earlier combined route' };
    const shared = rentalSharedObservationResponse({ target: { moduleId: 'module', checkKey: 'heating_2027_readiness', instanceKey: 'property' },
      candidates: [{ moduleId: 'module', checkKey: 'main_living_heater', instanceKey: 'property', outcome: 'meets', response: original }] });
    const fields = nativeObservationFields('heating_2027_readiness', shared.response, shared);
    for (const key of ['airconSwitchboardToOutdoorMetres', 'airconOutdoorToIndoorMetres']) {
      const field = fields.find(entry => entry.key === key); assert.ok(field, key);
      assert.equal(Object.hasOwn(shared.response, key), false, 'Never assign a combined total to a segment');
      assert.equal(renderedNodes(renderNativeObservation(field, shared.response[key]), node => node.type === 'input')[0].props.value, '');
    }
    assert.equal(fields.some(field => field.key === 'airconTotalCableMetres'), false);
    assert.equal(shared.response.airconTotalCableMetres, total);
    assert.equal(nativeObservationFields('main_living_heater', original).some(field => field.key.startsWith('aircon') || field.key.startsWith('cable')), false);
    assert.equal(original.airconTotalCableMetres, total);
  }
});

test('native reopens the saved indoor RCAC distance and durably preserves both segments and the earlier total', async () => {
  const response = { applianceType: 'Gas heater', cableMeasurementStatus: 'Estimated', airconTotalCableMetres: '22',
    airconSwitchboardToOutdoorMetres: '14.5', airconOutdoorToIndoorMetres: '7.5', cableRouteBasis: 'Outside wall then ceiling to indoor unit' };
  const env = saveEnvironment(); env.active.key = 'minimum_standards'; env.active.template.templateVersion = 4;
  env.check.key = 'heating_2027_readiness'; env.draft.response = { ...response };
  const field = nativeObservationFields(env.check.key, env.draft.response).find(entry => entry.key === 'airconOutdoorToIndoorMetres');
  const control = renderNativeObservation(field, env.draft.response[field.key], value => { env.draft.response[field.key] = value; });
  const input = renderedNodes(control, node => node.type === 'input')[0];
  assert.equal(input.props.value, '7.5'); input.props.onChangeText('8,25');
  env.enqueueRentalSave = async queued => { env.queued = queued; return { id: 'saved' }; }; env.advanceQuestion = () => { env.advanced = true; };
  await mountedSaveAnswer(env)();
  assert.equal(env.advanced, true);
  assert.deepEqual(env.queued.body.response, { ...response, airconOutdoorToIndoorMetres: '8.25' });
  assert.equal(env.queued.draftSnapshot.response.airconOutdoorToIndoorMetres, '8.25');
  assert.equal(response.airconOutdoorToIndoorMetres, '7.5', 'Editing must not mutate the saved fixture');
});

test('native v4 accepts earlier RCAC capture without retroactive segments and validates newly recorded distances', async () => {
  for (const checkKey of ['main_living_heater', 'heating_2027_readiness']) {
    const env = saveEnvironment(); env.active.key = 'minimum_standards'; env.active.template.templateVersion = 4; env.check.key = checkKey;
    env.draft.response = checkKey === 'main_living_heater' ? { applianceType: 'Gas heater' }
      : { applianceType: 'Gas heater', cableMeasurementStatus: 'Estimated', airconTotalCableMetres: '22', cableRouteBasis: 'Earlier combined route' };
    env.enqueueRentalSave = async input => { env.queued = input; return { id: 'saved' }; }; env.advanceQuestion = () => { env.advanced = true; };
    await mountedSaveAnswer(env)(); assert.equal(env.advanced, true, checkKey);
    for (const key of ['airconSwitchboardToOutdoorMetres', 'airconOutdoorToIndoorMetres']) assert.equal(Object.hasOwn(env.queued.body.response, key), false);
  }
  for (const key of ['airconSwitchboardToOutdoorMetres', 'airconOutdoorToIndoorMetres']) {
    const env = saveEnvironment(); env.active.key = 'minimum_standards'; env.active.template.templateVersion = 4; env.check.key = 'heating_2027_readiness';
    env.draft.response = { cableMeasurementStatus: 'Estimated', airconTotalCableMetres: '22', cableRouteBasis: 'Earlier combined route', [key]: '4..2' };
    env.enqueueRentalSave = () => { assert.fail('An invalid new segment must not enter the queue'); };
    await assert.rejects(mountedSaveAnswer(env), /Enter a zero or positive number for estimated (?:cable run|distance)/);
    assert.equal(env.advanced, false); assert.equal(env.cacheRef.current.drafts.draft.response[key], '4..2');
  }
});

test('invalid measurements stay editable on the phone instead of creating a queue conflict', async () => {
  const env = saveEnvironment(); env.check.key = 'heating_2027_readiness'; env.draft.response.roomLengthMetres = '4..2';
  env.enqueueRentalSave = () => { throw new Error('Invalid observation must not enter queue'); };
  await assert.rejects(mountedSaveAnswer(env), /Enter a zero or positive number for room length/);
  assert.equal(env.cacheRef.current.drafts.draft.response.roomLengthMetres, '4..2');
});

test('current phone statuses hide retained conditional answers after correcting a mistaken selection', () => {
  const declaration = source.slice(source.indexOf('  const responseFields ='), source.indexOf('  const detailField ='));
  const compiled = ts.transpileModule(declaration + '\nreturn responseFields;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const env = { draft: { outcome: 'meets', response: { limitationStatus: 'Other', limitationReason: 'Locked hatch',
    cableMeasurementStatus: 'Measured', hotWaterCableRunMetres: '20', cableRouteBasis: 'Observed wall route' } },
    active: { key: 'minimum_standards', template: { templateVersion: 4 } }, check: { key: 'hot_water_2027_readiness' },
    showerCheck: false, rentalAssessorFields, rentalObservationFieldIsVisible, sharedObservation: { recordedKeys: [] }, editEquipmentKey: '', key: 'draft' };
  const evaluate = () => new Function('environment', 'with(environment){' + compiled + '}')(env).map(field => field.key);
  assert.ok(evaluate().includes('limitationReason')); assert.ok(evaluate().includes('hotWaterCableRunMetres'));
  env.draft.response.limitationStatus = 'No limitation'; env.draft.response.cableMeasurementStatus = 'Unable to determine';
  assert.ok(!evaluate().includes('limitationReason')); assert.ok(!evaluate().includes('hotWaterCableRunMetres'));
  assert.ok(!evaluate().includes('cableRouteBasis')); assert.ok(evaluate().includes('cableLimitationReason'));
  assert.equal(env.draft.response.hotWaterCableRunMetres, '20'); assert.equal(env.draft.response.limitationReason, 'Locked hatch');
  env.draft.response.hotWaterSupplyType = 'Shared building system';
  const shared = evaluate(); assert.ok(shared.includes('sharedHotWaterServiceStatus'));
  for (const field of ['model', 'applianceType', 'hotWaterCableRunMetres', 'cableMeasurementStatus', 'cableLimitationReason']) assert.ok(!shared.includes(field), field);
});

test('v4 Next rejects a missing current quoting answer even when the observation meets', async () => {
  const env = saveEnvironment(); env.check.key = 'artificial_lighting'; env.active.template.templateVersion = 4;
  env.enqueueRentalSave = () => { throw new Error('Missing capture must not enter queue'); };
  await assert.rejects(mountedSaveAnswer(env), /non-IC4 downlight count/);
  assert.equal(env.advanced, false); assert.equal(env.cacheRef.current.drafts.draft, env.draft);
  env.draft.response = { downlightCountStatus: 'Unknown', downlightCountLimitation: 'Labels not safely accessible', nonIc4DownlightCount: 'previous-invalid' };
  env.enqueueRentalSave = async input => { env.queued = input; return { id: 'saved' }; }; env.advanceQuestion = () => { env.advanced = true; };
  await mountedSaveAnswer(env)(); assert.equal(env.advanced, true);
  assert.equal(env.queued.body.response.nonIc4DownlightCount, 'previous-invalid', 'Keep inactive earlier data; current report projection decides relevance');
});

test('v4 phone Next permits an honest cable limitation with inactive invalid numeric history', async () => {
  const env = saveEnvironment(); env.check.key = 'cooktop_function'; env.active.template.templateVersion = 4;
  env.draft.response = { cableMeasurementStatus: 'Unable to determine', cableLimitationReason: 'Concealed route', cooktopCableRunMetres: '3..2' };
  env.enqueueRentalSave = async input => { env.queued = input; return { id: 'saved' }; }; env.advanceQuestion = () => { env.advanced = true; };
  await mountedSaveAnswer(env)(); assert.equal(env.advanced, true); assert.equal(env.queued.body.response.cooktopCableRunMetres, '3..2');
});

test('native reviewed switchboard Next requires its photo and permits both results without extra questions', async () => {
  const currentTemplate = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const check = currentTemplate.sections.flatMap(section => section.checks).find(entry => entry.key === 'outlet_lighting_protection');
  const declaration = source.slice(source.indexOf('  const simpleReview ='), source.indexOf('  const showerCheck ='));
  const simple = new Function('check', ts.transpileModule(declaration + '\nreturn simpleReview;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(check);
  assert.equal(simple, true);
  for (const outcome of ['meets', 'does_not_meet']) {
    const env = saveEnvironment(); env.check = check; env.simpleReview = simple; env.active.key = 'minimum_standards'; env.active.template.templateVersion = 4;
    env.draft.outcome = outcome; env.draft.findingDescription = ''; env.draft.publicNotes = ''; env.draft.photos = [];
    env.RENTAL_ADVERSE_OUTCOMES = new Set(['does_not_meet']); env.draft.severity = 'required'; env.draft.immediateAction = ''; env.draft.notified = false;
    env.enqueueRentalSave = async input => { env.queued = input; return { id: 'saved-review' }; }; env.advanceQuestion = () => { env.advanced = true; };
    await assert.rejects(mountedSaveAnswer(env), /photo/); assert.equal(env.queued, undefined);
    env.draft.photos = [{ uri: 'switchboard.jpg' }]; await mountedSaveAnswer(env)();
    assert.equal(env.queued.body.outcome, outcome); assert.equal(env.queued.body.finding, undefined); assert.equal(env.advanced, true);
    const next = nextEnvironment(); next.check = check; next.simpleReview = simple; next.draft.outcome = outcome; next.draft.findingDescription = '';
    await mountedNext(next)(); assert.deepEqual(next.calls, ['saved']);
  }
});

test('phone saves the optional ceiling gap or an honest safe-access limitation in the durable answer', async () => {
  for (const response of [
    { areaSquareMetres: '24', joistClearWidthMm: '430' },
    { areaSquareMetres: '24' },
    { limitationStatus: 'Not accessible', limitationReason: 'Roof hatch is locked' },
    { limitationStatus: 'Unsafe to measure', limitationReason: 'No safe access to joists' },
  ]) {
    const env = saveEnvironment(); env.check.key = 'ceiling_2027_readiness'; env.section.key = 'ceiling_insulation';
    env.draft.response = response;
    let queued;
    env.enqueueRentalSave = async (input) => { queued = input; return { id: 'ceiling-on-phone' }; };
    env.advanceQuestion = () => { env.advanced = true; };
    await mountedSaveAnswer(env)();
    assert.equal(env.advanced, true);
    assert.deepEqual(queued.body.response, response);
    if (response.limitationStatus) assert.equal(Object.hasOwn(queued.body.response, 'joistClearWidthMm'), false);
  }
});

test('phone rejects invalid joist gaps before queuing and retains the answer for correction', async () => {
  for (const value of ['0', '-1', '430.5', '5001', 'unknown']) {
    const env = saveEnvironment(); env.check.key = 'ceiling_2027_readiness';
    env.draft.response.joistClearWidthMm = value;
    env.enqueueRentalSave = () => { throw new Error('Invalid gap must not enter queue'); };
    await assert.rejects(mountedSaveAnswer(env), /Enter a whole number between 1 and 5000 mm for clear gap between ceiling joists/);
    assert.equal(env.cacheRef.current.drafts.draft.response.joistClearWidthMm, value);
    assert.equal(env.advanced, false);
  }
});

test('clear mould and visible damage observations advance with no photos; a defect still needs context and detail', async () => {
  for (const key of ['mould_damp_observation', 'structure_weatherproofing']) {
    const env = saveEnvironment(); env.check.key = key; env.draft.photos = [];
    env.enqueueRentalSave = async () => ({ id: 'local' }); env.advanceQuestion = () => { env.advanced = true; };
    await mountedSaveAnswer(env)();
    assert.equal(env.advanced, true, key);
  }
  const env = saveEnvironment(); env.check.key = 'mould_damp_observation'; env.draft.outcome = 'does_not_meet';
  env.draft.photos = []; env.enqueueRentalSave = () => { throw new Error('Missing evidence must not enter queue'); };
  await assert.rejects(mountedSaveAnswer(env), /photo/i);
});

function mountedHandler(name, nextName, environment) {
  const start = source.search(new RegExp('  (?:async )?function ' + name + '\\('));
  const end = nextName === '$render' ? source.indexOf('  return <View style={styles.shell}>') : source.search(new RegExp('  (?:async )?function ' + nextName + '\\('));
  assert.ok(start >= 0 && end > start);
  const helpers = source.slice(source.indexOf('const emptyCache'), source.indexOf('function RentalTextField'));
  const compiled = ts.transpileModule(helpers + '\nexport ' + source.slice(start, end).trim(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('environment', 'with (environment) { const exports = {}; ' + compiled + '; return exports.' + name + '; }')(environment);
}

test('the camera releases the form after durable photo storage while GPS remains unresolved', async () => {
  let resolveGps;
  const gps = new Promise((resolve) => { resolveGps = resolve; });
  const files = new Set(['camera.jpg']);
  class Directory { constructor() { this.uri = 'file:///document/rental-original-photos'; } async create() {} }
  class File {
    constructor(...parts) { this.uri = parts.map((part) => part.uri || part).join('/'); }
    get exists() { return files.has(this.uri); }
    async copy(target) { files.add(target.uri); }
    delete() { files.delete(this.uri); }
  }
  const env = { editable: true, draft: { photos: [] }, key: 'first', workOrderId: 'job',
    busy: false, writes: [], cacheRef: { current: { drafts: {}, answers: {} } }, localOwner: { current: { key: 'owner', epoch: 1 } }, mounted: { current: true },
    perform: async (_name, action) => { env.busy = true; try { await action(); } finally { env.busy = false; } },
    observeLocation: () => gps, observedTime: () => ({ captureObservedAtUtc: new Date().toISOString() }),
    ImagePicker: { requestCameraPermissionsAsync: async () => ({ granted: true }), CameraType: { back: 'back' },
      launchCameraAsync: async () => ({ assets: [{ uri: 'camera.jpg', width: 3000, height: 2000, mimeType: 'image/jpeg' }] }) },
    Crypto: { randomUUID: () => 'photo-id' }, Directory, File, Paths: { document: 'file:///document' },
    assertLocalDataOwner() {}, setCache() {}, persist: async (cache) => { env.writes.push(JSON.parse(JSON.stringify(cache))); },
    rememberRentalPhotoLocation: async (...args) => { env.remembered = args; }, setError(message) { env.error = message; } };
  await mountedHandler('capture', 'updatePhoto', env)();
  assert.equal(env.busy, false, 'GPS must not hold the global form busy flag');
  assert.equal(env.writes.length, 1);
  const retained = env.writes[0].drafts.first.photos[0];
  assert.equal(retained.locationPending, true); assert.ok(files.has(retained.uri));
  env.cacheRef.current = { drafts: {}, answers: {} }; // Next has already queued this photo.
  resolveGps({ permission: { granted: true }, location: { state: 'captured' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.remembered[0], 'job'); assert.equal(env.remembered[1], retained.uri);
  assert.deepEqual(env.cacheRef.current.drafts, {}, 'Late GPS must not recreate a submitted draft');
});

test('insulation gallery selection retains its original and truthfully records upload-time metadata without camera access', async () => {
  let resolveGps;
  const gps = new Promise(resolve => { resolveGps = resolve; });
  const files = new Set(['gallery.heic']);
  class Directory { constructor() { this.uri = 'file:///document/rental-original-photos'; } async create() {} }
  class File {
    constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
    get exists() { return files.has(this.uri); }
    async copy(target) { files.add(target.uri); }
    delete() { files.delete(this.uri); }
  }
  const env = { editable: true, draft: { photos: [] }, key: 'insulation', workOrderId: 'job',
    active: { key: 'minimum_standards' }, check: { key: 'ceiling_2027_readiness' },
    writes: [], cacheRef: { current: { drafts: {}, answers: {} } }, localOwner: { current: { key: 'owner', epoch: 1 } }, mounted: { current: true },
    perform: async (name, action) => { assert.equal(name, 'gallery'); await action(); },
    observeLocation: () => { env.gpsStarted = true; return gps; }, observedTime: () => ({ captureObservedAtUtc: '2026-10-08T08:00:00Z' }),
    ImagePicker: { requestCameraPermissionsAsync() { assert.fail('Gallery does not need camera permission'); }, launchCameraAsync() { assert.fail('Gallery does not open the camera'); },
      launchImageLibraryAsync: async options => { assert.equal(env.gpsStarted, undefined, 'GPS describes selection time, not time spent browsing the library');
        assert.deepEqual(options, { mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: true });
        return { canceled: false, assets: [{ uri: 'gallery.heic', width: 3000, height: 2000, mimeType: 'image/heic', exif: { DateTimeOriginal: '2025:01:01 00:00:00' } }] }; } },
    Crypto: { randomUUID: () => 'gallery-photo-id' }, Directory, File, Paths: { document: 'file:///document' },
    assertLocalDataOwner() {}, setCache() {}, persist: async cache => { env.writes.push(JSON.parse(JSON.stringify(cache))); },
    rememberRentalPhotoLocation: async (...args) => { env.remembered = args; }, setError(message) { env.error = message; } };
  await mountedHandler('capture', 'updatePhoto', env)(true);
  const retained = env.writes[0].drafts.insulation.photos[0];
  assert.equal(retained.source, 'native_file_upload'); assert.equal(retained.locationPending, true);
  assert.equal(retained.capture.captureObservedAtUtc, '2026-10-08T08:00:00Z', 'EXIF date is never represented as the current observed upload time');
  assert.ok(retained.uri.endsWith('.heic')); assert.ok(files.has(retained.uri));
  env.cacheRef.current = { drafts: {}, answers: {} };
  resolveGps({ permission: { granted: true }, location: { state: 'captured' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.remembered[1], retained.uri); assert.deepEqual(env.cacheRef.current.drafts, {});
});

test('gallery cancellation and non-insulation calls never retain or queue a photo', async () => {
  const env = { editable: true, draft: { photos: [] }, active: { key: 'minimum_standards' }, check: { key: 'ceiling_2027_readiness' },
    perform: async (_name, run) => run(), ImagePicker: { launchImageLibraryAsync: async () => ({ canceled: true, assets: null }) },
    observeLocation() { assert.fail('Canceled selection does not record a location'); }, persist() { assert.fail('Canceled selection has no draft mutation'); } };
  await mountedHandler('capture', 'updatePhoto', env)(true);
  env.check.key = 'cooling_2027_readiness'; env.perform = () => assert.fail('Gallery is limited to insulation');
  await mountedHandler('capture', 'updatePhoto', env)(true);
});

test('native insulation exposes camera and gallery controls with the same edit and busy gates', () => {
  const select = (node, ast) => ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.photo}>';
  const env = { check: { key: 'ceiling_2027_readiness' }, photoRequirement: { minimumFiles: 1, minimumPhotos: 1 }, active: { key: 'minimum_standards' },
    presentation: undefined,
    styles: {}, editable: true, canRemovePhotos: true, busy: '', evidence: [], visiblePhotos: [], draft: { photos: [] }, View: 'view', Text: 'text', Image: 'image', FieldButton: 'button',
    capture(fromGallery) { env.called = fromGallery; } };
  const button = label => renderedNodes(renderedNativeBranch(select, env), node => node.type === 'button' && renderedText(node) === label)[0];
  assert.equal(button('Take photo').props.disabled, false); assert.equal(button('Upload from gallery').props.disabled, false);
  button('Upload from gallery').props.onPress(); assert.equal(env.called, true);
  for (const patch of [{ editable: false }, { busy: 'camera' }, { busy: 'gallery' }]) {
    const old = Object.fromEntries(Object.keys(patch).map(key => [key, env[key]])); Object.assign(env, patch);
    assert.equal(button('Take photo').props.disabled, true); assert.equal(button('Upload from gallery').props.disabled, true); Object.assign(env, old);
  }
  env.check.key = 'cooling_2027_readiness'; assert.equal(button('Upload from gallery'), undefined);
});

test('dwelling checks retain historical dimensions without asking for them again; fixed windows save their reason without typing', async () => {
  const declaration = source.slice(source.indexOf('  const responseFields ='), source.indexOf('  const detailField ='));
  const compiled = ts.transpileModule(declaration + '\nreturn responseFields;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluate = (environment) => new Function('environment', 'with(environment){' + compiled + '}')(environment);
  const draft = { outcome: 'meets', response: { widthMm: '2400', heightMm: '1800' } };
  const env = { draft, active: { key: 'minimum_standards', template: { templateVersion: 3 } }, check: { key: 'window_covering' }, showerCheck: false, rentalAssessorFields, rentalObservationFieldIsVisible, sharedObservation: { recordedKeys: [] }, editEquipmentKey: '', key: 'draft' };
  assert.equal(evaluate(env).some((field) => field.key === 'widthMm'), false);
  assert.equal(draft.response.widthMm, '2400');
  draft.outcome = 'does_not_meet'; assert.equal(evaluate(env).some((field) => field.key === 'widthMm'), false);
  const saving = saveEnvironment(); saving.check = { key: 'window_operation_security', repeatBy: 'window' };
  saving.draft.locationLabel = 'Rear bedroom - Window 1'; saving.draft.photos = [];
  Object.assign(saving.draft, rentalAssessorOutcomePatch(saving.check, 'not_applicable', 'Frosted glazing'));
  let queued; saving.enqueueRentalSave = async (input) => { queued = input; return { id: 'fixed' }; };
  saving.advanceQuestion = () => {}; await mountedSaveAnswer(saving)();
  assert.match(queued.body.publicNotes, /Frosted glazing/);
  assert.match(queued.body.publicNotes, /No openable windows at the property; fixed glazing only/);
});



test('dwelling navigation visits all categories without a room roster and never reuses a room answer', () => {
  const sections = [
    { key: 'lighting', checks: [{ key: 'artificial_lighting', repeatBy: 'room' }, { key: 'habitable_daylight', repeatBy: 'room' }] },
    { key: 'draughtproofing', checks: [{ key: 'doors_2027_readiness' }, { key: 'windows_2027_readiness' }, { key: 'vents_2027_readiness' }] },
  ];
  const env = { active: { id: 'module', key: 'minimum_standards' }, data: { items: [{ moduleId: 'module', sectionKey: 'lighting', checkKey: 'artificial_lighting', instanceKey: 'old-room', outcome: 'meets' }] },
    setCursor(cursor) { env.cursor = cursor; env.section = sections.find((section) => section.key === cursor.sectionKey); env.check = env.section.checks[cursor.checkIndex]; },
    setPage(page) { env.page = page; }, setError() {}, setGuidanceOpen() {}, setMetadataIndex() {}, editable: true, metadata: [],
    propertySteps: sections.flatMap((section) => section.checks.map((_check, checkIndex) => ({ section, checkIndex }))) };
  env.openCheck = mountedHandler('openCheck', 'advanceQuestion', env);
  const advance = mountedHandler('advanceQuestion', 'changeAnswer', env);
  env.openCheck(sections[0]);
  const visited = [];
  for (let index = 0; index < 5; index++) {
    visited.push(env.check.key); assert.equal(env.cursor.instanceKey, 'property'); advance();
  }
  assert.deepEqual(visited, ['artificial_lighting', 'habitable_daylight', 'doors_2027_readiness', 'windows_2027_readiness', 'vents_2027_readiness']);
  assert.equal(env.page, 'review');
  assert.equal(env.data.items[0].instanceKey, 'old-room');
  assert.equal(newRentalItem(env.active, sections[0], sections[0].checks[0]).instanceKey, 'property');
  assert.doesNotMatch(source, /Add room|Add window|Room name \(optional\)|label="Location"/);
});

test('missing checks and evidence have direct completion destinations, without authorizing a false pass', () => {
  const assessmentModule = { id: 'module', key: 'minimum_standards', template: { sections: [{ key: 'lighting', checks: [{ key: 'artificial_lighting' }] }] } };
  const item = { moduleId: 'module', instanceKey: 'property', itemKey: 'lighting:artificial_lighting:property', sectionKey: 'lighting', checkKey: 'artificial_lighting' };
  const expected = { kind: 'check', sectionKey: 'lighting', checkIndex: 0 };
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [], 'check:lighting:artificial_lighting'), expected);
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [item], 'evidence:' + item.itemKey), expected);
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [item], 'response:' + item.itemKey + ':measurement'), expected);
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [], 'metadata:coverageConfirmed'), { kind: 'metadata', fieldKey: 'coverageConfirmed' });
  assert.equal(rentalCompletionTarget(assessmentModule, [], 'check:unknown:missing'), null);
  const alarmModule = { id: 'alarm-module', key: 'smoke_alarm_check', template: { sections: [{ key: 'alarms', checks: [{ key: 'operation' }] }] } };
  const alarm = { moduleId: 'alarm-module', instanceKey: 'alarm-2', itemKey: 'alarms:operation:alarm-2', sectionKey: 'alarms', checkKey: 'operation' };
  assert.deepEqual(rentalCompletionTarget(alarmModule, [alarm], 'evidence:' + alarm.itemKey), { kind: 'check', sectionKey: 'alarms', checkIndex: 0, instanceKey: 'alarm-2' });
});

test('old metadata snapshots hide automatic date and profile details and save only the current field', async () => {
  const keys = ['inspectionDate', 'assessorName', 'qualificationType', 'qualificationNumber'];
  for (const key of keys) {
    const field = rentalAssessorMetadataField({ key, type: 'text', required: true });
    assert.ok(field.source === 'automatic' || field.source === 'team_profile', key);
  }
  const sent = [];
  const env = { active: { id: 'module', revision: 3 }, field: { key: 'tenancyStartDate', type: 'date' }, queuedMetadata: undefined,
    answers: { tenancyStartDate: '2026-09-09', assessorDeclaration: false, credentialConfirmed: false },
    metadataIndex: 0, metadata: [{ key: 'tenancyStartDate' }], workOrderId: 'job',
    cacheRef: { current: { drafts: {}, answers: { module: { tenancyStartDate: '2026-09-09' } } } },
    perform: async (_name, action) => action(), enqueueRentalSave: async (input) => { sent.push(input); return { id: 'saved' }; },
    setSaves() {}, setCache() {}, persist: async () => {}, setPage() {}, setMetadataIndex() {} };
  await mountedHandler('saveMetadata', 'reviewQueuedAnswer', env)();
  assert.deepEqual(sent[0].body.answers, { tenancyStartDate: '2026-09-09' });
  assert.equal(env.cacheRef.current.answers.module, undefined);
});

test('finish confirms once, queues delivery without waiting for evidence and stays on the result screen', async () => {
  const env = { active: { id: 'module', status: 'draft', revision: 3, answers: {} }, pendingSaves: [{ id: 'fifty-photos' }], saves: [], activeHasDraft: false,
    canEmailReport: false, issueReport: true, credentialConfirmation: undefined,
    timing: { markCompleted() { assert.ok(env.queued, 'Completion follows durable queue success'); env.timingCompleted = true; } },
    data: { items: [], completion: { module: { complete: false, blockers: [{ key: 'metadata:assessorDeclaration', label: 'Confirm assessment' }] } } },
    cache: { answers: { module: { coverageConfirmed: true, assessorDeclaration: true, credentialConfirmed: false } } }, completionBlockers: [], rentalCompletionTarget, calls: [], finishRequest: undefined, earlierDrafts: [], sections: [], workOrderId: 'job',
    setError(message) { env.message = message; }, perform: async (_name, action) => action(), persist: async () => {},
    onChanged: async () => {}, onReturnToJob() { env.left = true; }, enqueueRentalFinish: async (value) => { env.queued = value; return { id: 'finish' }; },
    setSaves() {}, setPage(value) { env.page = value; },
    Alert: { alert(_title, message, buttons) { env.message = message; env.confirm = buttons[1].onPress; } },
    openCompletionIssue(key) { env.calls.push(key); }, request() { assert.fail('UI cannot complete while photos are outstanding'); } };
  const finish = mountedHandler('finishAssessment', 'previous', env);
  await finish(); assert.match(env.message, /complete and accurate/); assert.equal(env.queued, undefined);
  await env.confirm(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.timingCompleted, true); assert.equal(env.queued.module.id, 'module'); assert.equal(env.left, undefined); assert.equal(env.page, 'review'); assert.deepEqual(env.calls, []);
});

test('an older future-shower blocker opens the single visible shower check', () => {
  const assessmentModule = { id: 'module', key: 'minimum_standards', template: { sections: [
    { key: 'bathroom', checks: [{ key: 'bathroom_facilities' }, { key: 'showerhead_rating' }] },
    { key: 'showers', checks: [{ key: 'shower_2027_readiness' }] },
  ] } };
  assert.deepEqual(rentalCompletionTarget(assessmentModule, [], 'check:showers:shower_2027_readiness'), { kind: 'check', sectionKey: 'bathroom', checkIndex: 1 });
});

test('a retained draft on the removed shower page explains recovery without leaving review', async () => {
  const env = { active: { id: 'module' }, finishRequest: undefined,
    earlierDrafts: [['module:scope:3:showers:0:property', { photos: [{ uri: 'retained.jpg' }] }]],
    setPage(value) { env.page = value; }, setError(value) { env.message = value; },
    Alert: { alert() { assert.fail('Do not authorise a report while earlier photos need recovery'); } } };
  await mountedHandler('finishAssessment', 'previous', env)();
  assert.equal(env.page, undefined); assert.match(env.message, /earlier saved answer needs review/i);
});

test('submitted drafts reconcile after GPS completes, but real later edits and new photos remain unfinished', () => {
  const helpers = source.slice(source.indexOf('const emptyCache'), source.indexOf('function RentalTextField'))
    .replace('function unfinishedDrafts(', 'export function unfinishedDrafts(');
  const compiled = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const assessDrafts = new Function('rentalQuotation', 'RENTAL_ADVERSE_OUTCOMES', 'rentalSharedObservationResponse', 'findingChoices', 'findingDescription', 'const exports = {}; ' + compiled + '; return exports.unfinishedDrafts;')(
    () => ({}), new Set(['does_not_meet']), rentalSharedObservationResponse, findingChoices, findingDescription);
  const assessmentModule = { id: 'module', key: 'minimum_standards', template: { assessmentScope: 'current_minimum_standards', templateVersion: 3,
    sections: [{ key: 'bathroom', title: 'Bathroom', checks: [{ key: 'working' }] }] } };
  const key = 'module:current_minimum_standards:3:bathroom:0:property';
  const draft = { outcome: 'meets', locationLabel: 'Property', publicNotes: '', internalNotes: '', response: {},
    findingTitle: '', findingDescription: '', scopeSummary: '', quantity: '', unitLabel: 'each', quotation: {}, severity: 'required', immediateAction: '', notified: false,
    photos: [{ uri: 'photo.jpg', width: 1200, height: 1600, capture: { captureObservedAtUtc: '2026-09-10T00:00:00Z' }, location: null, locationPending: true }] };
  const retained = structuredClone(draft);
  retained.photos[0].location = { location: { state: 'captured' } }; retained.photos[0].locationPending = false;
  const cache = { drafts: { [key]: retained }, answers: {} };
  const save = { draftKey: key, draftSnapshot: { ...draft, response: { sharedEquipmentType: 'Existing' } }, sourceDraftSnapshot: draft, status: 'succeeded' };
  assert.deepEqual(assessDrafts(assessmentModule, {}, cache, [save]), [], 'Queued source snapshot owns this retained draft, even after shared response/GPS enrichment');
  retained.publicNotes = 'An actual later edit';
  assert.equal(assessDrafts(assessmentModule, {}, cache, [save]).length, 1);
  retained.publicNotes = ''; retained.photos.push({ ...retained.photos[0], uri: 'new-photo.jpg' });
  assert.equal(assessDrafts(assessmentModule, {}, cache, [save]).length, 1);
  retained.photos = [];
  const item = { id: 'saved', moduleId: 'module', sectionKey: 'bathroom', checkKey: 'working', instanceKey: 'property',
    outcome: 'meets', locationLabel: 'Property', publicNotes: '', internalNotes: '', response: {} };
  assert.deepEqual(assessDrafts(assessmentModule, { items: [item] }, cache, []), [], 'An unchanged saved answer is not an unfinished draft');
  retained.outcome = 'does_not_meet';
  assert.equal(assessDrafts(assessmentModule, { items: [item] }, cache, []).length, 1);
  item.outcome = 'does_not_meet'; retained.findingObservation = 'Missing';
  const findingResult = { items: [item], findings: [{ itemId: item.id, description: 'Missing', severity: 'required', quantityMilli: 0, unitLabel: 'each', details: {} }] };
  assert.equal(assessDrafts(assessmentModule, findingResult, cache, []).length, 0, 'An unchanged selected observation matches its saved description');
  retained.findingObservation = 'Gaps visible';
  assert.equal(assessDrafts(assessmentModule, findingResult, cache, []).length, 1, 'Changing only the selection must be saved before Finish');
  retained.findingObservation = 'Missing'; retained.findingDescription = 'Bedroom';
  assert.equal(assessDrafts(assessmentModule, findingResult, cache, []).length, 1, 'Additional details also remain an unsaved edit');
  const legacyLocal = structuredClone(draft);
  legacyLocal.photos[0].locationPending = false;
  const heaterKey = 'module:current_minimum_standards:3:heating:0:property';
  const candidate = { moduleId: 'module', checkKey: 'main_living_heater', instanceKey: 'property', locationLabel: 'Property', outcome: 'meets', response: { applianceType: 'Ducted' } };
  const legacySave = { module: assessmentModule, draftKey: heaterKey, status: 'succeeded', body: { action: 'save_item', checkKey: 'heater_operation', instanceKey: 'property' },
    draftSnapshot: { ...draft, response: { applianceType: 'Ducted' } } };
  const legacyCache = { drafts: { [heaterKey]: legacyLocal }, answers: {} };
  assert.deepEqual(assessDrafts(assessmentModule, { items: [candidate] }, legacyCache, [legacySave]), [], '568 queue snapshots recover only when saved equipment observations reproduce their inherited fields');
  legacyLocal.response.applianceType = 'Split system';
  assert.equal(assessDrafts(assessmentModule, { items: [candidate] }, legacyCache, [legacySave]).length, 1, 'Different equipment entered later remains unsaved');
  delete legacyLocal.response.applianceType;
  assert.equal(assessDrafts(assessmentModule, { items: [] }, legacyCache, [legacySave]).length, 1, 'No inherited value is guessed without its recorded source');
});

test('last offline module offers report delivery when earlier module finishes are authorised, while conflicts and later drafts still block it', () => {
  const helpers = source.slice(source.indexOf('const emptyCache'), source.indexOf('function RentalTextField'));
  const declaration = source.slice(source.indexOf('  const remainingModules ='), source.indexOf('  const canEmailReport ='));
  const compiled = ts.transpileModule(helpers + declaration + '\nreturn {remainingModules, issueReport};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluate = new Function('data', 'active', 'cache', 'saves', 'rentalQuotation', 'RENTAL_ADVERSE_OUTCOMES', 'rentalSharedObservationResponse', compiled);
  const modules = ['minimum_standards', 'electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check'].map((key, index) => ({ id: `module-${index}`, key, status: 'draft', answers: {}, template: { assessmentScope: 'test', templateVersion: 3, sections: [] } }));
  const saves = modules.slice(0, 3).map((module) => ({ module, status: 'queued', finish: { issueReport: false }, body: {} }));
  const cache = { drafts: {}, answers: {} };
  const run = () => evaluate({ modules }, modules[3], cache, saves, () => ({}), new Set(), rentalSharedObservationResponse);
  assert.equal(run().issueReport, true);
  saves[0].status = 'conflict'; assert.equal(run().issueReport, false);
  saves[0].status = 'queued';
  cache.drafts['module-0:test:3:heating:0:property'] = { photos: [], response: {}, outcome: 'meets', findingDescription: '' };
  assert.equal(run().issueReport, false);
  cache.drafts = {}; cache.answers['module-0'] = { occupancy: 'vacant' };
  assert.equal(run().issueReport, false);
  cache.answers['module-0'] = { coverageConfirmed: true, assessorDeclaration: true };
  assert.equal(run().issueReport, true, 'Legacy final values do not strand an already explicit Finish request');
});

test('unfinished metadata ignores saved values and legacy signoff caches, but retains edits and conflicts', () => {
  const helpers = source.slice(source.indexOf('const emptyCache'), source.indexOf('function RentalTextField'));
  const compiled = ts.transpileModule(helpers + '\nreturn unfinishedMetadata;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const inspect = new Function(compiled)();
  const assessmentModule = { id: 'module', answers: { occupancyAtAssessment: 'vacant' } };
  const cache = { answers: { module: { occupancyAtAssessment: 'vacant', coverageConfirmed: true, assessorDeclaration: true, credentialConfirmed: true } } };
  assert.deepEqual(inspect(assessmentModule, cache, []), []);
  cache.answers.module.occupancyAtAssessment = 'occupied';
  assert.deepEqual(inspect(assessmentModule, cache, []).map(([key]) => key), ['occupancyAtAssessment']);
  const save = { module: assessmentModule, status: 'queued', body: { action: 'save_module_answers', answers: { occupancyAtAssessment: 'occupied' } } };
  assert.deepEqual(inspect(assessmentModule, cache, [save]), []);
  save.status = 'conflict'; assert.equal(inspect(assessmentModule, cache, [save]).length, 1);
  assert.equal(assessmentModule.answers.assessorDeclaration, undefined, 'Discarding an obsolete local signoff never certifies the server answer');
});

function renderedNativeBranch(select, environment) {
  const ast = ts.createSourceFile('rental-inspection-workflow.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let branch;
  function visit(node) { if (select(node, ast)) branch = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(branch, 'Evaluate the actual native JSX branch');
  const output = ts.transpileModule(`export function render() { return ${branch.getText(ast)}; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props) => ({ type, props });
  const render = new Function('environment', 'require', `with(environment) { const exports = {}; ${output}; return exports.render; }`)(environment,
    name => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'fragment' }; });
  return render();
}
const renderedNodes = (node, predicate) => node == null || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(child => renderedNodes(child, predicate)) : [...(predicate(node) ? [node] : []), ...renderedNodes(node.props?.children, predicate)];
const renderedText = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(renderedText).join(' ') : renderedText(node.props?.children);

test('native update is explicit, revision checked and unavailable with metadata, photo, queue or offline work', async () => {
  const select = (node, ast) => ts.isConditionalExpression(node) && node.condition.getText(ast).includes('RENTAL_ASSESSMENT_TEMPLATE_VERSION');
  const env = { editable: true, active: { id: 'module', key: 'minimum_standards', revision: 8,
    template: { assessmentScope: 'current_minimum_standards', templateVersion: 3 } },
    data: { inspection: { revision: 11 } }, RENTAL_ASSESSMENT_TEMPLATE_VERSION, busy: '', hasDraft: false,
    earlierDrafts: [], pendingSaves: [], online: true, styles: {}, FieldButton: 'button', Text: 'text',
    perform: async (_kind, run) => run(), request: async body => { env.sent = body; } };
  const button = () => renderedNodes(renderedNativeBranch(select, env), node => node.type === 'button')[0];
  assert.equal(button().props.disabled, false); assert.match(renderedText(button()), /Update assessment questions/);
  await button().props.onPress(); await Promise.resolve();
  assert.deepEqual(env.sent, { action: 'set_assessment_scope', moduleId: 'module', scope: 'current_minimum_standards', expectedInspectionRevision: 11, expectedModuleRevision: 8 });
  for (const patch of [{ busy: 'scope' }, { hasDraft: true }, { earlierDrafts: [['earlier', {}]] }, { pendingSaves: [{}] }, { online: false }]) {
    const previous = Object.fromEntries(Object.keys(patch).map(key => [key, env[key]])); Object.assign(env, patch);
    assert.equal(button().props.disabled, true, JSON.stringify(patch)); Object.assign(env, previous);
  }
  env.active.template.templateVersion = RENTAL_ASSESSMENT_TEMPLATE_VERSION; assert.equal(button(), undefined);
});

test('native photo prompts reflect the corrected answer while previously captured photos remain', () => {
  const currentTemplate = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const check = currentTemplate.sections.flatMap(section => section.checks).find(entry => entry.key === 'mould_damp_observation');
  const select = (node, ast) => ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.photo}>';
  const photo = { uri: 'saved.jpg', capture: { captureObservedAtUtc: '2026-10-08T00:00:00Z' }, mediaId: 'saved-media' };
  const env = { check, photoRequirement: rentalAssessorEvidenceRequirement(check, 'does_not_meet'), active: { key: 'minimum_standards' },
    presentation: undefined,
    styles: {}, editable: true, canRemovePhotos: true, busy: '', evidence: [], visiblePhotos: [photo], draft: { photos: [photo] }, View: 'view', Text: 'text', Image: 'image', FieldButton: 'button', removeSavedPhoto() {},
    capture() { assert.fail('Rendering does not capture or delete evidence'); }, refreshPhotoGps() {}, removePhoto() { assert.fail('Changing an answer never deletes a photo'); } };
  let tree = renderedNativeBranch(select, env); assert.match(renderedText(tree), /2.*photos required/); assert.match(renderedText(tree), /overview/);
  env.photoRequirement = rentalAssessorEvidenceRequirement(check, 'meets'); tree = renderedNativeBranch(select, env);
  assert.doesNotMatch(renderedText(tree), /photos required/); assert.match(renderedText(tree), /No photo required/); assert.match(renderedText(tree), /Add optional photo/);
  assert.equal(renderedNodes(tree, node => node.type === 'image')[0].props.source.uri, 'saved.jpg'); assert.equal(env.draft.photos[0], photo);
  env.check = currentTemplate.sections.flatMap(section => section.checks).find(entry => entry.key === 'cooling_2027_readiness');
  env.photoRequirement = rentalAssessorEvidenceRequirement(env.check, 'meets');
  assert.match(renderedText(renderedNativeBranch(select, env)), /controller|operating indicator/i);
});

test('saved native photos can be previewed by exact media reference while removal stays guarded', () => {
  const select = (node, ast) => ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.photo}>';
  const env = { check: {}, photoRequirement: { minimumFiles: 0, minimumPhotos: 0 }, active: { key: 'minimum_standards' },
    presentation: undefined, styles: {}, editable: false, canRemovePhotos: true, busy: '', visiblePhotos: [], draft: { photos: [] },
    evidence: [{ id: 'one', jobMediaId: 'media-one', fileName: 'chosen.jpg', caption: 'Ceiling insulation', contentType: 'image/jpeg' },
      { id: 'two', jobMediaId: 'media-two', fileName: 'keep.jpg', caption: 'Ceiling insulation', contentType: 'image/jpeg' }],
    View: 'view', Text: 'text', Image: 'image', FieldButton: 'button', removeSavedPhoto(id) { env.removed = id; }, openPhotoPreview(value) { env.preview = value; } };
  const buttons = () => renderedNodes(renderedNativeBranch(select, env), node => node.type === 'button' && renderedText(node) === 'Remove photo');
  const previews = () => renderedNodes(renderedNativeBranch(select, env), node => node.type === 'button' && renderedText(node) === 'Preview photo');
  const tree = renderedNativeBranch(select, env);
  assert.match(renderedText(tree), /Saved photo\s+1/); assert.match(renderedText(tree), /Saved photo\s+2/);
  assert.doesNotMatch(renderedText(tree), /chosen\.jpg|keep\.jpg/);
  previews()[1].props.onPress(); assert.deepEqual(env.preview, { jobMediaId: 'media-two', contentType: 'image/jpeg', title: 'Saved photo 2' });
  assert.equal(buttons().length, 2); assert.equal(buttons()[0].props.disabled, false);
  buttons()[0].props.onPress(); assert.equal(env.removed, 'one');
  env.canRemovePhotos = false; assert.ok(buttons().every(button => button.props.disabled));
  env.canRemovePhotos = true; env.busy = 'remove'; assert.ok(buttons().every(button => button.props.disabled));
  assert.ok(previews().every(button => !button.props.disabled), 'Read-only and busy answer controls must not prevent preview');
  previews()[0].props.onPress(); assert.equal(env.preview.jobMediaId, 'media-one');
});

test('pending photo previews retain the original phone URI and uploaded media reference', () => {
  const select = (node, ast) => ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.photo}>';
  const photo = { uri: 'file:///camera.jpg', mediaId: 'uploaded-photo', capture: { captureObservedAtUtc: '2026-10-09T01:00:00Z' } };
  const env = { check: {}, active: { key: 'minimum_standards' }, photoRequirement: { minimumFiles: 0, minimumPhotos: 0 }, presentation: undefined, styles: {}, editable: false,
    canRemovePhotos: false, busy: 'sync', evidence: [], visiblePhotos: [photo], draft: { photos: [photo] },
    View: 'view', Text: 'text', Image: 'image', FieldButton: 'button', openPhotoPreview(value) { env.preview = value; } };
  const tree = renderedNativeBranch(select, env);
  const preview = renderedNodes(tree, node => node.type === 'button' && renderedText(node) === 'Preview photo')[0];
  assert.ok(!preview.props.disabled); preview.props.onPress();
  assert.deepEqual(env.preview, { jobMediaId: 'uploaded-photo', uri: 'file:///camera.jpg', title: 'Photo on this phone 1' });
  assert.equal(env.draft.photos[0], photo);
});

test('successful photo-removal tombstones cannot count as evidence or re-enter the Next queue before local cleanup', async () => {
  const env = saveEnvironment(); env.draft.photos = [{ ...env.draft.photos[0], uri: 'wrong' }];
  env.saves = [{ status: 'succeeded', photoRemoval: { uri: 'wrong' } }];
  env.enqueueRentalSave = () => assert.fail('Removed evidence cannot satisfy a required photo');
  await assert.rejects(mountedSaveAnswer(env)(), /Attach the evidence supporting this result/);
  env.draft.photos.push({ ...env.draft.photos[0], uri: 'keep' });
  env.enqueueRentalSave = async input => { env.sent = input; return { id: 'saved' }; }; env.advanceQuestion = () => {};
  await mountedSaveAnswer(env)();
  assert.deepEqual(env.sent.photos.map(photo => photo.uri), ['keep']);
  assert.deepEqual(env.sent.draftSnapshot.photos.map(photo => photo.uri), ['keep']);
  assert.deepEqual(env.sent.sourceDraftSnapshot.photos.map(photo => photo.uri), ['keep']);
});

test('native earlier records include retired property switchboard answers but never replace the current check', () => {
  const declaration = source.slice(source.indexOf('  const earlierItems ='), source.indexOf('  const activeDrafts ='));
  const old = { id: 'old-board', moduleId: 'module', sectionKey: 'electrical_safety', checkKey: 'switchboard_observation', instanceKey: 'property', response: { model: 'Old label' } };
  const current = { id: 'new-board', moduleId: 'module', sectionKey: 'electrical_safety', checkKey: 'outlet_lighting_protection', instanceKey: 'property' };
  const otherBusinessModule = { ...old, id: 'another-module', moduleId: 'other-module' };
  const env = { data: { items: [old, current, otherBusinessModule] }, active: { id: 'module', key: 'minimum_standards',
    template: { historicalChecks: [{ sectionKey: 'electrical_safety', check: { key: 'switchboard_observation' } }] } } };
  const earlier = new Function('environment', 'with(environment){' + ts.transpileModule(declaration + '\nreturn earlierItems;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '}')(env);
  assert.deepEqual(earlier, [old]); assert.equal(current.checkKey, 'outlet_lighting_protection');
});

test('the native Home Star question is first, optional, defaults to No and changes only on a deliberate press', () => {
  const currentTemplate = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const declaration = source.slice(source.indexOf('  const metadata ='), source.indexOf('  const accessSuggestion ='));
  const active = { key: 'minimum_standards', template: currentTemplate };
  const metadata = new Function('environment', 'with(environment){' + ts.transpileModule(declaration + '\nreturn metadata;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '}')({ active, observationsReady: false, rentalAssessorMetadataField });
  const field = metadata.find(entry => entry.key === 'homeStarCommissioned');
  assert.ok(field); assert.equal(field.type, 'checkbox'); assert.equal(field.required, false); assert.equal(field.phase, 'setup');
  assert.equal(metadata[0], field); assert.equal(field.label, 'Is this assessment commissioned by Home Star Upgrades?');
  const env = { field, answers: {}, editable: true, busy: '', queuedMetadata: undefined, FieldButton: 'button', View: 'view', styles: {},
    changeAnswer(key, value) { env.answers[key] = value; } };
  const select = (node, ast) => ts.isConditionalExpression(node) && node.condition.getText(ast) === "field.type === 'checkbox'" && node.getText(ast).includes('changeAnswer(field.key');
  const buttons = () => renderedNodes(renderedNativeBranch(select, env), node => node.type === 'button');
  assert.deepEqual(buttons().map(renderedText), ['Yes', 'No']); assert.equal(buttons()[0].props.variant, 'secondary'); assert.equal(buttons()[1].props.variant, 'primary');
  assert.equal(env.answers.homeStarCommissioned, undefined, 'Opening the prompt does not edit the saved assessment');
  buttons()[0].props.onPress(); assert.equal(env.answers.homeStarCommissioned, true); assert.equal(buttons()[0].props.variant, 'primary');
  buttons()[1].props.onPress(); assert.equal(env.answers.homeStarCommissioned, false); assert.equal(buttons()[1].props.variant, 'primary');
  env.busy = 'metadata'; assert.ok(buttons().every(button => button.props.disabled));
});

test('fresh native assessments open Home Star first once while saved answers, queues and drafts resume without interruption', () => {
  const ast = ts.createSourceFile('rental-inspection-workflow.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'openInitialSetup') callback = node.initializer.arguments[0]; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(callback);
  const helpers = source.slice(source.indexOf('const emptyCache'), source.indexOf('function RentalTextField'));
  const compiled = ts.transpileModule(helpers + '\nexport const initialize = ' + callback.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const evaluate = env => new Function('environment', 'with(environment){const exports={};' + compiled + ';return exports.initialize(data, records);}')(env);
  const template = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const baseline = JSON.stringify(template);
  const assessmentModule = { id: 'module', key: 'minimum_standards', template, answers: {}, status: 'not_started' };
  const prefix = ['module', template.assessmentScope || 'legacy', template.templateVersion || 1].join(':') + ':';
  const fresh = () => {
    const env = { selectedModuleId: { current: '' }, promptedModules: { current: new Set() },
      data: { modules: [assessmentModule], items: [], permissions: { canEdit: true } }, records: [], cacheRef: { current: { drafts: {}, answers: {} } }, calls: [],
      setFirstSetupModuleId(value) { env.calls.push(['first', value]); }, setMetadataIndex(value) { env.calls.push(['index', value]); }, setPage(value) { env.calls.push(['page', value]); } };
    return env;
  };
  const env = fresh(); evaluate(env); assert.deepEqual(env.calls, [['first', 'module'], ['index', 0], ['page', 'metadata']]);
  evaluate(env); assert.equal(env.calls.length, 3, 'Navigation or refresh never repeats the initial prompt');
  for (const patch of [{ module: { answers: { homeStarCommissioned: true } } }, { module: { answers: { homeStarCommissioned: false } } },
    { items: [{ moduleId: 'module' }] }, { drafts: { [prefix + 'lighting:0:property']: { photos: ['retained'] } } },
    { records: [{ module: { id: 'module' }, status: 'queued' }] }, { answers: { module: { tenancyStartDate: '2026-10-08' } } },
    { module: { template: { ...template, metadataFields: template.metadataFields.filter(field => field.key !== 'homeStarCommissioned') } } },
    { permissions: { canEdit: false } }, { module: { status: 'complete' } }]) {
    const saved = fresh(); Object.assign(saved.data, { modules: [{ ...assessmentModule, ...patch.module }] }, patch.items && { items: patch.items }, patch.permissions && { permissions: patch.permissions });
    if (patch.drafts) saved.cacheRef.current.drafts = patch.drafts;
    if (patch.answers) saved.cacheRef.current.answers = patch.answers;
    if (patch.records) saved.records = patch.records;
    evaluate(saved); assert.deepEqual(saved.calls, [], JSON.stringify(patch));
  }
  assert.equal(JSON.stringify(template), baseline, 'No existing frozen template is modified to introduce the prompt');
  assert.match(source, /applyResult\(result\); openInitialSetup\(result, saved.records\)/, 'Initial routing occurs in the completed load callback');
});

test('the first native Home Star choice uses durable metadata saving then opens observations without clearing other drafts', async () => {
  for (const choice of [undefined, false, true]) {
    let release;
    const storage = new Promise(resolve => { release = resolve; });
    const env = { active: { id: 'module', revision: 7 }, field: { key: 'homeStarCommissioned', type: 'checkbox', required: false }, firstSetupModuleId: 'module', queuedMetadata: undefined,
      answers: choice === undefined ? {} : { homeStarCommissioned: choice }, metadataIndex: 0, metadata: [{ key: 'homeStarCommissioned' }, { key: 'tenancyStartDate' }],
      propertySteps: [{ section: { key: 'electrical' }, checkIndex: 0 }], workOrderId: 'job',
      cacheRef: { current: { drafts: { retained: { photos: ['original'] } }, answers: { module: { tenancyStartDate: '2026-10-08', ...(choice === undefined ? {} : { homeStarCommissioned: choice }) } } } },
      perform: async (_name, run) => run(), enqueueRentalSave: async input => { env.sent = input; await storage; return { id: 'saved' }; },
      setSaves() {}, setCache() {}, persist: async () => {}, setFirstSetupModuleId(value) { env.firstSetupModuleId = value; },
      openCheck(section, index) { env.opened = [section.key, index]; }, setPage() { assert.fail('The first question advances to the first observation'); }, setMetadataIndex() { assert.fail('Do not ask every property detail before observations'); } };
    const saving = mountedHandler('saveMetadata', 'reviewQueuedAnswer', env)(); await Promise.resolve();
    assert.equal(env.opened, undefined); assert.equal(env.firstSetupModuleId, 'module');
    release(); await saving;
    assert.deepEqual(env.sent.body, { action: 'save_module_answers', moduleId: 'module', expectedRevision: 7, answers: { homeStarCommissioned: choice === true } });
    assert.equal(env.firstSetupModuleId, ''); assert.deepEqual(env.opened, ['electrical', 0]);
    assert.deepEqual(env.cacheRef.current.drafts, { retained: { photos: ['original'] } });
    assert.deepEqual(env.cacheRef.current.answers.module, { tenancyStartDate: '2026-10-08' });
  }
});

test('completing native observations proceeds to the next metadata field without asking Home Star again', () => {
  const env = { active: { key: 'minimum_standards' }, section: { key: 'last' }, check: { key: 'last-check' }, cursor: { checkIndex: 0 }, editable: true,
    propertySteps: [{ section: { key: 'last' }, checkIndex: 0 }], metadata: [{ key: 'homeStarCommissioned' }, { key: 'tenancyStartDate' }],
    setMetadataIndex(value) { env.index = value; }, setPage(value) { env.page = value; } };
  mountedHandler('advanceQuestion', 'changeAnswer', env)(); assert.equal(env.index, 1); assert.equal(env.page, 'metadata');
});

test('native shared hot water uses current response for apartment wording, save requirements and retained photo guidance', async () => {
  const template = rentalAssessmentTemplateSnapshot(['minimum_standards']).modules.minimum_standards;
  const check = template.sections.flatMap(section => section.checks).find(entry => entry.key === 'hot_water_2027_readiness');
  const response = { hotWaterSupplyType: 'Shared building system', sharedHotWaterServiceStatus: 'Hot water supplied when checked', sharedHotWaterLimitation: 'Shared plant locked; request manager access' };
  const declaration = source.slice(source.indexOf('  const presentation ='), source.indexOf('  const sharedObservation ='));
  const env = { check, active: { key: 'minimum_standards', template }, baseDraft: { outcome: 'meets', response }, rentalAssessorCheckPresentation, rentalAssessorEvidenceRequirement };
  const current = new Function('environment', 'with(environment){' + ts.transpileModule(declaration + '\nreturn {presentation, photoRequirement};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '}')(env);
  assert.equal(current.presentation.prompt, 'Is hot water supplied to this apartment?');
  assert.match(current.photoRequirement.reason, /apartment tap or shower/);
  const select = (node, ast) => ts.isJsxElement(node) && node.openingElement.getText(ast) === '<View style={styles.photo}>';
  const tree = renderedNativeBranch(select, { check, ...current, active: env.active, styles: {}, editable: true, canRemovePhotos: true, busy: '', evidence: [], visiblePhotos: [], draft: { photos: [] }, View: 'view', Text: 'text', FieldButton: 'button' });
  assert.match(renderedText(tree), /apartment tap or shower/); assert.doesNotMatch(renderedText(tree), /complete system data plate/);
  const save = saveEnvironment(); save.active = { id: 'module', revision: 1, key: 'minimum_standards', template }; save.check = check; save.draft.response = response;
  save.enqueueRentalSave = async input => { save.sent = input; return { id: 'saved' }; }; save.advanceQuestion = () => {};
  await mountedSaveAnswer(save)(); assert.deepEqual(save.sent.body.response, response);
});

test('a real unsaved answer stays on review with an actionable message instead of bouncing to sections', async () => {
  const env = { active: { id: 'module' }, finishRequest: undefined, earlierDrafts: [], pendingSaves: [], completionBlockers: [], activeHasDraft: true,
    setError(message) { env.message = message; }, setPage() { assert.fail('Finish must not navigate away from review'); } };
  await mountedHandler('finishAssessment', 'previous', env)();
  assert.match(env.message, /unsaved changes/);
  assert.match(env.message, /press Next to save/);
});

test('each optional module confirms its own credential and finishes without promising the whole report', async () => {
  for (const key of ['electrical_safety_check', 'gas_safety_check', 'smoke_alarm_check']) {
    const env = { active: { id: key, key, title: key, answers: {} }, pendingSaves: [], saves: [], activeHasDraft: false, canEmailReport: false, issueReport: false,
      credentialConfirmation: { label: 'I confirm my qualification details are current and accurate' },
      timing: { markCompleted() { assert.fail('An intermediate module does not complete the whole form'); } },
      data: {}, cache: { answers: {} }, completionBlockers: [], finishRequest: undefined, earlierDrafts: [], workOrderId: 'job',
      setError() {}, perform: async (_name, action) => action(), persist: async () => {}, onChanged: async () => {},
      enqueueRentalFinish: async (input) => { env.queued = input; return { id: 'finish' }; }, setSaves() {}, setPage(page) { env.page = page; },
      Alert: { alert(title, message, buttons) { env.title = title; env.message = message; env.confirm = buttons[1].onPress; } } };
    await mountedHandler('finishAssessment', 'previous', env)();
    assert.match(env.title, /^Finish /); assert.match(env.message, /qualification details are current and accurate/);
    assert.match(env.message, /selected assessment only/);
    await env.confirm(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.queued.email, false); assert.equal(env.queued.issueReport, false); assert.equal(env.queued.confirmCredential, true);
    assert.equal(env.page, 'review');
  }
});

test('issued report email uses current sharing access after issuance closes canIssue', () => {
  const declaration = source.slice(source.indexOf('  const canEmailReport ='), source.indexOf('  const photoRemovals ='));
  const compiled = ts.transpileModule(declaration + '\nreturn canEmailReport;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluate = new Function('data', 'report', 'issueReport', compiled);
  assert.equal(evaluate({ deliveryRecipient: { email: 'client@example.test' }, permissions: { canIssue: false, canRevokeLink: true } }, { id: 'issued' }, true), true);
  assert.equal(evaluate({ deliveryRecipient: { email: 'client@example.test' }, permissions: { canIssue: false, canRevokeLink: false } }, { id: 'issued' }, true), false);
  assert.equal(evaluate({ deliveryRecipient: { email: 'client@example.test' }, permissions: { canIssue: true } }, undefined, false), false);
});

test('unverified or inaccessible optional checks record limitations without requiring invented test readings', async () => {
  for (const outcome of ['meets', 'does_not_meet', 'not_accessible', 'specialist_verification_required', 'exemption_evidence_pending']) {
    const env = { draft: { outcome, response: {}, findingDescription: 'Could not access the test point', quotation: {}, quantity: '', unitLabel: 'each' },
      check: { responseType: 'test_result' }, simpleReview: false, editable: true, page: 'details', detailField: { key: 'testReading', required: true },
      detailIndex: 0, responseFields: [{ key: 'testReading' }], RENTAL_ADVERSE_OUTCOMES: new Set(['does_not_meet', 'not_accessible', 'specialist_verification_required', 'exemption_evidence_pending']),
      rentalQuotation: (value) => value, data: { findings: [] }, item: undefined,
      setError(message) { env.message = message; }, setPage(page) { env.page = page; }, change(values) { Object.assign(env.draft, values); },
      perform() { assert.fail('Limitations must still be reviewed before saving'); } };
    await mountedHandler('next', 'saveMetadata', env)();
    if (['meets', 'does_not_meet'].includes(outcome)) assert.match(env.message, /Record this result/);
    else { assert.equal(env.message, undefined); assert.equal(env.page, 'finding'); assert.equal(env.draft.response.testReading, undefined); }
  }
});

test('an untouched optional metadata field advances without queueing an empty answer', async () => {
  const env = { active: { id: 'module' }, field: { key: 'tenancyStartDate', type: 'date', required: false }, queuedMetadata: undefined,
    answers: {}, metadataIndex: 0, metadata: [{ key: 'tenancyStartDate' }],
    setPage(page) { env.page = page; }, setMetadataIndex() {}, perform() { assert.fail('An unset optional field needs no save'); } };
  await mountedHandler('saveMetadata', 'reviewQueuedAnswer', env)();
  assert.equal(env.page, 'review');
});

test('Finish stays on review and explains missing occupancy instead of moving the assessor elsewhere', async () => {
  const env = { active: { id: 'module' }, finishRequest: undefined, earlierDrafts: [], pendingSaves: [],
    completionBlockers: [{ key: 'metadata:occupancyAtAssessment', label: 'Occupancy during the assessment is required.' }],
    setError(message) { env.message = message; }, setPage() { assert.fail('Missing answer must not eject the assessor'); },
    Alert: { alert() { assert.fail('Incomplete assessment must not be authorised'); } } };
  await mountedHandler('finishAssessment', 'previous', env)();
  assert.match(env.message, /Occupancy during the assessment/);
});

test('review recognises saved offline occupancy but never hides invalid or conflicting answers', () => {
  const assessmentModule = { id: 'module', template: { sections: [], metadataFields: [{ key: 'occupancyAtAssessment', type: 'select',
    options: [{ value: 'vacant', label: 'Vacant' }] }] } };
  const result = { completion: { module: { blockers: [{ key: 'metadata:occupancyAtAssessment', label: 'Occupancy required' }] } } };
  const save = { status: 'queued', body: { action: 'save_module_answers', moduleId: 'module', answers: { occupancyAtAssessment: 'vacant' } } };
  assert.deepEqual(rentalPendingCompletionBlockers(result, assessmentModule, [save]), []);
  assert.equal(rentalPendingCompletionBlockers(result, assessmentModule, [{ ...save, status: 'conflict' }]).length, 1);
  assert.equal(rentalPendingCompletionBlockers(result, assessmentModule, [{ ...save, body: { ...save.body, answers: { occupancyAtAssessment: 'invalid' } } }]).length, 1);
});
