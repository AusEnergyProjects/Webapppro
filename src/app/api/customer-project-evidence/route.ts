import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  getCustomerProjectEvidenceBucket as getEvidenceBucket,
} from "@/lib/customer-project-evidence-bucket";
import {
  CUSTOMER_EVIDENCE_ALLOWED_TYPES as ALLOWED_TYPES,
  CUSTOMER_EVIDENCE_CATEGORIES as CATEGORIES,
  CUSTOMER_EVIDENCE_MAX_FILE_BYTES as MAX_FILE_BYTES,
  CUSTOMER_EVIDENCE_MAX_PROJECT_FILES as MAX_PROJECT_FILES,
  CUSTOMER_EVIDENCE_QUOTING_PHOTO_CATEGORIES as QUOTING_PHOTO_CATEGORIES,
  CUSTOMER_EVIDENCE_SHARING_SCOPES as SHARING_SCOPES,
  cleanCustomerEvidenceClientUploadId,
  cleanCustomerEvidenceId,
  customerEvidencePrivacyStatus,
  normaliseCustomerEvidenceCaptureSlot,
  normaliseCustomerEvidenceFactKeys as normaliseFactKeys,
  privateCustomerEvidenceName,
  publicCustomerEvidence as publicRecord,
  type CustomerEvidenceRecord as EvidenceRecord,
} from "@/lib/customer-project-evidence";
import { hasAllowedSignature, sanitiseQuotingPhoto } from "@/lib/private-image-evidence";
import { verifiedTradeAccountPredicate } from "@/lib/trade-access-server";
import {
  CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
} from "@/lib/customer-projects.mjs";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").trim().slice(0, 180) || "project-evidence";
}

function exactArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function identity(request: Request) {
  try { return await requireFirebaseIdentity(request); }
  catch { return null; }
}

async function ownedProject(customerUid: string, projectId: string) {
  return getD1().prepare(`SELECT id, status FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
    .bind(projectId, customerUid).first<{ id: string; status: string }>();
}

function evidenceRevisionConflict(record: EvidenceRecord) {
  return json({
    ok: false,
    code: "EVIDENCE_REVISION_CONFLICT",
    error: "This saved file changed in another tab. Review it before trying again.",
    evidence: publicRecord(record),
  }, 409);
}

async function installerCanAccess(installerUid: string, record: EvidenceRecord) {
  if (record.sharing_scope !== "allocated-installers") return false;
  const access = await getD1().prepare(`SELECT m.id
    FROM customer_projects p
    JOIN trade_opportunity_matches m ON m.opportunity_id = p.opportunity_id
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid
    WHERE p.id = ? AND p.firebase_uid = ? AND m.firebase_uid = ?
      AND m.status IN ('offered', 'viewed', 'interested', 'connected')
      AND o.status IN ('open', 'paused') AND a.partner_type = 'installer'
      AND EXISTS (
        SELECT 1 FROM customer_consent_receipts consent
        WHERE consent.project_id = p.id AND consent.firebase_uid = p.firebase_uid
          AND consent.purpose = 'installer_evidence_sharing' AND consent.withdrawn_at = ''
      )
      AND ${verifiedTradeAccountPredicate("a")} LIMIT 1`)
    .bind(record.project_id, record.customer_uid, installerUid).first();
  return Boolean(access);
}

function installerDownloadName(record: EvidenceRecord) {
  if (!QUOTING_PHOTO_CATEGORIES.has(record.category)) return `customer-project-document.${record.content_type === "application/pdf" ? "pdf" : "bin"}`;
  const extension = record.content_type === "image/png" ? "png"
    : record.content_type === "image/webp" ? "webp"
      : record.content_type === "image/heic" ? "heic"
        : record.content_type === "image/heif" ? "heif" : "jpg";
  return `customer-quoting-photo.${extension}`;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const url = new URL(request.url);
  const previewId = cleanCustomerEvidenceId(url.searchParams.get("preview"));
  if (previewId) {
    const record = await getD1().prepare(`SELECT *
      FROM customer_project_evidence
      WHERE id = ? AND customer_uid = ? AND status = 'active'`)
      .bind(previewId, user.uid)
      .first<EvidenceRecord>();
    if (!record || !record.content_type.startsWith("image/")) {
      return json({ ok: false, error: "Saved photo not found." }, 404);
    }
    const object = await getEvidenceBucket().get(record.object_key);
    if (!object) {
      return json({ ok: false, error: "Stored photo not found." }, 404);
    }
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="${safeFileName(record.file_name)}"`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": object.httpMetadata?.contentType || record.content_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const downloadId = cleanCustomerEvidenceId(url.searchParams.get("download"));
  if (downloadId) {
    const record = await getD1().prepare(`SELECT * FROM customer_project_evidence WHERE id = ? AND status = 'active'`)
      .bind(downloadId).first<EvidenceRecord>();
    if (!record) return json({ ok: false, error: "Project evidence not found." }, 404);
    const ownerAccess = record.customer_uid === user.uid;
    const installerAccess = !ownerAccess && await installerCanAccess(user.uid, record);
    if (!ownerAccess && !installerAccess) return json({ ok: false, error: "Project evidence access was not accepted." }, 403);
    const object = await getEvidenceBucket().get(record.object_key);
    if (!object) return json({ ok: false, error: "Stored project evidence was not found." }, 404);
    if (installerAccess) {
      await getD1().prepare(`INSERT INTO customer_project_evidence_events
        (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
        VALUES (?, ?, ?, ?, ?, 'installer', ?, 'viewed', ?)`)
        .bind(crypto.randomUUID(), record.id, record.project_id, record.customer_uid, user.uid, user.uid, new Date().toISOString()).run();
    }
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${ownerAccess ? safeFileName(record.file_name) : installerDownloadName(record)}"`,
        "Content-Type": object.httpMetadata?.contentType || record.content_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const projectId = cleanCustomerEvidenceId(url.searchParams.get("projectId"));
  if (!projectId || !await ownedProject(user.uid, projectId)) return json({ ok: false, error: "Project not found." }, 404);
  const rows = await getD1().prepare(`SELECT * FROM customer_project_evidence
    WHERE project_id = ? AND customer_uid = ? AND status = 'active' ORDER BY created_at DESC`)
    .bind(projectId, user.uid).all<EvidenceRecord>();
  return json({ ok: true, evidence: rows.results.map(publicRecord) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  let form: FormData;
  try { form = await request.formData(); }
  catch { return json({ ok: false, error: "The project upload could not be read." }, 400); }
  const projectId = cleanCustomerEvidenceId(form.get("projectId"));
  const category = String(form.get("category") || "").trim();
  const captureSlot = normaliseCustomerEvidenceCaptureSlot(form.get("captureSlot"));
  const clientUploadId = cleanCustomerEvidenceClientUploadId(
    form.get("clientUploadId"),
  );
  const factKeys = normaliseFactKeys(form.get("factKeys"));
  const sharingScope = String(form.get("sharingScope") || "private-plan").trim();
  const confirmInstallerPhotoSharing = form.get("confirmInstallerPhotoSharing") === "true";
  const file = form.get("file");
  const project = await ownedProject(user.uid, projectId);
  if (!project || !["draft", "matching", "quote_review"].includes(project.status)) {
    return json({ ok: false, error: "Evidence can be added only to an active customer project." }, 409);
  }
  const account = await getD1().prepare(`SELECT firebase_uid FROM customer_accounts
    WHERE firebase_uid = ? AND account_status = 'active'`).bind(user.uid).first();
  if (!account) return json({ ok: false, error: "Complete your active customer account first." }, 403);
  if (!(file instanceof File) || !file.name) return json({ ok: false, error: "Choose a photo or document to upload." }, 400);
  if (!clientUploadId) return json({ ok: false, error: "The upload reference was missing. Choose the file again." }, 400);
  if (!SHARING_SCOPES.has(sharingScope)) return json({ ok: false, error: "Choose a valid evidence sharing setting." }, 400);
  if (sharingScope === "allocated-installers" && !confirmInstallerPhotoSharing) {
    return json({ ok: false, error: "Confirm that this file can be shared with the verified installers allocated to this enquiry." }, 400);
  }
  if (!CATEGORIES.has(category)) return json({ ok: false, error: "Choose a valid property evidence category." }, 400);
  if (QUOTING_PHOTO_CATEGORIES.has(category) && !captureSlot) {
    return json({
      ok: false,
      error: "Choose the guided photo prompt this image answers.",
    }, 400);
  }
  if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "Upload a PDF, JPEG, PNG or WebP file. Unsupported phone photos must be converted to JPEG first." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return json({ ok: false, error: "Each file must be no larger than 8 MB." }, 400);
  const existing = await getD1().prepare(`SELECT * FROM customer_project_evidence
    WHERE project_id = ? AND customer_uid = ? AND client_upload_id = ? AND status = 'active'`)
    .bind(projectId, user.uid, clientUploadId).first<EvidenceRecord>();
  if (existing) {
    if (
      existing.category !== category
      || (existing.capture_slot || "") !== captureSlot
      || existing.content_type !== file.type
      || Number(existing.size_bytes) !== file.size
    ) {
      return json({
        ok: false,
        code: "IDEMPOTENCY_MISMATCH",
        error: "This upload reference was already used for a different file.",
      }, 409);
    }
    return json({ ok: true, duplicate: true, evidence: publicRecord(existing) });
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasAllowedSignature(fileBytes, file.type)) return json({ ok: false, error: "The file contents do not match the selected photo or document type." }, 400);
  const storedBytes = file.type.startsWith("image/")
    ? sanitiseQuotingPhoto(fileBytes, file.type)
    : fileBytes;
  if (!storedBytes) {
    return json({
      ok: false,
      error: "This photo could not be safely stored. Convert it to JPEG and try again.",
    }, 400);
  }

  const id = crypto.randomUUID();
  const objectKey = `customer-projects/${user.uid}/${projectId}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const fileName = privateCustomerEvidenceName(category, file.type, id);
  const privacyStatus = customerEvidencePrivacyStatus(file.type);
  const bucket = getEvidenceBucket();
  await bucket.put(objectKey, exactArrayBuffer(storedBytes), {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      customerUid: user.uid,
      projectId,
      evidenceId: id,
      sharingScope,
      privacyStatus,
    },
  });
  try {
    const statements = [
      getD1().prepare(`INSERT INTO customer_project_evidence
        (id, project_id, customer_uid, client_upload_id, category,
         capture_slot, fact_keys, sharing_scope, file_name, content_type,
         size_bytes, object_key, privacy_status, revision, status,
         created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?
        WHERE (
          (SELECT COUNT(*) FROM customer_project_evidence
            WHERE project_id = ? AND customer_uid = ? AND status = 'active')
          +
          (SELECT COUNT(*) FROM customer_project_evidence_upload_sessions
            WHERE project_id = ? AND customer_uid = ?
              AND replacement_evidence_id = ''
              AND status IN ('initiated', 'uploading', 'completing'))
        ) < ?`)
        .bind(
          id,
          projectId,
          user.uid,
          clientUploadId,
          category,
          captureSlot,
          JSON.stringify(factKeys),
          sharingScope,
          fileName,
          file.type,
          storedBytes.byteLength,
          objectKey,
          privacyStatus,
          now,
          now,
          projectId,
          user.uid,
          projectId,
          user.uid,
          MAX_PROJECT_FILES,
        ),
      getD1().prepare(`INSERT INTO customer_project_evidence_events
        (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
        SELECT ?, id, project_id, customer_uid, '', 'customer', ?,
          'uploaded', ?
        FROM customer_project_evidence
        WHERE id = ? AND project_id = ? AND customer_uid = ?
          AND status = 'active' AND revision = 1 AND object_key = ?`)
        .bind(
          crypto.randomUUID(),
          user.uid,
          now,
          id,
          projectId,
          user.uid,
          objectKey,
        ),
      getD1().prepare(`UPDATE customer_projects SET updated_at = ?
        WHERE id = ? AND firebase_uid = ?
          AND EXISTS (
            SELECT 1 FROM customer_project_evidence
            WHERE id = ? AND project_id = ? AND customer_uid = ?
              AND status = 'active' AND revision = 1 AND object_key = ?
          )`)
        .bind(now, projectId, user.uid, id, projectId, user.uid, objectKey),
    ];
    if (sharingScope === "allocated-installers") {
      statements.push(getD1().prepare(`INSERT INTO customer_consent_receipts
        (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
        SELECT ?, ?, ?, 'installer_evidence_sharing', ?, ?, '', ?
        FROM customer_project_evidence
        WHERE id = ? AND project_id = ? AND customer_uid = ?
          AND status = 'active' AND revision = 1 AND object_key = ?
        ON CONFLICT(id) DO UPDATE SET notice_version = excluded.notice_version,
          granted_at = excluded.granted_at, withdrawn_at = ''`)
        .bind(
          `customer-evidence-share:${projectId}`,
          user.uid,
          projectId,
          CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
          now,
          now,
          id,
          projectId,
          user.uid,
          objectKey,
        ));
    }
    const results = await getD1().batch(statements);
    if (Number(results[0]?.meta.changes || 0) !== 1) {
      await bucket.delete(objectKey);
      return json({
        ok: false,
        code: "PROJECT_EVIDENCE_LIMIT",
        error: "This project already has its maximum of 12 evidence files.",
      }, 409);
    }
  } catch (error) {
    const committed = await getD1().prepare(`SELECT *
      FROM customer_project_evidence
      WHERE project_id = ? AND customer_uid = ? AND client_upload_id = ?
        AND status = 'active'`)
      .bind(projectId, user.uid, clientUploadId)
      .first<EvidenceRecord>();
    if (committed?.object_key === objectKey) {
      return json({
        ok: true,
        duplicate: true,
        evidence: publicRecord(committed),
      });
    }
    await bucket.delete(objectKey);
    if (committed) {
      return json({
        ok: false,
        code: "IDEMPOTENCY_MISMATCH",
        error: "This upload reference was already used for a different file.",
      }, 409);
    }
    throw error;
  }
  return json({
    ok: true,
    evidence: publicRecord({
      id,
      project_id: projectId,
      customer_uid: user.uid,
      client_upload_id: clientUploadId,
      category,
      capture_slot: captureSlot,
      fact_keys: JSON.stringify(factKeys),
      sharing_scope: sharingScope,
      file_name: fileName,
      content_type: file.type,
      size_bytes: storedBytes.byteLength,
      object_key: objectKey,
      privacy_status: privacyStatus,
      revision: 1,
      status: "active",
      created_at: now,
      updated_at: now,
    }),
  }, 201);
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  if (Number(request.headers.get("content-length") || 0) > 4_000) {
    return json({ ok: false, error: "The evidence update was too large." }, 413);
  }
  let raw: Record<string, unknown>;
  try { raw = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: "The evidence update could not be read." }, 400); }
  const id = cleanCustomerEvidenceId(raw.id);
  const sharingScope = String(raw.sharingScope || "").trim();
  const factKeys = normaliseFactKeys(raw.factKeys);
  const expectedRevision = Number(raw.expectedRevision);
  const record = await getD1().prepare(`SELECT * FROM customer_project_evidence
    WHERE id = ? AND customer_uid = ? AND status = 'active'`)
    .bind(id, user.uid).first<EvidenceRecord>();
  if (!record) return json({ ok: false, error: "Project evidence not found." }, 404);
  if (
    !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 1
    || expectedRevision !== Number(record.revision || 1)
  ) {
    return evidenceRevisionConflict(record);
  }
  if (!SHARING_SCOPES.has(sharingScope)) return json({ ok: false, error: "Choose a valid evidence sharing setting." }, 400);
  const grantingInstallerAccess = (
    record.sharing_scope !== "allocated-installers"
    && sharingScope === "allocated-installers"
  );
  if (grantingInstallerAccess && raw.confirmInstallerPhotoSharing !== true) {
    return json({ ok: false, error: "Confirm that this file can be shared with allocated verified installers." }, 400);
  }
  const now = new Date().toISOString();
  const nextRevision = expectedRevision + 1;
  const statements = [
    getD1().prepare(`UPDATE customer_project_evidence
      SET fact_keys = ?, sharing_scope = ?, revision = ?, updated_at = ?
      WHERE id = ? AND customer_uid = ? AND status = 'active'
        AND revision = ? AND object_key = ?`)
      .bind(
        JSON.stringify(factKeys),
        sharingScope,
        nextRevision,
        now,
        id,
        user.uid,
        expectedRevision,
        record.object_key,
      ),
    getD1().prepare(`INSERT INTO customer_project_evidence_events
      (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
      SELECT ?, id, project_id, customer_uid, '', 'customer', ?,
        'metadata_updated', ?
      FROM customer_project_evidence
      WHERE id = ? AND project_id = ? AND customer_uid = ?
        AND status = 'active' AND revision = ? AND object_key = ?`)
      .bind(
        crypto.randomUUID(),
        user.uid,
        now,
        id,
        record.project_id,
        user.uid,
        nextRevision,
        record.object_key,
      ),
  ];
  if (grantingInstallerAccess) {
    statements.push(getD1().prepare(`INSERT INTO customer_consent_receipts
      (id, firebase_uid, project_id, purpose, notice_version, granted_at, withdrawn_at, created_at)
      SELECT ?, ?, ?, 'installer_evidence_sharing', ?, ?, '', ?
      FROM customer_project_evidence
      WHERE id = ? AND project_id = ? AND customer_uid = ?
        AND status = 'active' AND revision = ? AND object_key = ?
      ON CONFLICT(id) DO UPDATE SET notice_version = excluded.notice_version,
        granted_at = excluded.granted_at, withdrawn_at = ''`)
      .bind(
        `customer-evidence-share:${record.project_id}`,
        user.uid,
        record.project_id,
        CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
        now,
        now,
        id,
        record.project_id,
        user.uid,
        nextRevision,
        record.object_key,
      ));
  }
  const results = await getD1().batch(statements);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    const latest = await getD1().prepare(`SELECT *
      FROM customer_project_evidence
      WHERE id = ? AND customer_uid = ? AND status = 'active'`)
      .bind(id, user.uid)
      .first<EvidenceRecord>();
    return latest
      ? evidenceRevisionConflict(latest)
      : json({ ok: false, error: "Project evidence not found." }, 404);
  }
  return json({
    ok: true,
    evidence: publicRecord({
      ...record,
      fact_keys: JSON.stringify(factKeys),
      sharing_scope: sharingScope,
      revision: nextRevision,
      updated_at: now,
    }),
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const url = new URL(request.url);
  const id = cleanCustomerEvidenceId(url.searchParams.get("id"));
  const expectedRevision = Number(url.searchParams.get("expectedRevision"));
  const record = await getD1().prepare(`SELECT * FROM customer_project_evidence
    WHERE id = ? AND customer_uid = ?`).bind(id, user.uid).first<EvidenceRecord>();
  if (!record) return json({ ok: false, error: "Project evidence not found." }, 404);
  if (record.status === "deleted") {
    return json({
      ok: true,
      deleted: true,
      id: record.id,
      revision: Number(record.revision || 1),
    });
  }
  if (
    !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 1
    || !["active", "deleting"].includes(record.status)
    || (
      record.status === "active"
        ? Number(record.revision || 1) !== expectedRevision
        : Number(record.revision || 1) !== expectedRevision + 1
    )
  ) {
    return evidenceRevisionConflict(record);
  }
  const finalisingUpload = await getD1().prepare(`SELECT id
    FROM customer_project_evidence_upload_sessions
    WHERE customer_uid = ? AND evidence_id = ? AND status = 'finalising'
    LIMIT 1`)
    .bind(user.uid, id)
    .first();
  if (finalisingUpload) {
    return json({
      ok: false,
      code: "EVIDENCE_FINALISING",
      error: "This saved file is still finishing securely. Try removing it again shortly.",
    }, 409);
  }
  const now = new Date().toISOString();
  const deletingRevision = expectedRevision + 1;
  if (record.status === "active") {
    const locked = await getD1().prepare(`UPDATE customer_project_evidence
      SET status = 'deleting', revision = ?, updated_at = ?
      WHERE id = ? AND customer_uid = ? AND status = 'active'
        AND revision = ? AND object_key = ?`)
      .bind(
        deletingRevision,
        now,
        id,
        user.uid,
        expectedRevision,
        record.object_key,
      )
      .run();
    if (Number(locked.meta.changes || 0) !== 1) {
      const latest = await getD1().prepare(`SELECT *
        FROM customer_project_evidence WHERE id = ? AND customer_uid = ?`)
        .bind(id, user.uid)
        .first<EvidenceRecord>();
      return latest
        ? evidenceRevisionConflict(latest)
        : json({ ok: false, error: "Project evidence not found." }, 404);
    }
  }
  try {
    await getEvidenceBucket().delete(record.object_key);
  } catch {
    return json({
      ok: false,
      code: "EVIDENCE_DELETE_RETRY",
      error: "The saved file could not be removed yet. Try again.",
    }, 503);
  }
  const results = await getD1().batch([
    getD1().prepare(`UPDATE customer_project_evidence
      SET status = 'deleted', updated_at = ?
      WHERE id = ? AND customer_uid = ? AND status = 'deleting'
        AND revision = ? AND object_key = ?`)
      .bind(now, id, user.uid, deletingRevision, record.object_key),
    getD1().prepare(`INSERT INTO customer_project_evidence_events
      (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
      SELECT ?, id, project_id, customer_uid, '', 'customer', ?,
        'deleted', ?
      FROM customer_project_evidence
      WHERE id = ? AND project_id = ? AND customer_uid = ?
        AND status = 'deleted' AND revision = ? AND object_key = ?`)
      .bind(
        crypto.randomUUID(),
        user.uid,
        now,
        id,
        record.project_id,
        user.uid,
        deletingRevision,
        record.object_key,
      ),
  ]);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    const latest = await getD1().prepare(`SELECT *
      FROM customer_project_evidence WHERE id = ? AND customer_uid = ?`)
      .bind(id, user.uid)
      .first<EvidenceRecord>();
    if (latest?.status === "deleted") {
      return json({
        ok: true,
        deleted: true,
        id,
        revision: Number(latest.revision || deletingRevision),
      });
    }
    return latest
      ? evidenceRevisionConflict(latest)
      : json({ ok: false, error: "Project evidence not found." }, 404);
  }
  return json({ ok: true, deleted: true, id, revision: deletingRevision });
}
