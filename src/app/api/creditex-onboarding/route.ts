import { env } from 'cloudflare:workers';
import { getD1 } from '../../../../db';
import { sameOrigin } from '@/lib/admin-server';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { creditexApiError, creditexJson, requireCreditexOnboardingAccess, requireCreditexTrainingReviewer } from '@/lib/creditex-onboarding-api';
import { CreditexComplianceError, creditexWriteGuard, getCreditexBusinessRow, getCreditexBusinessStatus, onboardingAuditStatement, record, revisionInput, saveCreditexApplication, submitCreditexApplication, textField } from '@/lib/creditex-onboarding-server';
import { inspectTeamMemberFile, safeTeamMemberFileName } from '@/lib/trade-team-member-files-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
type DocumentRow = { id: string; owner_uid: string; kind: string; file_name: string; content_type: string; object_key: string; created_at: string };
type PrivateBucket = { put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>; get(key: string): Promise<{ body: BodyInit } | null>; delete(key: string): Promise<void> };
function bucket() {
  const value = (env as unknown as { EVIDENCE?: PrivateBucket }).EVIDENCE;
  if (!value) throw new CreditexComplianceError('PRIVATE_STORAGE_UNAVAILABLE', 'Private onboarding file storage is unavailable.', 503);
  return value;
}
async function owner(request: Request) {
  const access = await requireCreditexOnboardingAccess(request);
  if (!access.isOwner) throw new CreditexComplianceError('BUSINESS_OWNER_REQUIRED', 'Only the business owner can access company onboarding information.');
  return access;
}
export async function GET(request: Request) {
  try {
    const db = getD1(); const url = new URL(request.url); const documentId = url.searchParams.get('documentId');
    const trainingDocumentId = url.searchParams.get('trainingDocumentId');
    if (trainingDocumentId) {
      await requireCreditexTrainingReviewer(request);
      const document = await db.prepare(`SELECT f.id,f.owner_uid,f.file_name,f.content_type,f.object_key,f.created_at,f.category AS kind FROM trade_team_member_files f JOIN trade_accounts a ON a.firebase_uid=f.owner_uid WHERE f.id=? AND f.owner_uid=? AND f.status='active' AND f.category IN ('training','compliance','licence') AND EXISTS(SELECT 1 FROM json_each(a.capabilities) WHERE value='insulation')`).bind(trainingDocumentId, url.searchParams.get('ownerUid') || '').first<DocumentRow>();
      if (!document) throw new CreditexComplianceError('DOCUMENT_NOT_FOUND', 'Private qualification evidence not found.', 404);
      const object = await bucket().get(document.object_key);
      if (!object) throw new CreditexComplianceError('DOCUMENT_UNAVAILABLE', 'The private document is unavailable.', 404);
      return new Response(object.body, { headers: { 'Content-Type': document.content_type, 'Content-Disposition': `attachment; filename="${safeTeamMemberFileName(document.file_name)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }
    if (documentId) {
      let ownerUid: string; const requestedOwner = url.searchParams.get('ownerUid');
      if (requestedOwner) { await requireCreditexTrainingReviewer(request); ownerUid = requestedOwner; }
      else ownerUid = (await owner(request)).ownerUid;
      const document = await db.prepare('SELECT * FROM creditex_onboarding_documents WHERE id=? AND owner_uid=?').bind(documentId, ownerUid).first<DocumentRow>();
      if (!document) throw new CreditexComplianceError('DOCUMENT_NOT_FOUND', 'Private onboarding document not found.', 404);
      const object = await bucket().get(document.object_key);
      if (!object) throw new CreditexComplianceError('DOCUMENT_UNAVAILABLE', 'The private document is unavailable.', 404);
      return new Response(object.body, { headers: { 'Content-Type': document.content_type, 'Content-Disposition': `attachment; filename="${safeTeamMemberFileName(document.file_name)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }
    const access = await requireCreditexOnboardingAccess(request); const business = await getCreditexBusinessStatus(db, access.ownerUid);
    if (!access.isOwner) return creditexJson({ ok: true, actor: access, business });
    const row = await getCreditexBusinessRow(db, access.ownerUid);
    const documents = await db.prepare('SELECT id,kind,file_name AS fileName,created_at AS createdAt FROM creditex_onboarding_documents WHERE owner_uid=? ORDER BY created_at DESC').bind(access.ownerUid).all();
    return creditexJson({ ok: true, actor: access, business, application: row ? JSON.parse(row.application_json) : null, documents: documents.results });
  } catch (error) { return creditexApiError(error); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return creditexJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await owner(request); const body = record(await readBoundedJsonRequest(request));
    const business = await saveCreditexApplication(getD1(), access.ownerUid, access.actorUid, revisionInput(body.expectedRevision), body.application);
    return creditexJson({ ok: true, business });
  } catch (error) { return creditexApiError(error); }
}
async function boundedMultipart(request: Request) {
  const maximum = 13 * 1024 * 1024; const reader = request.body?.getReader();
  if (!reader) throw new CreditexComplianceError('FILE_REQUIRED', 'Choose a document.', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new CreditexComplianceError('FILE_SIZE_INVALID', 'The file must be no larger than 12 MB.', 413); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return creditexJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const access = await owner(request); const db = getD1();
    if ((request.headers.get('content-type') || '').startsWith('multipart/form-data')) {
      const data = await boundedMultipart(request); const kind = textField(data.get('kind'), 40); const file = data.get('file');
      if (data.get('action') !== 'upload' || !['insurance','contractor_licence','director_id','director_selfie','guarantor_id','guarantor_selfie','prior_proposal'].includes(kind) || !(file instanceof File)) throw new CreditexComplianceError('FILE_INVALID', 'Choose a valid onboarding document type and file.', 400);
      const checked = await inspectTeamMemberFile(file); const id = crypto.randomUUID(); const key = `creditex-onboarding/${access.ownerUid}/${id}`; const now = new Date().toISOString();
      const count = await db.prepare('SELECT COUNT(*) AS count FROM creditex_onboarding_documents WHERE owner_uid=?').bind(access.ownerUid).first<{ count: number }>();
      if ((count?.count || 0) >= 60) throw new CreditexComplianceError('DOCUMENT_LIMIT', 'Contact Creditex to review the retained documents before adding more.', 409);
      const storage = bucket(); await storage.put(key, checked.value, { httpMetadata: { contentType: checked.contentType } });
      try { await db.batch([creditexWriteGuard(db, access.ownerUid, '(SELECT COUNT(*) FROM creditex_onboarding_documents WHERE owner_uid=?)<60', [access.ownerUid]), db.prepare('INSERT INTO creditex_onboarding_documents(id,owner_uid,kind,file_name,content_type,size_bytes,sha256,object_key,uploaded_by_uid,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, access.ownerUid, kind, checked.fileName, checked.contentType, checked.sizeBytes, checked.sha256, key, access.actorUid, now), onboardingAuditStatement(db, access.ownerUid, access.actorUid, 'private_document_uploaded', 0, { documentId: id, kind, sha256: checked.sha256 })]); }
      catch (error) {
        // The batch may have committed even if its acknowledgement was lost.
        // Retain private evidence until a successful read proves it is unbound.
        let retained: { id: string } | null;
        try {
          retained = await db.prepare('SELECT id FROM creditex_onboarding_documents WHERE id=? AND owner_uid=? AND object_key=?')
            .bind(id, access.ownerUid, key).first<{ id: string }>();
        } catch { throw error; }
        if (!retained) await storage.delete(key);
        throw error;
      }
      return creditexJson({ ok: true, document: { id, kind, fileName: checked.fileName, createdAt: now } });
    }
    const body = record(await readBoundedJsonRequest(request));
    if (body.action !== 'submit') throw new CreditexComplianceError('ACTION_INVALID', 'Choose a supported onboarding action.', 400);
    return creditexJson({ ok: true, business: await submitCreditexApplication(db, access.ownerUid, access.actorUid, revisionInput(body.expectedRevision)) });
  } catch (error) { return creditexApiError(error); }
}
