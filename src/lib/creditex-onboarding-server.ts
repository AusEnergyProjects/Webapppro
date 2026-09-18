export class CreditexComplianceError extends Error {
  readonly code: string;
  readonly status: number;
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
  return { legalName: textField(row.legalName), acn: textField(row.acn, 20).replace(/\s/g, ''), hasWebsite: row.hasWebsite === true, website: textField(row.website, 1000), address: textField(row.address, 1000), insuranceDocumentId: textField(row.insuranceDocumentId, 80), insuranceExpiresOn: textField(row.insuranceExpiresOn, 10), priorProposalDocumentId: textField(row.priorProposalDocumentId, 80), doesNswWork: row.doesNswWork === true, contractorLicenceDocumentId: textField(row.contractorLicenceDocumentId, 80), director: person(row.director), directorIsGuarantor: row.directorIsGuarantor === true, guarantor: { ...person(guarantor), position: textField(guarantor.position) }, witness: { name: textField(witness.name), position: textField(witness.position), email: textField(witness.email).toLowerCase() }, acceptedPrivacy: row.acceptedPrivacy === true };
}
const personalEmailDomains = new Set(['gmail.com','googlemail.com','hotmail.com','outlook.com','live.com','yahoo.com','yahoo.com.au','icloud.com','aol.com','proton.me','protonmail.com']);
function validCorporateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !personalEmailDomains.has(email.split('@')[1]);
}
function validAcn(acn: string) {
  return /^\d{9}$/.test(acn) && (10 - [...acn.slice(0, 8)].reduce((sum, n, i) => sum + Number(n) * (8 - i), 0) % 10) % 10 === Number(acn[8]);
}
export function validateCreditexSubmission(application: CreditexApplication, now = new Date()) {
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
  if (!application.acceptedPrivacy) missing.push('consent to Creditex review of onboarding information');
  if (missing.length) throw new CreditexComplianceError('ONBOARDING_INCOMPLETE', `Complete: ${missing.join('; ')}.`, 400);
}

export async function getCreditexBusinessRow(db: D1Database, ownerUid: string) {
  return db.prepare('SELECT * FROM creditex_business_onboarding WHERE owner_uid = ?').bind(ownerUid).first<CreditexBusinessRow>();
}
export async function getCreditexBusinessStatus(db: D1Database, ownerUid: string) {
  const row = await getCreditexBusinessRow(db, ownerUid);
  const currentInsurance = Boolean(row && isValidDate(row.insurance_expires_on) && row.insurance_expires_on >= new Date().toISOString().slice(0, 10));
  const approved = Boolean(await db.prepare(`SELECT 1 AS approved WHERE ${businessApprovalSql('?')}`).bind(ownerUid).first());
  const blockedReasons: string[] = [];
  if (row?.status !== 'approved') blockedReasons.push('Creditex must approve the business onboarding and signed partnership agreement.');
  if (row?.status === 'approved' && !currentInsurance) blockedReasons.push('The business insurance has expired and must be reviewed by Creditex.');
  if (row?.status === 'approved' && (!row.agreement_reference || !row.reviewed_by_uid)) blockedReasons.push('Creditex agreement approval evidence is missing.');
  if (row?.status === 'approved' && !approved && !blockedReasons.length) blockedReasons.push('The business identity changed after Creditex review. Save and resubmit onboarding.');
  return { status: row?.status || 'not_started', revision: row?.revision || 0, insuranceExpiresOn: row?.insurance_expires_on || '', approved, blockedReasons };
}
export function businessApprovalSql(ownerUidSql: string) {
  return `EXISTS (SELECT 1 FROM creditex_business_onboarding cbo JOIN trade_accounts cba ON cba.firebase_uid=cbo.owner_uid AND cba.abn=cbo.business_abn AND cba.business_name=cbo.business_name WHERE cbo.owner_uid = ${ownerUidSql} AND cbo.status = 'approved' AND cbo.business_abn<>'' AND cbo.agreement_reference <> '' AND cbo.reviewed_by_uid <> '' AND date(cbo.insurance_expires_on) >= date('now'))`;
}
export function creditexWriteGuard(db: D1Database, ownerUid: string, predicate: string, bindings: (string | number)[] = []) {
  return db.prepare(`INSERT INTO trade_crm_write_guards (id,firebase_uid,operation_id,step_number,verified,created_at) VALUES (?,?,?,1,CASE WHEN (${predicate}) THEN 1 ELSE 0 END,?)`).bind(crypto.randomUUID(), ownerUid, `creditex-compliance:${crypto.randomUUID()}`, ...bindings, new Date().toISOString());
}
export function onboardingAuditStatement(db: D1Database, ownerUid: string, actorUid: string, eventType: string, revision: number, metadata: Record<string, unknown> = {}) {
  return db.prepare('INSERT INTO creditex_onboarding_events (id,owner_uid,actor_uid,event_type,revision,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(), ownerUid, actorUid, eventType, revision, JSON.stringify(metadata), new Date().toISOString());
}
export async function validateOnboardingDocumentReferences(db: D1Database, ownerUid: string, application: CreditexApplication) {
  const refs: [string, string][] = [[application.insuranceDocumentId, 'insurance'],[application.priorProposalDocumentId,'prior_proposal'],[application.contractorLicenceDocumentId,'contractor_licence'],[application.director.idDocumentId,'director_id'],[application.director.selfieDocumentId,'director_selfie'],[application.guarantor.idDocumentId,'guarantor_id'],[application.guarantor.selfieDocumentId,'guarantor_selfie']];
  for (const [id, kind] of refs.filter(([id]) => id)) {
    if (!await db.prepare('SELECT id FROM creditex_onboarding_documents WHERE id = ? AND owner_uid = ? AND kind = ?').bind(id, ownerUid, kind).first()) throw new CreditexComplianceError('DOCUMENT_INVALID', 'An onboarding document is missing or does not belong to this business and document type.', 400);
  }
}
export async function saveCreditexApplication(db: D1Database, ownerUid: string, actorUid: string, expectedRevision: number, value: unknown) {
  const application = normaliseCreditexApplication(value);
  await validateOnboardingDocumentReferences(db, ownerUid, application);
  const current = await getCreditexBusinessRow(db, ownerUid);
  const account = await db.prepare('SELECT abn,business_name FROM trade_accounts WHERE firebase_uid=?').bind(ownerUid).first<{ abn: string; business_name: string }>();
  if (!account) throw new CreditexComplianceError('BUSINESS_ACCOUNT_REQUIRED', 'Create the business account before onboarding.', 409);
  if ((current?.revision || 0) !== expectedRevision) throw new CreditexComplianceError('REVISION_CONFLICT', 'The application changed. Refresh before saving.', 409);
  const now = new Date().toISOString(); const revision = expectedRevision + 1;
  const guard = creditexWriteGuard(db, ownerUid, 'COALESCE((SELECT revision FROM creditex_business_onboarding WHERE owner_uid = ?),0) = ?', [ownerUid, expectedRevision]);
  const statement = current ? db.prepare(`UPDATE creditex_business_onboarding SET status='draft',business_abn=?,business_name=?,revision=?,application_json=?,insurance_expires_on=?,agreement_reference='',review_note='',reviewed_by_uid='',reviewed_at='',updated_at=? WHERE owner_uid=? AND revision=?`).bind(account.abn, account.business_name, revision, JSON.stringify(application), application.insuranceExpiresOn, now, ownerUid, expectedRevision)
    : db.prepare(`INSERT INTO creditex_business_onboarding(owner_uid,business_abn,business_name,status,revision,application_json,insurance_expires_on,updated_at) VALUES (?,?,?,'draft',?,?,?,?)`).bind(ownerUid, account.abn, account.business_name, revision, JSON.stringify(application), application.insuranceExpiresOn, now);
  await db.batch([guard, statement, onboardingAuditStatement(db, ownerUid, actorUid, 'application_saved_approval_invalidated', revision, { application, businessAbn: account.abn, businessName: account.business_name })]);
  return getCreditexBusinessStatus(db, ownerUid);
}
export async function submitCreditexApplication(db: D1Database, ownerUid: string, actorUid: string, expectedRevision: number) {
  const row = await getCreditexBusinessRow(db, ownerUid);
  if (!row || row.revision !== expectedRevision || !['draft', 'rejected'].includes(row.status)) throw new CreditexComplianceError('REVISION_CONFLICT', 'Save a current draft before submitting.', 409);
  const application = normaliseCreditexApplication(JSON.parse(row.application_json)); validateCreditexSubmission(application);
  await validateOnboardingDocumentReferences(db, ownerUid, application);
  await db.batch([creditexWriteGuard(db, ownerUid, `EXISTS(SELECT 1 FROM creditex_business_onboarding WHERE owner_uid=? AND revision=? AND status IN ('draft','rejected'))`, [ownerUid, expectedRevision]),
    db.prepare(`UPDATE creditex_business_onboarding SET status='submitted',revision=revision+1,updated_at=? WHERE owner_uid=?`).bind(new Date().toISOString(), ownerUid),
    onboardingAuditStatement(db, ownerUid, actorUid, 'application_submitted', expectedRevision + 1)]);
  return getCreditexBusinessStatus(db, ownerUid);
}
export async function reviewCreditexApplication(db: D1Database, ownerUid: string, reviewerUid: string, body: Record<string, unknown>) {
  const expectedRevision = revisionInput(body.expectedRevision); const status = textField(body.status, 30); const note = textField(body.reviewNote, 2000); const agreement = textField(body.agreementReference, 300);
  if (!['agreement_pending','approved','rejected','suspended'].includes(status) || !note) throw new CreditexComplianceError('REVIEW_INVALID', 'Choose a review decision and provide a review note.', 400);
  const row = await getCreditexBusinessRow(db, ownerUid);
  if (!row || row.revision !== expectedRevision || row.status === 'draft') throw new CreditexComplianceError('REVISION_CONFLICT', 'The business must submit this revision before review.', 409);
  if (status === 'approved') {
    if (!agreement) throw new CreditexComplianceError('SIGNED_AGREEMENT_REQUIRED', 'Record the executed partnership agreement reference before approving.', 400);
    const application = normaliseCreditexApplication(JSON.parse(row.application_json)); validateCreditexSubmission(application); await validateOnboardingDocumentReferences(db, ownerUid, application);
  }
  const now = new Date().toISOString();
  await db.batch([creditexWriteGuard(db, ownerUid, `EXISTS(SELECT 1 FROM creditex_business_onboarding cbo JOIN trade_accounts cba ON cba.firebase_uid=cbo.owner_uid AND cba.abn=cbo.business_abn AND cba.business_name=cbo.business_name WHERE cbo.owner_uid=? AND cbo.revision=? AND cbo.status <> 'draft')`, [ownerUid, expectedRevision]),
    db.prepare('UPDATE creditex_business_onboarding SET status=?,revision=revision+1,agreement_reference=?,review_note=?,reviewed_by_uid=?,reviewed_at=?,updated_at=? WHERE owner_uid=?').bind(status, agreement, note, reviewerUid, now, now, ownerUid),
    onboardingAuditStatement(db, ownerUid, reviewerUid, `business_${status}`, expectedRevision + 1, { agreementReference: agreement, reviewNote: note })]);
  return getCreditexBusinessStatus(db, ownerUid);
}
