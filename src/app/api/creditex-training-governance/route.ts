import { getD1 } from '../../../../db';
import { sameOrigin } from '@/lib/admin-server';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { creditexApiError, creditexJson, requireCreditexTrainingReviewer } from '@/lib/creditex-onboarding-api';
import { CreditexComplianceError, creditexWriteGuard, isValidDate, record, reviewCreditexApplication, textField, type CreditexBusinessRow } from '@/lib/creditex-onboarding-server';
import { listTrainingGovernanceModules, reviewTrainingModule, revokeTrainingCompletion, trainingAuditStatement } from '@/lib/trade-training-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await requireCreditexTrainingReviewer(request); const db = getD1();
    const rows = await db.prepare("SELECT cbo.*,account.business_name FROM creditex_business_onboarding cbo JOIN trade_accounts account ON account.firebase_uid=cbo.owner_uid WHERE cbo.status<>'draft' ORDER BY cbo.updated_at DESC LIMIT 100").all<CreditexBusinessRow>();
    const documentRows = rows.results.length ? await db.prepare(`SELECT owner_uid,id,kind,file_name AS fileName,created_at AS createdAt FROM creditex_onboarding_documents WHERE owner_uid IN (${rows.results.map(() => '?').join(',')}) ORDER BY created_at DESC`).bind(...rows.results.map(row => row.owner_uid)).all<{ owner_uid: string; id: string; kind: string; fileName: string; createdAt: string }>() : { results: [] };
    const applications = [];
    for (const row of rows.results) {
      const documents = documentRows.results.filter(document => document.owner_uid === row.owner_uid).map(({ id,kind,fileName,createdAt }) => ({ id,kind,fileName,createdAt }));
      applications.push({ ownerUid: row.owner_uid, businessName: row.business_name, status: row.status, revision: row.revision, application: JSON.parse(row.application_json), documents, agreementReference: row.agreement_reference, reviewNote: row.review_note, updatedAt: row.updated_at });
    }
    const completions = await db.prepare('SELECT c.id,c.owner_uid AS ownerUid,c.member_id AS memberId,m.display_name AS displayName,c.module_id AS moduleId,c.version,c.reference,c.passed_at AS passedAt,c.expires_at AS expiresAt,c.revoked_at AS revokedAt FROM trade_training_completions c LEFT JOIN trade_team_members m ON m.owner_uid=c.owner_uid AND m.id=c.member_id ORDER BY c.passed_at DESC LIMIT 200').all();
    const credentials = await db.prepare('SELECT id,owner_uid AS ownerUid,member_id AS memberId,module_id AS moduleId,document_id AS documentId,credential_reference AS credentialReference,scheme_participant_reference AS schemeParticipantReference,expires_on AS expiresOn,revoked_at AS revokedAt FROM trade_training_external_credentials ORDER BY created_at DESC LIMIT 200').all();
    const candidateRows = await db.prepare(`SELECT m.owner_uid,m.id,m.display_name,a.business_name,f.id AS file_id,f.title,f.file_name,f.expires_at
      FROM trade_team_members m JOIN trade_accounts a ON a.firebase_uid=m.owner_uid
      LEFT JOIN trade_team_member_files f ON f.owner_uid=m.owner_uid AND f.team_member_id=m.id AND f.status='active' AND f.category IN ('training','compliance','licence')
      WHERE m.status='active' AND EXISTS(SELECT 1 FROM json_each(a.capabilities) WHERE value='insulation')
      ORDER BY a.business_name,m.display_name,f.created_at DESC LIMIT 1000`).all<{ owner_uid: string; id: string; display_name: string; business_name: string; file_id: string | null; title: string; file_name: string; expires_at: string }>();
    const candidateMap = new Map<string, { ownerUid: string; businessName: string; memberId: string; displayName: string; files: {id: string; title: string; fileName: string; expiresAt: string}[] }>();
    for (const row of candidateRows.results) {
      const candidate = candidateMap.get(row.id) || { ownerUid: row.owner_uid, businessName: row.business_name, memberId: row.id, displayName: row.display_name, files: [] };
      if (row.file_id) candidate.files.push({ id: row.file_id, title: row.title, fileName: row.file_name, expiresAt: row.expires_at }); candidateMap.set(row.id, candidate);
    }
    return creditexJson({ ok: true, applications, modules: await listTrainingGovernanceModules(db), completions: completions.results, credentials: credentials.results, credentialCandidates: [...candidateMap.values()] });
  } catch (error) { return creditexApiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return creditexJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const reviewer = await requireCreditexTrainingReviewer(request); const db = getD1(); const body = record(await readBoundedJsonRequest(request));
    if (body.action === 'review_business') return creditexJson({ ok: true, business: await reviewCreditexApplication(db, textField(body.ownerUid, 160), reviewer.uid, body) });
    if (body.action === 'activate_module' || body.action === 'withdraw_module') { await reviewTrainingModule(db, reviewer.uid, body); return creditexJson({ ok: true }); }
    if (body.action === 'revoke_completion') { await revokeTrainingCompletion(db, reviewer.uid, textField(body.completionId, 80), textField(body.reviewNote, 2000)); return creditexJson({ ok: true }); }
    if (body.action === 'review_external_credential') {
      const ownerUid = textField(body.ownerUid, 160); const memberId = textField(body.memberId, 80); const moduleId = textField(body.moduleId, 80); const documentId = textField(body.documentId, 80); const credentialReference = textField(body.credentialReference, 500); const schemeParticipantReference = textField(body.schemeParticipantReference, 500); const expiresOn = textField(body.expiresOn, 10); const note = textField(body.reviewNote, 2000);
      if (moduleId !== 'veu-48' || !credentialReference || !schemeParticipantReference || !note || !isValidDate(expiresOn) || expiresOn < new Date().toISOString().slice(0, 10)) throw new CreditexComplianceError('EXTERNAL_CREDENTIAL_REVIEW_REQUIRED', 'Verify full EEC CII certification and ESC scheme participant registration, record both references, evidence, review note and current expiry.', 400);
      const predicate = `EXISTS(SELECT 1 FROM trade_team_member_files f JOIN trade_team_members m ON m.id=f.team_member_id AND m.owner_uid=f.owner_uid AND m.status='active' WHERE f.id=? AND f.owner_uid=? AND f.team_member_id=? AND f.status='active' AND f.category IN ('training','compliance','licence') AND (f.expires_at='' OR date(f.expires_at)>=date(?)))`;
      const values = [documentId, ownerUid, memberId, expiresOn];
      if (!await db.prepare(`SELECT 1 AS eligible WHERE ${predicate}`).bind(...values).first()) throw new CreditexComplianceError('CREDENTIAL_EVIDENCE_REQUIRED', 'Select a current private qualification evidence file belonging to this active team member.', 400);
      const now = new Date().toISOString();
      await db.batch([creditexWriteGuard(db, ownerUid, predicate, values),
        db.prepare("UPDATE trade_training_external_credentials SET revoked_at=? WHERE owner_uid=? AND member_id=? AND module_id=? AND revoked_at=''").bind(now, ownerUid, memberId, moduleId),
        db.prepare('INSERT INTO trade_training_external_credentials(id,owner_uid,member_id,module_id,document_id,credential_reference,scheme_participant_reference,expires_on,reviewed_by_uid,review_note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), ownerUid, memberId, moduleId, documentId, credentialReference, schemeParticipantReference, expiresOn, reviewer.uid, note, now),
        trainingAuditStatement(db, reviewer.uid, 'external_qualification_verified', { ownerUid, memberId, moduleId, metadata: { documentId, credentialReference, schemeParticipantReference, expiresOn, reviewNote: note } })]);
      return creditexJson({ ok: true });
    }
    if (body.action === 'revoke_external_credential') {
      const id = textField(body.credentialId, 80); const note = textField(body.reviewNote, 2000);
      if (!note) throw new CreditexComplianceError('REVIEW_NOTE_REQUIRED', 'Record a reason for revoking the external qualification.', 400);
      const row = await db.prepare('SELECT owner_uid,member_id,module_id FROM trade_training_external_credentials WHERE id=?').bind(id).first<{ owner_uid: string; member_id: string; module_id: string }>();
      if (!row) throw new CreditexComplianceError('CREDENTIAL_NOT_FOUND', 'External qualification record not found.', 404);
      await db.batch([db.prepare('UPDATE trade_training_external_credentials SET revoked_at=? WHERE id=?').bind(new Date().toISOString(), id), trainingAuditStatement(db, reviewer.uid, 'external_qualification_revoked', { ownerUid: row.owner_uid, memberId: row.member_id, moduleId: row.module_id, metadata: { credentialId: id, reviewNote: note } })]);
      return creditexJson({ ok: true });
    }
    throw new CreditexComplianceError('ACTION_INVALID', 'Choose a supported governance action.', 400);
  } catch (error) { return creditexApiError(error); }
}
