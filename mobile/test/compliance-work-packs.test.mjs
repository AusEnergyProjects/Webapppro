import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceFunction(source, name) {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `missing ${name}`);
  return declaration.getText(sourceFile).replace(/^export\s+/, '');
}

function executableBundle(source, names, prelude = '') {
  const output = ts.transpileModule(names.map((name) => sourceFunction(source, name)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return Function(`${prelude}\n${output}\nreturn { ${names.join(', ')} };`)();
}

const jobScreen = read('../src/app/job/[id].tsx');
const wizard = read('../src/components/ActivityWorkPackWizard.tsx');
const signatureCapture = read('../src/components/SignatureCapture.tsx');
const fieldButton = read('../src/components/field-button.tsx');
const types = read('../src/lib/types.ts');
const workPacks = read('../src/lib/work-packs.ts');
const database = read('../src/lib/database.ts');
const api = read('../src/lib/api.ts');
const serverEngine = read('../../src/lib/creditex-activity-work-pack.ts');

test('linked current activities open a phone-first schema-driven wizard without activity-specific forks', () => {
  assert.match(types, /activityWorkPacks\?: FieldActivityWorkPack\[\]/);
  assert.match(types, /customerContextBinding: FieldWorkPackCustomerContextBinding/);
  assert.match(types, /contextSha256: string/);
  assert.match(jobScreen, /<ActivityWorkPackWizard/);
  assert.match(jobScreen, /complianceIntents\.map\(\(intent, index\)/);
  assert.match(jobScreen, /item\.instance\.complianceIntentId === intent\.id/);
  assert.match(wizard, /const AUTOSAVE_DELAY_MS = 700/);
  assert.match(wizard, />Back<\/FieldButton>/);
  assert.match(wizard, />Continue<\/FieldButton>/);
  assert.match(wizard, /Your next step/);
  assert.match(wizard, /Answers save automatically/);
  assert.match(jobScreen, /listPendingWorkPackActions/);
  assert.match(wizard, /pendingActions\.length/);
  assert.match(wizard, /fieldWorkPackVisibilityMatches/);
  assert.match(wizard, /initialFieldWorkPackPage/);
  assert.match(wizard, /completion\.requiredPromptKeys\.filter/);
  assert.match(wizard, /addRepeatItem/);
  assert.match(wizard, /removeRepeatItem/);
  assert.match(wizard, /minimumInstances/);
  assert.match(wizard, /minHeight: 48/);
  assert.match(wizard, /minHeight: 50/);
  assert.doesNotMatch(`${jobScreen}\n${wizard}`, /activity\s*45|home energy assessment questions/i);
  assert.doesNotMatch(wizard, /Schema \{|Response contract|governed reference|server binding/i);
});

test('editable work-pack context resolves minimal predictions without changing protected records or save semantics', () => {
  assert.match(wizard, /import \{ apiRequest \} from '@\/lib\/api'/);
  assert.equal(
    [...wizard.matchAll(/apiRequest<[^>]+>\('\/api\/trade-address-suggestions'/g)].length,
    2,
  );
  assert.doesNotMatch(wizard, /publicApiRequest|\/api\/address-suggestions/);
  assert.match(wizard, /type AddressPrediction = \{ id: string; label: string; provider: string \}/);
  assert.match(wizard, /query\.length < 3/);
  assert.match(wizard, /\}, 280\)/);
  assert.match(wizard, /controller\.abort\(\)/);
  assert.match(wizard, /protectedCustomer \|\| !context\?\.editable/);
  assert.match(wizard, /JSON\.stringify\(\{ action: 'predict', query, sessionToken: addressPredictionSession\.token \}\)/);
  assert.match(wizard, /const sessionToken = addressPredictionSession\.token/);
  assert.match(wizard, /JSON\.stringify\(\{ action: 'resolve', provider: prediction\.provider, providerReference: prediction\.id, query, sessionToken \}\)/);
  assert.match(wizard, /const selection = result\.selection/);
  assert.match(wizard, /accessibilityLabel=\{`Use address \$\{prediction\.label\}`\}/);
  assert.match(wizard, /predictions\.some\(\(prediction\) => prediction\.provider === 'google-places' \|\| prediction\.provider === 'google-geocoding'\) \? <Text style=\{styles\.addressAttribution\}>Google Maps<\/Text> : null/);
  assert.match(wizard, /Crypto\.randomUUID\(\)/);
  for (const field of ['addressLine1', 'addressLine2', 'suburb', 'state', 'postcode']) {
    assert.match(wizard, new RegExp(`${field}: selection\\.`));
  }
  assert.match(wizard, /await onSave\(draft\)/);
  assert.match(wizard, /Changing any site address field returns the address to manual review and removes its previous provider verification/);
  assert.match(
    jobScreen,
    /sitePatch: \{[\s\S]*addressLine1: next\.addressLine1,[\s\S]*addressLine2: next\.addressLine2,[\s\S]*suburb: next\.suburb,[\s\S]*state: next\.state,[\s\S]*postcode: next\.postcode,[\s\S]*\}/,
  );
  assert.match(wizard, /Address suggestion selected\. Check the details before saving\./);
  assert.match(wizard, /Enter the address manually/);
  assert.doesNotMatch(wizard, /address suggestion[^\n]{0,80}verified/i);
});

test('the technician opens at the first incomplete section and Continue remains the primary path', () => {
  const functions = executableBundle(wizard, ['initialFieldWorkPackPage'], `
    const fieldWorkPackSections = (pack) => pack.definition.schema.sections;
    const fieldActivityWorkPackCompletion = ({ response }) => response.__completion;
    const fieldWorkPackSectionInstances = (_section, response) => [
      { instanceKey: '', answers: response.answers },
    ];
    const workPackPromptResponseKey = (_section, _instanceKey, prompt) => prompt.promptKey;
  `);
  const pack = {
    definition: {
      schemaSha256: 'sha256:definition',
      schema: {
        sections: [
          { sectionKey: 'before', repeatability: null, prompts: [{ promptKey: 'done' }] },
          { sectionKey: 'next', repeatability: null, prompts: [{ promptKey: 'required-next' }] },
        ],
      },
    },
    response: {
      answers: {},
      __completion: {
        ready: false,
        requiredPromptKeys: ['done', 'required-next'],
        completedPromptKeys: ['done'],
      },
    },
  };
  assert.equal(functions.initialFieldWorkPackPage(pack), 1);
  pack.response.__completion.ready = true;
  assert.equal(functions.initialFieldWorkPackPage(pack), 2);
  assert.match(wizard, />Continue<\/FieldButton>/);
});

test('the phone flow keeps TLink branding, one section at a time and large primary controls', () => {
  assert.match(wizard, /TLINK FIELD WORK/);
  assert.match(wizard, /<SectionPage/);
  assert.equal(wizard.match(/<SectionPage/g)?.length, 1);
  assert.match(wizard, /Saved offline/);
  assert.match(wizard, /Saving/);
  assert.match(wizard, /Answers save automatically/);
  assert.match(fieldButton, /minHeight: 50/);
  assert.match(wizard, /option: \{[^}]*minHeight: 48/);
  assert.match(wizard, /input: \{[^}]*minHeight: 50/);
  assert.match(signatureCapture, /const PAD_HEIGHT = 220/);
  assert.match(signatureCapture, /Clear signature/);
  assert.match(wizard, />Confirm this signature<\/FieldButton>/);
});

test('governed reference documents use one exact-byte open action and schema-controlled acknowledgement', () => {
  assert.match(types, /referenceDocuments: FieldWorkPackReferenceDocumentProjection\[\]/);
  assert.match(wizard, /prompt\.type === 'reference_document'/);
  assert.match(wizard, />Open document<\/FieldButton>/);
  assert.match(wizard, /mode === 'viewed'/);
  assert.match(wizard, /mode === 'confirmed'/);
  assert.doesNotMatch(wizard, /reference_document[^]*Add required document/);
  assert.match(api, /\/api\/trade-team\/work-packs\/reference-document\?/);
  assert.match(api, /x-creditex-sha256/);
  assert.match(api, /x-creditex-size-bytes/);
  assert.match(api, /x-creditex-custody-receipt/);
  assert.match(api, /await response\.arrayBuffer\(\)/);
  assert.match(api, /actualSha256 !== expectedSha256/);
  assert.match(jobScreen, /fieldWorkPackReferenceDocumentCacheFile/);
  const verifyCache = jobScreen.indexOf('governedReferenceDocumentBytesSha256(await cacheFile.bytes())');
  const openLocal = jobScreen.indexOf('await Linking.openURL(openUri)');
  assert.ok(verifyCache >= 0 && openLocal > verifyCache);
  assert.match(database, /purgeFieldWorkPackReferenceDocuments\(\)/);

  const acknowledgement = executableBundle(
    workPacks,
    ['createFieldWorkPackReferenceDocumentAcknowledgement'],
    "const FIELD_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT = 'creditex-activity-work-pack-reference-document-acknowledgement/v1';",
  );
  const answer = acknowledgement.createFieldWorkPackReferenceDocumentAcknowledgement({
    sourceBindingTargetKey: 'rights-form',
    sourceArtifactId: 'artifact-1',
    sourceArtifactSha256: `sha256:${'a'.repeat(64)}`,
    acknowledgementMode: 'confirmed',
  }, '2026-08-14T10:00:00.000Z');
  assert.deepEqual(answer, {
    contract: 'creditex-activity-work-pack-reference-document-acknowledgement/v1',
    sourceBindingTargetKey: 'rights-form',
    sourceArtifactId: 'artifact-1',
    sourceArtifactSha256: 'a'.repeat(64),
    acknowledgementMode: 'confirmed',
    acknowledged: true,
    acknowledgedAt: '2026-08-14T10:00:00.000Z',
  });
  assert.throws(() => acknowledgement.createFieldWorkPackReferenceDocumentAcknowledgement({
    sourceBindingTargetKey: 'rights-form',
    sourceArtifactId: 'artifact-1',
    sourceArtifactSha256: 'not-a-sha',
    acknowledgementMode: 'viewed',
  }, '2026-08-14T10:00:00.000Z'), /invalid/);
});

test('assigned work-pack downloads open only after retained headers and exact bytes match', async () => {
  const expectedSha256 = 'a'.repeat(64);
  const functions = executableBundle(api, [
    'normaliseSha256',
    'downloadAssignedWorkPackDocument',
  ], `
    const API_BASE_URL = '';
    class ApiError extends Error {
      constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
      }
    }
    const authenticatedHeaders = async () => new Headers();
    const governedReferenceDocumentBytesSha256 = async () => '${expectedSha256}';
  `);
  const originalFetch = globalThis.fetch;
  const exactBytes = Uint8Array.from([37, 80, 68, 70]);
  try {
    globalThis.fetch = async () => new Response(exactBytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(exactBytes.byteLength),
        'x-creditex-sha256': `sha256:${expectedSha256}`,
        'x-creditex-size-bytes': String(exactBytes.byteLength),
        'x-creditex-custody-receipt': 'receipt-1',
      },
    });
    const verified = await functions.downloadAssignedWorkPackDocument(
      '/api/trade-team/work-packs/reference-document?caseInstanceId=case-1&promptKey=rights',
      {
        sha256: `sha256:${expectedSha256}`,
        contentType: 'application/pdf',
        sizeBytes: exactBytes.byteLength,
      },
    );
    assert.deepEqual([...verified.bytes], [...exactBytes]);
    assert.equal(verified.integrityReceipt, 'receipt-1');
    assert.equal(verified.sha256, expectedSha256);

    await assert.rejects(
      () => functions.downloadAssignedWorkPackDocument(
        '/api/admin/compliance-official-sources/source-1',
        {
          sha256: expectedSha256,
          contentType: 'application/pdf',
          sizeBytes: exactBytes.byteLength,
        },
      ),
      (error) => error.code === 'WORK_PACK_DOCUMENT_URL_INVALID',
    );

    globalThis.fetch = async () => new Response(exactBytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(exactBytes.byteLength),
        'x-creditex-sha256': `sha256:${'b'.repeat(64)}`,
        'x-creditex-size-bytes': String(exactBytes.byteLength),
        'x-creditex-custody-receipt': 'receipt-1',
      },
    });
    await assert.rejects(
      () => functions.downloadAssignedWorkPackDocument(
        '/api/trade-team/work-packs/final-record?caseInstanceId=case-1',
        {
          sha256: expectedSha256,
          contentType: 'application/pdf',
          sizeBytes: exactBytes.byteLength,
        },
      ),
      (error) => error.code === 'WORK_PACK_DOCUMENT_HEADERS_MISMATCH',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('only unlinked intents show setup required and trade actions expose no definition authoring surface', () => {
  assert.match(jobScreen, /CREDITEX RELEASE BLOCK/);
  assert.match(jobScreen, /Syncing alone will not clear this block/);
  assert.match(jobScreen, /return pack \? <ActivityWorkPackWizard/);
  assert.match(jobScreen, /: <UnlinkedComplianceWorkPack/);
  assert.match(types, /'work_pack_commit' \| 'work_pack_prepare_signing'/);
  assert.match(types, /\| 'work_pack_capture_signatures'/);
  assert.match(types, /\| 'work_pack_update_customer_context'/);
  assert.match(types, /\| 'work_pack_finalize'/);
  assert.doesNotMatch(types, /work_pack_(?:publish|author|edit_definition|attach_definition)/);
  assert.doesNotMatch(wizard, /on(?:Publish|EditDefinition|AttachDefinition)|publish work pack/i);
});

test('verified program outputs are exact server receipts and missing governance is not handed to the tradie', () => {
  assert.match(types, /calculatorOutputs: FieldWorkPackCalculatorOutput\[\]/);
  assert.match(types, /calculatorPendingReviews: FieldWorkPackCalculatorPendingReview\[\]/);
  assert.match(wizard, /Verified \{calculatorOutput\.claimOutputLabel\}: \{calculatorOutput\.quantity\} \{calculatorOutput\.unit\}/);
  assert.match(wizard, /correct \{calculatorOutput\.claimOutputCode\} action remains separate/);
  assert.doesNotMatch(wizard, /Verified certificate quantity/);
  assert.match(wizard, /This is the exact governed result for this job/);
  assert.match(wizard, /calculatorOutput\.executionReceiptSha256\.slice\(0, 19\)/);
  assert.match(wizard, /Creditex is independently checking the exact run/);
  assert.match(wizard, /Creditex or dispatch must verify/);
  assert.match(wizard, /Choose the exact scenario/);
  assert.match(wizard, /Find the installed approved product/);
  assert.match(wizard, /Show approved products/);
  assert.match(wizard, /Run governed calculation/);
  assert.match(jobScreen, /work_pack_select_scenario/);
  assert.match(jobScreen, /work_pack_select_official_products/);
  assert.match(jobScreen, /work_pack_run_calculator/);
  assert.match(database, /work_pack_select_scenario/);
  assert.match(database, /work_pack_select_official_products/);
  assert.match(database, /work_pack_run_calculator/);
  assert.doesNotMatch(wizard, /Open job setup and resolve|complete this in job setup first|Review job details/);
  assert.doesNotMatch(wizard, /estimate(?:d)? certificate|calculation estimate/i);
});

test('offline work-pack edits coalesce by instance and section while preserving their original CAS base', () => {
  const functions = executableBundle(database, [
    'patchKey',
    'mergeSectionPatches',
    'mergeUniqueByUploadId',
    'mergeReferenceAcknowledgements',
    'workPackUploadIds',
    'workPackActionPhaseError',
    'mergeQueuedWorkPackCommit',
    'mergeQueuedWorkPackSignatureCapture',
    'mergeQueuedWorkPackCustomerContext',
  ]);
  const previous = {
    clientActionId: 'action-original-123',
    type: 'work_pack_commit',
    workOrderId: 'work-1',
    caseInstanceId: 'instance-1',
    expectedResponseSha256: 'sha256:base',
    baseRevision: 7,
    sectionPatches: [{ sectionKey: 'units', repeatInstanceKey: 'unit-1', remove: false, answers: { make: 'A' } }],
    artifactLinks: [{ clientUploadId: 'upload-photo', promptKey: 'photo' }],
  };
  const next = {
    ...previous,
    clientActionId: 'action-new-456',
    sectionPatches: [{ sectionKey: 'units', repeatInstanceKey: 'unit-1', remove: false, answers: { model: 'B' } }],
  };
  const merged = functions.mergeQueuedWorkPackCommit(previous, next);
  assert.equal(merged.clientActionId, previous.clientActionId);
  assert.equal(merged.baseRevision, 7);
  assert.equal(merged.expectedResponseSha256, 'sha256:base');
  assert.deepEqual(merged.sectionPatches, [{
    sectionKey: 'units',
    repeatInstanceKey: 'unit-1',
    remove: false,
    answers: { make: 'A', model: 'B' },
  }]);
  assert.equal(merged.artifactLinks[0].clientUploadId, 'upload-photo');
  assert.equal(merged.signaturePackets, undefined);
  assert.throws(() => functions.mergeQueuedWorkPackCommit(previous, {
    ...next,
    expectedResponseSha256: 'sha256:newer',
  }), /same work-pack base/);

  const preparedSignatureBase = {
    clientActionId: 'signature-original-123',
    type: 'work_pack_capture_signatures',
    workOrderId: 'work-1',
    caseInstanceId: 'prepared-instance-1',
    expectedResponseSha256: 'sha256:prepared',
    baseRevision: 7,
    signaturePackets: [{ clientUploadId: 'signature-upload-1', promptKey: 'customer' }],
  };
  const capturedTogether = functions.mergeQueuedWorkPackSignatureCapture(
    preparedSignatureBase,
    {
      ...preparedSignatureBase,
      clientActionId: 'signature-new-456',
      signaturePackets: [{ clientUploadId: 'signature-upload-2', promptKey: 'technician' }],
    },
  );
  assert.equal(capturedTogether.clientActionId, preparedSignatureBase.clientActionId);
  assert.deepEqual(capturedTogether.signaturePackets.map((packet) => packet.clientUploadId), [
    'signature-upload-1',
    'signature-upload-2',
  ]);
  assert.throws(() => functions.mergeQueuedWorkPackSignatureCapture(
    preparedSignatureBase,
    { ...preparedSignatureBase, expectedResponseSha256: 'sha256:other' },
  ), /same prepared work-pack version/);

  const customerBase = {
    clientActionId: 'customer-correction-original',
    type: 'work_pack_update_customer_context',
    workOrderId: 'work-1',
    caseInstanceId: 'instance-1',
    expectedResponseSha256: 'sha256:base',
    baseRevision: 7,
    baseCustomerRevision: '2026-08-14T00:00:00.000Z',
    baseSiteRevision: '2026-08-14T00:00:00.000Z',
    baseContactRevision: '2026-08-14T00:00:00.000Z',
    customerPatch: { firstName: 'Jane' },
  };
  const customerMerged = functions.mergeQueuedWorkPackCustomerContext(
    customerBase,
    { ...customerBase, customerPatch: { lastName: 'Citizen' } },
  );
  assert.equal(customerMerged.clientActionId, customerBase.clientActionId);
  assert.deepEqual(customerMerged.customerPatch, {
    firstName: 'Jane',
    lastName: 'Citizen',
  });
  assert.throws(() => functions.mergeQueuedWorkPackCustomerContext(
    customerBase,
    { ...customerBase, baseCustomerRevision: '2026-08-15T00:00:00.000Z' },
  ), /same work-pack customer base/);

  assert.deepEqual(functions.workPackUploadIds(previous), ['upload-photo']);
  assert.deepEqual(functions.workPackUploadIds(preparedSignatureBase), ['signature-upload-1']);
  assert.match(functions.workPackActionPhaseError({
    ...previous,
    signaturePackets: preparedSignatureBase.signaturePackets,
  }), /before preparing and capturing signatures/);
  assert.match(functions.workPackActionPhaseError({
    ...preparedSignatureBase,
    sectionPatches: previous.sectionPatches,
  }), /Sync answers and files/);
  assert.match(functions.workPackActionPhaseError({
    ...preparedSignatureBase,
    customerPatch: { firstName: 'Not part of signing' },
  }), /Sync customer corrections/);
  assert.equal(functions.workPackActionPhaseError(previous), '');
  assert.equal(functions.workPackActionPhaseError(preparedSignatureBase), '');
});

test('signature capture requires vector strokes and produces deterministic payload-bound PDF bytes', () => {
  assert.match(signatureCapture, /Draw with a finger or stylus/);
  assert.match(signatureCapture, /A typed name does not count as a signature/);
  assert.match(types, /capturedAtOffsetMs: number/);
  assert.match(types, /signerRoleKey: string/);
  assert.match(types, /identitySource: FieldWorkPackSignerIdentitySource/);
  assert.match(types, /definitionSha256: string/);
  assert.match(types, /declarationsSha256: string/);
  assert.match(types, /signaturePayload: FieldWorkPackSignaturePayload/);
  assert.match(types, /deviceAttestation: FieldWorkPackDeviceAttestation/);
  assert.match(types, /signatureSha256: string/);
  assert.match(jobScreen, /type: 'work_pack_capture_signatures'/);
  assert.match(jobScreen, /governedReferenceDocumentBytesSha256\(\s*await signatureFile\.bytes\(\)/);
  assert.ok(jobScreen.indexOf('signatureFile.write(signaturePdf)') > jobScreen.indexOf("setBusy(`work-pack-signature:"));
  assert.match(jobScreen, /if \(signatureFile\.exists\) signatureFile\.delete\(\)/);
  assert.match(jobScreen, /actionQueued = true/);
  assert.match(jobScreen, /if \(!actionQueued\) await discardUpload\(clientUploadId\)/);
  assert.match(jobScreen, /deviceAttestationSha256 = await fieldWorkPackSha256/);
  assert.match(jobScreen, /promptKey: context\.prompt\.promptKey/);

  const { signatureDraftReady } = executableBundle(workPacks, ['signatureDraftReady']);
  const role = {
    roleKey: 'customer',
    capacity: 'Customer',
    identitySource: 'customer_context',
    identityRequirements: [{ fieldKey: 'authority', required: true }],
  };
  assert.match(signatureCapture, /Signer fixed from this job/);
  assert.match(signatureCapture, /liveValue\.signerName \|\| 'Signer identity unavailable'/);
  assert.doesNotMatch(signatureCapture, /TextInput|onChangeText|Enter the signer's full name/);
  assert.match(jobScreen, /signerName: signerBinding\.signerName/);
  assert.match(jobScreen, /fields: \{ \.\.\.signerBinding\.fields \}/);
  assert.match(signatureCapture, /MAX_SIGNATURE_POINTS = 1_024/);
  const typedOnly = {
    signerRoleKey: 'customer',
    signerCapacity: 'Customer',
    signerName: 'Test Customer',
    identity: { authority: 'Owner' },
    strokes: [],
  };
  assert.equal(signatureDraftReady(role, typedOnly), false);
  assert.equal(signatureDraftReady(role, {
    ...typedOnly,
    strokes: [{ points: [{}, {}, {}] }],
  }), true);

  const pdf = executableBundle(workPacks, [
    'compareText',
    'canonicalFieldWorkPackJson',
    'pdfText',
    'asciiJson',
    'createFieldWorkPackSignaturePdf',
  ]);
  const payload = {
    contract: 'creditex-activity-work-pack-signature-payload/v1',
    instanceKey: 'instance-key',
    caseInstanceId: 'instance-1',
    promptKey: 'signatures.customer',
    signerRoleKey: 'customer',
    signerName: 'Test Customer',
    signerCapacity: 'Customer',
    signerIdentitySha256: `sha256:${'1'.repeat(64)}`,
    attestationSha256: `sha256:${'2'.repeat(64)}`,
    definitionSha256: `sha256:${'3'.repeat(64)}`,
    prefillSha256: `sha256:${'4'.repeat(64)}`,
    responseSha256: `sha256:${'5'.repeat(64)}`,
    declarationsSha256: `sha256:${'6'.repeat(64)}`,
    strokes: [{ points: [
      { x: 0.1, y: 0.2, pressure: null, capturedAtOffsetMs: 0 },
      { x: 0.5, y: 0.6, pressure: 0.7, capturedAtOffsetMs: 12 },
      { x: 0.8, y: 0.4, pressure: 0.5, capturedAtOffsetMs: 24 },
    ] }],
    signedAt: '2026-08-14T10:00:00.000Z',
  };
  const first = pdf.createFieldWorkPackSignaturePdf(payload);
  const second = pdf.createFieldWorkPackSignaturePdf(payload);
  assert.equal(first, second);
  assert.match(first, /^%PDF-1\.7/);
  assert.match(first, /signature-payload\.json/);
  assert.match(first, /creditex-activity-work-pack-signature-payload\/v1/);
});

test('review keeps governed delivery identities read-only and signing uses large visible stroke boxes', () => {
  assert.match(types, /executionContext: \{/);
  assert.match(types, /provider: FieldWorkPackProviderContext/);
  assert.match(types, /installerBusiness: FieldWorkPackInstallerBusinessContext/);
  assert.match(types, /assignment: FieldWorkPackAssignmentContext/);
  assert.match(types, /finalRecord: FieldWorkPackFinalRecord \| null/);
  assert.match(wizard, /Authorised provider/);
  assert.match(wizard, /Trade business/);
  assert.match(wizard, /Assigned technician or assessor/);
  assert.match(wizard, /cannot be edited here/);
  assert.match(wizard, /Delivery identities not loaded/);
  assert.match(wizard, /executionContextReady/);
  assert.match(wizard, /&& executionContextReady/);
  assert.match(signatureCapture, /const PAD_HEIGHT = 220/);
  assert.match(signatureCapture, /Clear signature/);
  assert.match(signatureCapture, /liveValue\.strokes\.map/);
  assert.match(signatureCapture, /const signed = liveValue\.strokes\.length/);
  assert.match(signatureCapture, /displayOnly/);
  assert.match(wizard, /capturedSignatureDraft/);
  assert.match(wizard, /signature\.signaturePayload\?\.strokes/);
  assert.match(wizard, /<SignatureCapture[\s\S]*displayOnly/);
  assert.match(wizard, /Signature securely retained/);
  assert.match(wizard, /new Date\(signature\.signedAt\)\.toLocaleString\('en-AU'\)/);
  assert.match(wizard, /Completed activity PDF/);
  assert.match(wizard, />Open completed PDF<\/FieldButton>/);
  assert.match(wizard, /Do not treat the work pack as handed over until the signed PDF is available here/);
  assert.match(wizard, /pack\.finalRecord\.fileName/);
  assert.match(api, /\/api\/trade-team\/work-packs\/final-record\?/);
  assert.match(jobScreen, /fieldWorkPackFinalRecordCacheFile/);
  assert.match(jobScreen, /openWorkPackFinalRecord/);
  assert.match(jobScreen, /record\.caseInstanceId !== pack\.instance\.id/);
  assert.match(jobScreen, /record\.downloadUrl/);
  assert.match(jobScreen, /onOpenFinalRecord=\{\(\) => openWorkPackFinalRecord\(pack\)\}/);
  assert.match(jobScreen, /pack\.instance\.status !== 'completed' \|\| !pack\.finalRecord/);
  assert.doesNotMatch(wizard, /signatureObjectKey|objectKey/);
});

test('the mobile completion evaluator stays deterministic with the authoritative server evaluator', () => {
  const mobile = executableBundle(workPacks, [
    'hasAnswer',
    'scalarEquals',
    'conditionMatches',
    'fieldWorkPackVisibilityMatches',
    'validIsoDate',
    'validIsoDateTime',
    'answerMatchesPrompt',
    'fieldActivityWorkPackCompletion',
  ], "const FIELD_WORK_PACK_RESPONSE_CONTRACT = 'creditex-activity-work-pack-response/v1';");
  const sha = `sha256:${'a'.repeat(64)}`;
  const server = executableBundle(serverEngine, [
    'hasAnswer',
    'scalarEquals',
    'conditionMatches',
    'creditexActivityWorkPackVisibilityMatches',
    'validIsoDate',
    'validIsoDateTime',
    'answerMatchesPrompt',
    'creditexActivityWorkPackCompletion',
  ], `
    const CREDITEX_ACTIVITY_WORK_PACK_RESPONSE_CONTRACT = 'creditex-activity-work-pack-response/v1';
    const CREDITEX_ACTIVITY_WORK_PACK_REFERENCE_DOCUMENT_ACKNOWLEDGEMENT_CONTRACT = 'creditex-activity-work-pack-reference-document-acknowledgement/v1';
    const validateCreditexActivityWorkPack = (value) => value;
    const creditexCanonicalSha256 = () => '${sha}';
    const deepFreeze = (value) => value;
  `);
  const prompt = (overrides) => ({
    promptKey: 'prompt', order: 1, type: 'text', label: 'Prompt', instructions: '',
    required: true, visibility: null, dependencyKeys: [], requirementKeys: [], stageKey: '',
    options: [], signerRoleKey: '', attestation: null, minimumLength: null,
    maximumLength: null, minimumNumber: null, maximumNumber: null, numberStep: null,
    unit: '', minimumSelections: null, maximumSelections: null, fileRequirement: null,
    referenceDocument: null,
    ...overrides,
  });
  const workPack = {
    dependencies: [{ dependencyKey: 'product', label: 'Product', required: true }],
    signerRoles: [{ roleKey: 'customer', minimumSignatures: 1, maximumSignatures: 1 }],
    sections: [
      {
        sectionKey: 'main', title: 'Main', visibility: null, repeatability: null,
        prompts: [
          prompt({ promptKey: 'eligible', type: 'checkbox' }),
          prompt({
            promptKey: 'rights',
            type: 'reference_document',
            referenceDocument: {
              sourceBindingTargetKey: 'rights-document',
              acknowledgementMode: 'confirmed',
              acknowledgementText: 'I have read this document.',
              acknowledgementVersion: '2026-08-14',
            },
          }),
          prompt({ promptKey: 'customer-signature', type: 'signature', signerRoleKey: 'customer' }),
        ],
      },
      {
        sectionKey: 'units', title: 'Units',
        visibility: { match: 'all', conditions: [{ promptKey: 'eligible', scope: 'work_pack', operator: 'equals', value: true }] },
        repeatability: { minimumInstances: 1, maximumInstances: 3 },
        prompts: [
          prompt({ promptKey: 'capacity', type: 'number', minimumNumber: 0, maximumNumber: 10, numberStep: 0.5 }),
          prompt({ promptKey: 'photo', type: 'photo', fileRequirement: { minimumCount: 1, maximumCount: 2 } }),
        ],
      },
    ],
  };
  const response = {
    contract: 'creditex-activity-work-pack-response/v1',
    schemaSha256: sha,
    answers: {
      eligible: true,
      rights: {
        contract: 'creditex-activity-work-pack-reference-document-acknowledgement/v1',
        sourceBindingTargetKey: 'rights-document',
        sourceArtifactId: 'source-rights-v1',
        sourceArtifactSha256: 'b'.repeat(64),
        acknowledgementMode: 'confirmed',
        acknowledged: true,
        acknowledgedAt: '2026-08-14T10:00:00.000Z',
      },
      'customer-signature': ['signature-1'],
    },
    repeatableSections: { units: [{ instanceKey: 'unit-1', answers: { capacity: 1.5, photo: ['artifact-1'] } }] },
    dependencyResolutions: { product: { status: 'resolved', referenceIds: ['product-1'], snapshotSha256: sha } },
  };
  const mobileReady = mobile.fieldActivityWorkPackCompletion({
    workPack,
    response,
    expectedSchemaSha256: sha,
  });
  const serverReady = server.creditexActivityWorkPackCompletion({ workPack, response });
  assert.deepEqual(mobileReady, serverReady);
  assert.equal(mobileReady.ready, true);

  const invalidStep = structuredClone(response);
  invalidStep.repeatableSections.units[0].answers.capacity = 1.25;
  assert.deepEqual(
    mobile.fieldActivityWorkPackCompletion({ workPack, response: invalidStep, expectedSchemaSha256: sha }),
    server.creditexActivityWorkPackCompletion({ workPack, response: invalidStep }),
  );
});
