export class CreditexComplianceError extends Error {
  readonly code: string;
  readonly status: number;
  trainingModules: { id: string; title: string }[] = [];
  constructor(code: string, message: string, status = 403) {
    super(message); this.code = code; this.status = status;
  }
}
export function creditexMutationConflict(error: unknown): CreditexComplianceError | null {
  const message = error instanceof Error ? error.message : String(error);
  return /trade_crm_write_guard|CHECK constraint failed:\s*verified\s*=\s*1/i.test(message)
    ? new CreditexComplianceError('CREDITEX_ELIGIBILITY_CHANGED', 'The compliance eligibility or record changed during this operation. Refresh and complete any outstanding onboarding, training or credential requirements before retrying.', 409)
    : null;
}

export type CreditexPerson = { name: string; address: string; email: string; mobile: string; idDocumentId: string; selfieDocumentId: string };
export type CreditexApplication = {
  legalName: string; acn: string; hasWebsite: boolean; website: string; address: string;
  insuranceDocumentId: string; insuranceExpiresOn: string; priorProposalDocumentId: string;
  doesNswWork: boolean; contractorLicenceDocumentId: string; director: CreditexPerson;
  directorIsGuarantor: boolean; guarantor: CreditexPerson & { position: string };
  witness: { name: string; position: string; email: string }; acceptedPrivacy: boolean;
  agreementDocumentId: string; acceptedCompliance: boolean;
};
export type CreditexBusinessRow = { owner_uid: string; business_abn: string; business_name: string; status: string; revision: number; application_json: string;
  insurance_expires_on: string; agreement_reference: string; review_note: string; reviewed_by_uid: string;
  reviewed_at: string; updated_at: string };

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CreditexComplianceError('INPUT_INVALID', 'Send an object with the requested fields.', 400);
  return value as Record<string, unknown>;
}
export function textField(value: unknown, maximum = 300): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new CreditexComplianceError('INPUT_INVALID', 'A field is invalid or too long.', 400);
  return value.trim();
}
export function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function revisionInput(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new CreditexComplianceError('REVISION_REQUIRED', 'Refresh the application before saving.', 409);
  return Number(value);
}
function person(value: unknown): CreditexPerson {
  const row = record(value);
  return { name: textField(row.name), address: textField(row.address, 1000), email: textField(row.email).toLowerCase(), mobile: textField(row.mobile, 40), idDocumentId: textField(row.idDocumentId, 80), selfieDocumentId: textField(row.selfieDocumentId, 80) };
}
export function normaliseCreditexApplication(value: unknown): CreditexApplication {
  const row = record(value); const guarantor = record(row.guarantor); const witness = record(row.witness);
  for (const key of ['hasWebsite', 'doesNswWork', 'directorIsGuarantor', 'acceptedPrivacy']) {
    if (typeof row[key] !== 'boolean') throw new CreditexComplianceError('INPUT_INVALID', `${key} must be yes or no.`, 400);
  }
  if (row.acceptedCompliance !== undefined && typeof row.acceptedCompliance !== 'boolean') throw new CreditexComplianceError('INPUT_INVALID', 'acceptedCompliance must be yes or no.', 400);
  return { legalName: textField(row.legalName), acn: textField(row.acn, 20).replace(/\s/g, ''), hasWebsite: row.hasWebsite === true, website: textField(row.website, 1000), address: textField(row.address, 1000), insuranceDocumentId: textField(row.insuranceDocumentId, 80), insuranceExpiresOn: textField(row.insuranceExpiresOn, 10), priorProposalDocumentId: textField(row.priorProposalDocumentId, 80), doesNswWork: row.doesNswWork === true, contractorLicenceDocumentId: textField(row.contractorLicenceDocumentId, 80), director: person(row.director), directorIsGuarantor: row.directorIsGuarantor === true, guarantor: { ...person(guarantor), position: textField(guarantor.position) }, witness: { name: textField(witness.name), position: textField(witness.position), email: textField(witness.email).toLowerCase() }, acceptedPrivacy: row.acceptedPrivacy === true, agreementDocumentId: textField(row.agreementDocumentId, 80), acceptedCompliance: row.acceptedCompliance === true };
}
const personalEmailDomains = new Set(['gmail.com','googlemail.com','hotmail.com','outlook.com','live.com','yahoo.com','yahoo.com.au','icloud.com','aol.com','proton.me','protonmail.com']);
function validCorporateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !personalEmailDomains.has(email.split('@')[1]);
}
function validAcn(acn: string) {
  return /^\d{9}$/.test(acn) && (10 - [...acn.slice(0, 8)].reduce((sum, n, i) => sum + Number(n) * (8 - i), 0) % 10) % 10 === Number(acn[8]);
}
export function validateCreditexSubmission(application: CreditexApplication, now = new Date(), requireSignedDocument = true) {
  const missing: string[] = [];
  if (!/\bpty\.?\s+ltd\.?$/i.test(application.legalName)) missing.push('Pty Ltd company legal name');
  if (!validAcn(application.acn)) missing.push('valid company ACN');
  if (!application.address) missing.push('registered company address');
  if (application.hasWebsite) {
    try { const url = new URL(application.website); if (!['https:', 'http:'].includes(url.protocol)) missing.push('company website'); } catch { missing.push('company website'); }
  }
  if (!application.insuranceDocumentId || !isValidDate(application.insuranceExpiresOn) || application.insuranceExpiresOn < now.toISOString().slice(0, 10)) missing.push('current public and product liability insurance and expiry');
  if (application.doesNswWork && !application.contractorLicenceDocumentId) missing.push('NSW company contractor licence');
  const people: [string, CreditexPerson][] = [['Director', application.director]];
  if (!application.directorIsGuarantor) people.push(['Guarantor', application.guarantor]);
  for (const [label, value] of people) {
    if (!value.name || !value.address || !validCorporateEmail(value.email) || !/^(?:04\d{8}|\+614\d{8})$/.test(value.mobile.replace(/[\s()-]/g, '')) || !value.idDocumentId || !value.selfieDocumentId) missing.push(`${label} name, address, business email, AU mobile, photo ID and selfie holding ID`);
  }
  if (!application.directorIsGuarantor && !application.guarantor.position) missing.push('guarantor company position');
  if (!application.witness.name || !application.witness.position || !validCorporateEmail(application.witness.email)) missing.push('witness name, position and business email');
  if (!application.acceptedPrivacy) missing.push('consent to use onboarding information');
  if (requireSignedDocument && !application.agreementDocumentId) missing.push('signed Creditex partnership agreement');
  if (requireSignedDocument && !application.acceptedCompliance) missing.push('business compliance declaration');
  if (missing.length) throw new CreditexComplianceError('ONBOARDING_INCOMPLETE', `Complete: ${missing.join('; ')}.`, 400);
}

export async function getCreditexBusinessRow(db: D1Database, ownerUid: string) {
  return db.prepare('SELECT * FROM creditex_business_onboarding WHERE owner_uid = ?').bind(ownerUid).first<CreditexBusinessRow>();
}
export async function getCreditexBusinessStatus(db: D1Database, ownerUid: string) {
  const row = await getCreditexBusinessRow(db, ownerUid);
  const approved = Boolean(await db.prepare(`SELECT 1 AS approved WHERE ${businessApprovalSql('?')}`).bind(ownerUid).first());
  const completion = approved && row?.status === 'submitted' ? await db.prepare('SELECT reference,completed_at FROM creditex_onboarding_completions WHERE owner_uid=? AND revision=?').bind(ownerUid, row.revision).first<{ reference: string; completed_at: string }>() : null;
  const blockedReasons: string[] = [];
  if (!approved) {
    if (row?.status === 'suspended' || row?.status === 'rejected') blockedReasons.push('This business has an existing compliance restriction. Contact Creditex to resolve it.');
    else if (!row) blockedReasons.push('Complete your company details, private documents and signed partnership agreement.');
    else {
      try {
        const application = normaliseCreditexApplication(JSON.parse(row.application_json));
        application.doesNswWork ||= await businessServesNsw(db, ownerUid);
        validateCreditexSubmission(application);
        await validateOnboardingDocumentReferences(db, ownerUid, application);
      } catch (error) {
        blockedReasons.push(error instanceof CreditexComplianceError ? error.message : 'Complete your saved company details.');
      }
      if (!blockedReasons.length) blockedReasons.push('Save and complete onboarding for the current business details and documents.');
    }
  }
  return { status: completion ? 'completed' : row?.status === 'submitted' ? 'incomplete' : row?.status || 'not_started', revision: row?.revision || 0, insuranceExpiresOn: row?.insurance_expires_on || '', approved, blockedReasons, completionReference: completion?.reference || '', completedAt: completion?.completed_at || '' };
}
export function businessApprovalSql(ownerUidSql: string) {
  return `EXISTS (SELECT 1 FROM creditex_current_business_approvals WHERE owner_uid = ${ownerUidSql})`;
}
async function businessServesNsw(db: D1Database, ownerUid: string) {
  return Boolean(await db.prepare(`SELECT 1 FROM trade_accounts account WHERE firebase_uid=? AND (EXISTS(SELECT 1 FROM json_each(account.service_states) WHERE upper(trim(value))='NSW') OR (NOT EXISTS(SELECT 1 FROM json_each(account.service_states) WHERE upper(trim(value)) IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')) AND upper(trim(account.address_state))='NSW'))`).bind(ownerUid).first());
}
export function creditexWriteGuard(db: D1Database, ownerUid: string, predicate: string, bindings: (string | number)[] = []) {
  return db.prepare(`INSERT INTO trade_crm_write_guards (id,firebase_uid,operation_id,step_number,verified,created_at) VALUES (?,?,?,1,CASE WHEN (${predicate}) THEN 1 ELSE 0 END,?)`).bind(crypto.randomUUID(), ownerUid, `creditex-compliance:${crypto.randomUUID()}`, ...bindings, new Date().toISOString());
}
export function onboardingAuditStatement(db: D1Database, ownerUid: string, actorUid: string, eventType: string, revision: number, metadata: Record<string, unknown> = {}) {
  return db.prepare('INSERT INTO creditex_onboarding_events (id,owner_uid,actor_uid,event_type,revision,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), ownerUid, actorUid, eventType, revision, JSON.stringify(metadata), new Date().toISOString());
}
export type CreditexOnboardingDocument = { id: string; owner_uid: string; kind: string; object_key: string; sha256: string };
export async function validateOnboardingDocumentReferences(db: D1Database, ownerUid: string, application: CreditexApplication) {
  const refs: [string, string][] = [[application.insuranceDocumentId, 'insurance'],[application.priorProposalDocumentId,'prior_proposal'],[application.contractorLicenceDocumentId,'contractor_licence'],[application.director.idDocumentId,'director_id'],[application.director.selfieDocumentId,'director_selfie'],[application.guarantor.idDocumentId,'guarantor_id'],[application.guarantor.selfieDocumentId,'guarantor_selfie'],[application.agreementDocumentId,'partnership_agreement']];
  const documents: CreditexOnboardingDocument[] = [];
  for (const [id, kind] of refs.filter(([id]) => id)) {
    const document = await db.prepare('SELECT id,owner_uid,kind,object_key,sha256 FROM creditex_onboarding_documents WHERE id = ? AND owner_uid = ? AND kind = ?').bind(id, ownerUid, kind).first<CreditexOnboardingDocument>();
    if (!document || !document.object_key || !/^[0-9a-f]{64}$/.test(document.sha256)) throw new CreditexComplianceError('DOCUMENT_INVALID', 'An onboarding document is missing or does not belong to this business and document type. Upload the required document again.', 400);
    documents.push(document);
  }
  return documents;
}
export async function saveCreditexApplication(db: D1Database, ownerUid: string, actorUid: string, expectedRevision: number, value: unknown) {
  const application = normaliseCreditexApplication(value);
  await validateOnboardingDocumentReferences(db, ownerUid, application);
  const current = await getCreditexBusinessRow(db, ownerUid);
  if (current && ['suspended', 'rejected'].includes(current.status)) throw new CreditexComplianceError('ONBOARDING_RESTRICTED', 'This business has an existing compliance restriction. Contact Creditex to resolve it.');
  const account = await db.prepare('SELECT abn,business_name FROM trade_accounts WHERE firebase_uid=?').bind(ownerUid).first<{ abn: string; business_name: string }>();
  if (!account) throw new CreditexComplianceError('BUSINESS_ACCOUNT_REQUIRED', 'Create the business account before onboarding.', 409);
  if ((current?.revision || 0) !== expectedRevision) throw new CreditexComplianceError('REVISION_CONFLICT', 'The application changed. Refresh before saving.', 409);
  const now = new Date().toISOString(); const revision = expectedRevision + 1;
  const guard = creditexWriteGuard(db, ownerUid, `COALESCE((SELECT revision FROM creditex_business_onboarding WHERE owner_uid = ?),0) = ? AND NOT EXISTS(SELECT 1 FROM creditex_business_onboarding WHERE owner_uid=? AND status IN ('suspended','rejected')) AND EXISTS(SELECT 1 FROM trade_accounts WHERE firebase_uid=? AND abn=? AND business_name=?)`, [ownerUid, expectedRevision, ownerUid, ownerUid, account.abn, account.business_name]);
  const statement = current ? db.prepare(`UPDATE creditex_business_onboarding SET status='draft',business_abn=?,business_name=?,revision=?,application_json=?,insurance_expires_on=?,agreement_reference='',review_note='',reviewed_by_uid='',reviewed_at='',updated_at=? WHERE owner_uid=? AND revision=?`).bind(account.abn, account.business_name, revision, JSON.stringify(application), application.insuranceExpiresOn, now, ownerUid, expectedRevision)
    : db.prepare(`INSERT INTO creditex_business_onboarding(owner_uid,business_abn,business_name,status,revision,application_json,insurance_expires_on,updated_at) VALUES (?,?,?,'draft',?,?,?,?)`).bind(ownerUid, account.abn, account.business_name, revision, JSON.stringify(application), application.insuranceExpiresOn, now);
  await db.batch([guard, statement, onboardingAuditStatement(db, ownerUid, actorUid, 'application_saved_approval_invalidated', revision, { application, businessAbn: account.abn, businessName: account.business_name })]);
  return getCreditexBusinessStatus(db, ownerUid);
}
export async function submitCreditexApplication(db: D1Database, ownerUid: string, actorUid: string, expectedRevision: number, verifyDocument: (document: CreditexOnboardingDocument) => Promise<void>) {
  const row = await getCreditexBusinessRow(db, ownerUid);
  if (row && ['suspended', 'rejected'].includes(row.status)) throw new CreditexComplianceError('ONBOARDING_RESTRICTED', 'This business has an existing compliance restriction. Contact Creditex to resolve it.');
  if (!row || row.revision !== expectedRevision || !['draft', 'submitted', 'agreement_pending'].includes(row.status)
    || await db.prepare('SELECT 1 FROM creditex_onboarding_completions WHERE owner_uid=? AND revision=?').bind(ownerUid, expectedRevision).first()) throw new CreditexComplianceError('REVISION_CONFLICT', 'Save a current draft before completing onboarding.', 409);
  const account = await db.prepare('SELECT abn,business_name,service_states,address_state FROM trade_accounts WHERE firebase_uid=?').bind(ownerUid).first<{ abn: string; business_name: string; service_states: string; address_state: string }>();
  if (!account || account.abn !== row.business_abn || account.business_name !== row.business_name) throw new CreditexComplianceError('BUSINESS_IDENTITY_CHANGED', 'Save onboarding again with the current business identity.', 409);
  const application = normaliseCreditexApplication(JSON.parse(row.application_json));
  application.doesNswWork ||= await businessServesNsw(db, ownerUid);
  validateCreditexSubmission(application);
  const documents = await validateOnboardingDocumentReferences(db, ownerUid, application);
  for (const document of documents) await verifyDocument(document);
  const agreement = documents.find(document => document.id === application.agreementDocumentId && document.kind === 'partnership_agreement');
  if (!agreement) throw new CreditexComplianceError('SIGNED_AGREEMENT_REQUIRED', 'Upload the signed Creditex partnership agreement.', 400);
  const now = new Date().toISOString(); const revision = expectedRevision + 1;
  const reference = `TL-CX-ONBOARD-${crypto.randomUUID().toUpperCase()}`;
  const documentGuards = documents.map(document => creditexWriteGuard(db, ownerUid, 'EXISTS(SELECT 1 FROM creditex_onboarding_documents WHERE id=? AND owner_uid=? AND kind=? AND object_key=? AND sha256=?)', [document.id, ownerUid, document.kind, document.object_key, document.sha256]));
  await db.batch([creditexWriteGuard(db, ownerUid, `EXISTS(SELECT 1 FROM creditex_business_onboarding onboarding JOIN trade_accounts account ON account.firebase_uid=onboarding.owner_uid AND account.abn=onboarding.business_abn AND account.business_name=onboarding.business_name WHERE onboarding.owner_uid=? AND onboarding.revision=? AND onboarding.status=? AND onboarding.application_json=? AND account.service_states=? AND account.address_state=? AND NOT EXISTS(SELECT 1 FROM creditex_onboarding_completions receipt WHERE receipt.owner_uid=onboarding.owner_uid AND receipt.revision=onboarding.revision))`, [ownerUid, expectedRevision, row.status, row.application_json, account.service_states, account.address_state]),
    ...documentGuards,
    db.prepare(`UPDATE creditex_business_onboarding SET status='submitted',revision=revision+1,application_json=?,updated_at=? WHERE owner_uid=?`).bind(JSON.stringify(application), now, ownerUid),
    db.prepare('INSERT INTO creditex_onboarding_completions(id,owner_uid,revision,business_abn,business_name,agreement_document_id,agreement_sha256,actor_uid,reference,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), ownerUid, revision, row.business_abn, row.business_name, agreement.id, agreement.sha256, actorUid, reference, now),
    onboardingAuditStatement(db, ownerUid, actorUid, 'onboarding_completed', revision, { reference, agreementDocumentId: agreement.id, agreementSha256: agreement.sha256 })]);
  return getCreditexBusinessStatus(db, ownerUid);
}
export async function reviewCreditexApplication(db: D1Database, ownerUid: string, reviewerUid: string, body: Record<string, unknown>) {
  const expectedRevision = revisionInput(body.expectedRevision); const status = textField(body.status, 30); const note = textField(body.reviewNote, 2000); const agreement = textField(body.agreementReference, 300);
  if (!['agreement_pending','approved','rejected','suspended'].includes(status) || !note) throw new CreditexComplianceError('REVIEW_INVALID', 'Choose a review decision and provide a review note.', 400);
  const row = await getCreditexBusinessRow(db, ownerUid);
  if (!row || row.revision !== expectedRevision || row.status === 'draft') throw new CreditexComplianceError('REVISION_CONFLICT', 'The business must submit this revision before review.', 409);
  if (status === 'approved') {
    if (!agreement) throw new CreditexComplianceError('SIGNED_AGREEMENT_REQUIRED', 'Record the executed partnership agreement reference before approving.', 400);
    const application = normaliseCreditexApplication(JSON.parse(row.application_json)); validateCreditexSubmission(application, new Date(), false); await validateOnboardingDocumentReferences(db, ownerUid, application);
  }
  const now = new Date().toISOString();
  await db.batch([creditexWriteGuard(db, ownerUid, `EXISTS(SELECT 1 FROM creditex_business_onboarding cbo JOIN trade_accounts cba ON cba.firebase_uid=cbo.owner_uid AND cba.abn=cbo.business_abn AND cba.business_name=cbo.business_name WHERE cbo.owner_uid=? AND cbo.revision=? AND cbo.status <> 'draft')`, [ownerUid, expectedRevision]),
    db.prepare('UPDATE creditex_business_onboarding SET status=?,revision=revision+1,agreement_reference=?,review_note=?,reviewed_by_uid=?,reviewed_at=?,updated_at=? WHERE owner_uid=?').bind(status, agreement, note, reviewerUid, now, now, ownerUid),
    onboardingAuditStatement(db, ownerUid, reviewerUid, `business_${status}`, expectedRevision + 1, { agreementReference: agreement, reviewNote: note })]);
  return getCreditexBusinessStatus(db, ownerUid);
}
