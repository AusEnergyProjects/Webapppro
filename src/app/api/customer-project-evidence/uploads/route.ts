import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  getCustomerProjectEvidenceBucket as getEvidenceBucket,
} from "@/lib/customer-project-evidence-bucket";
import {
  CUSTOMER_EVIDENCE_ALLOWED_TYPES,
  CUSTOMER_EVIDENCE_MAX_FILE_BYTES,
  CUSTOMER_EVIDENCE_MAX_PROJECT_FILES,
  CUSTOMER_EVIDENCE_PART_SIZE_BYTES,
  CUSTOMER_EVIDENCE_QUOTING_PHOTO_CATEGORIES,
  CUSTOMER_EVIDENCE_SESSION_HOURS,
  CUSTOMER_EVIDENCE_SESSION_RETENTION_DAYS,
  cleanCustomerEvidenceClientUploadId,
  cleanCustomerEvidenceId,
  customerEvidenceCategory,
  customerEvidencePrivacyStatus,
  customerEvidenceSharingScope,
  hashCustomerEvidenceUploadMetadata,
  normaliseCustomerEvidenceCaptureSlot,
  normaliseCustomerEvidenceFactKeys,
  privateCustomerEvidenceName,
  publicCustomerEvidence,
  publicCustomerEvidenceUpload,
  type CustomerEvidenceRecord,
  type CustomerEvidenceUploadPart,
  type CustomerEvidenceUploadSession,
} from "@/lib/customer-project-evidence";
import {
  hasAllowedSignature,
  sanitiseQuotingPhoto,
} from "@/lib/private-image-evidence";
import {
  CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
} from "@/lib/customer-projects.mjs";

export const runtime = "edge";

const ACTIVE_PROJECT_STATUSES = new Set(["draft", "matching", "quote_review"]);
const ACTIVE_UPLOAD_STATUSES = ["initiated", "uploading", "completing"];
const MAX_PART_REQUEST_BYTES =
  CUSTOMER_EVIDENCE_PART_SIZE_BYTES + 128 * 1024;

type OwnedProject = {
  id: string;
  status: string;
};

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function identity(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

async function ownedProject(customerUid: string, projectId: string) {
  return getD1().prepare(`SELECT id, status
    FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
    .bind(projectId, customerUid)
    .first<OwnedProject>();
}

async function activeAccount(customerUid: string) {
  return getD1().prepare(`SELECT firebase_uid FROM customer_accounts
    WHERE firebase_uid = ? AND account_status = 'active'`)
    .bind(customerUid)
    .first();
}

async function sessionParts(sessionId: string) {
  const rows = await getD1().prepare(`SELECT part_number, etag, size_bytes
    FROM customer_project_evidence_upload_parts
    WHERE session_id = ? ORDER BY part_number`)
    .bind(sessionId)
    .all<CustomerEvidenceUploadPart>();
  return rows.results;
}

async function sessionPayload(session: CustomerEvidenceUploadSession) {
  return publicCustomerEvidenceUpload(
    session,
    await sessionParts(session.id),
  );
}

function committedUploadPayload(record: CustomerEvidenceRecord) {
  const sizeBytes = Number(record.size_bytes || 0);
  return {
    id: `committed:${record.id}`,
    partSizeBytes: Math.max(1, sizeBytes),
    totalParts: 1,
    uploadedBytes: sizeBytes,
    parts: [],
    status: "completed",
  };
}

async function findSession(customerUid: string, sessionId: string) {
  return getD1().prepare(`SELECT *
    FROM customer_project_evidence_upload_sessions
    WHERE id = ? AND customer_uid = ?`)
    .bind(sessionId, customerUid)
    .first<CustomerEvidenceUploadSession>();
}

async function findEvidence(
  customerUid: string,
  evidenceId: string,
  projectId = "",
) {
  const query = projectId
    ? `SELECT * FROM customer_project_evidence
      WHERE id = ? AND customer_uid = ? AND project_id = ? AND status = 'active'`
    : `SELECT * FROM customer_project_evidence
      WHERE id = ? AND customer_uid = ? AND status = 'active'`;
  const statement = getD1().prepare(query);
  return projectId
    ? statement.bind(evidenceId, customerUid, projectId)
      .first<CustomerEvidenceRecord>()
    : statement.bind(evidenceId, customerUid)
      .first<CustomerEvidenceRecord>();
}

function evidenceRevisionConflict(record: CustomerEvidenceRecord) {
  return json({
    ok: false,
    code: "EVIDENCE_REVISION_CONFLICT",
    error: "This saved photo changed in another tab. Review the current photo before trying again.",
    evidence: publicCustomerEvidence(record),
  }, 409);
}

async function stopMultipartUpload(session: CustomerEvidenceUploadSession) {
  const bucket = getEvidenceBucket();
  try {
    if (
      session.status === "completing"
      && await bucket.head(session.staging_object_key)
    ) {
      await bucket.delete(session.staging_object_key);
      return;
    }
    await bucket
      .resumeMultipartUpload(session.staging_object_key, session.upload_id)
      .abort();
  } catch {
    // The multipart upload or staging object has already gone.
  }
}

async function expireSessions(customerUid: string, projectId: string) {
  const now = new Date().toISOString();
  const rows = await getD1().prepare(`SELECT *
    FROM customer_project_evidence_upload_sessions
    WHERE customer_uid = ? AND project_id = ?
      AND status IN ('initiated', 'uploading', 'completing')
      AND expires_at <= ? ORDER BY expires_at LIMIT 10`)
    .bind(customerUid, projectId, now)
    .all<CustomerEvidenceUploadSession>();
  for (const session of rows.results) {
    await stopMultipartUpload(session);
    await getD1().batch([
      getD1().prepare(`UPDATE customer_project_evidence_upload_sessions
        SET status = 'expired', privacy_status = 'not-stored',
          last_error = 'expired', updated_at = ?
        WHERE id = ? AND customer_uid = ?
          AND status IN ('initiated', 'uploading', 'completing')`)
        .bind(now, session.id, customerUid),
      getD1().prepare(`DELETE FROM customer_project_evidence_upload_parts
        WHERE session_id = ?`)
        .bind(session.id),
    ]);
  }
  const retentionCutoff = new Date(
    Date.now()
      - CUSTOMER_EVIDENCE_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const terminal = await getD1().prepare(`SELECT id
    FROM customer_project_evidence_upload_sessions
    WHERE customer_uid = ? AND project_id = ?
      AND status IN ('completed', 'abandoned', 'expired', 'conflict', 'rejected')
      AND updated_at < ? ORDER BY updated_at LIMIT 20`)
    .bind(customerUid, projectId, retentionCutoff)
    .all<{ id: string }>();
  for (const session of terminal.results) {
    await getD1().batch([
      getD1().prepare(`DELETE FROM customer_project_evidence_upload_parts
        WHERE session_id = ?`)
        .bind(session.id),
      getD1().prepare(`DELETE FROM customer_project_evidence_upload_sessions
        WHERE id = ? AND customer_uid = ? AND project_id = ?
          AND status IN ('completed', 'abandoned', 'expired', 'conflict', 'rejected')
          AND updated_at < ?`)
        .bind(session.id, customerUid, projectId, retentionCutoff),
    ]);
  }
}

function exactArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function initiate(
  user: { uid: string },
  raw: Record<string, unknown>,
) {
  const projectId = cleanCustomerEvidenceId(raw.projectId);
  const project = await ownedProject(user.uid, projectId);
  if (!project || !ACTIVE_PROJECT_STATUSES.has(project.status)) {
    return json({
      ok: false,
      error: "Photos can be added only to an active customer project.",
    }, 409);
  }
  if (!await activeAccount(user.uid)) {
    return json({
      ok: false,
      error: "Complete your active customer account first.",
    }, 403);
  }
  await expireSessions(user.uid, projectId);

  const clientUploadId = cleanCustomerEvidenceClientUploadId(
    raw.clientUploadId,
  );
  const contentType = typeof raw.contentType === "string"
    ? raw.contentType.trim()
    : "";
  const sizeBytes = Number(raw.sizeBytes);
  const replacementEvidenceId = cleanCustomerEvidenceId(
    raw.replaceEvidenceId,
  );
  let captureSlot = normaliseCustomerEvidenceCaptureSlot(raw.captureSlot);
  let category = customerEvidenceCategory(raw.category);
  let factKeys = normaliseCustomerEvidenceFactKeys(raw.factKeys);
  let sharingScope = customerEvidenceSharingScope(raw.sharingScope);
  let expectedEvidenceRevision = Number(raw.expectedEvidenceRevision || 0);
  let replacement: CustomerEvidenceRecord | null = null;

  if (
    !clientUploadId
    || !CUSTOMER_EVIDENCE_ALLOWED_TYPES.has(contentType)
    || !Number.isInteger(sizeBytes)
    || sizeBytes < 1
    || sizeBytes > CUSTOMER_EVIDENCE_MAX_FILE_BYTES
  ) {
    return json({
      ok: false,
      error: "Add a stable upload reference and a JPEG, PNG, WebP or PDF no larger than 8 MB.",
    }, 400);
  }

  if (replacementEvidenceId) {
    replacement = await findEvidence(
      user.uid,
      replacementEvidenceId,
      projectId,
    );
    if (!replacement) {
      return json({ ok: false, error: "Saved project evidence not found." }, 404);
    }
    if (
      !Number.isSafeInteger(expectedEvidenceRevision)
      || expectedEvidenceRevision < 1
      || expectedEvidenceRevision !== Number(replacement.revision || 1)
    ) {
      return evidenceRevisionConflict(replacement);
    }
    const requestedCaptureSlot = captureSlot;
    captureSlot = replacement.capture_slot || "";
    if (
      requestedCaptureSlot
      && requestedCaptureSlot !== captureSlot
    ) {
      return json({
        ok: false,
        error: "A retake must stay attached to the same photo prompt.",
      }, 400);
    }
    category = replacement.category;
    factKeys = normaliseCustomerEvidenceFactKeys(replacement.fact_keys);
    sharingScope = customerEvidenceSharingScope(replacement.sharing_scope);
  } else {
    expectedEvidenceRevision = 0;
  }

  if (!category) {
    return json({
      ok: false,
      error: "Choose a valid property evidence category.",
    }, 400);
  }
  if (
    CUSTOMER_EVIDENCE_QUOTING_PHOTO_CATEGORIES.has(category)
    && !captureSlot
  ) {
    return json({
      ok: false,
      error: "Choose the guided photo prompt this image answers.",
    }, 400);
  }
  if (
    sharingScope === "allocated-installers"
    && raw.confirmInstallerPhotoSharing !== true
  ) {
    return json({
      ok: false,
      error: "Confirm that this photo can be shared with verified installers allocated to this enquiry.",
    }, 400);
  }

  const metadata = {
    projectId,
    clientUploadId,
    contentType,
    sizeBytes,
    category,
    captureSlot,
    factKeys,
    sharingScope,
    replacementEvidenceId,
    expectedEvidenceRevision,
  };
  const metadataHash = await hashCustomerEvidenceUploadMetadata(metadata);
  const existing = await getD1().prepare(`SELECT *
    FROM customer_project_evidence_upload_sessions
    WHERE customer_uid = ? AND project_id = ? AND client_upload_id = ?`)
    .bind(user.uid, projectId, clientUploadId)
    .first<CustomerEvidenceUploadSession>();
  if (existing) {
    if (existing.metadata_hash !== metadataHash) {
      return json({
        ok: false,
        code: "IDEMPOTENCY_MISMATCH",
        error: "This upload reference was already used for different photo details.",
      }, 409);
    }
    const evidence = existing.status === "completed"
      ? await findEvidence(user.uid, existing.evidence_id, projectId)
      : null;
    return json({
      ok: true,
      duplicate: true,
      contractVersion: 1,
      upload: await sessionPayload(existing),
      ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
    });
  }

  const committedByClient = await getD1().prepare(`SELECT *
    FROM customer_project_evidence
    WHERE customer_uid = ? AND project_id = ? AND client_upload_id = ?
      AND status = 'active'`)
    .bind(user.uid, projectId, clientUploadId)
    .first<CustomerEvidenceRecord>();
  if (committedByClient) {
    if (
      committedByClient.category !== category
      || (committedByClient.capture_slot || "") !== captureSlot
      || committedByClient.content_type !== contentType
      || Number(committedByClient.size_bytes || 0) !== sizeBytes
      || committedByClient.fact_keys !== JSON.stringify(factKeys)
      || committedByClient.sharing_scope !== sharingScope
      || (
        replacementEvidenceId
        && committedByClient.id !== replacementEvidenceId
      )
    ) {
      return json({
        ok: false,
        code: "IDEMPOTENCY_MISMATCH",
        error: "This upload reference was already used for a different file.",
      }, 409);
    }
    return json({
      ok: true,
      duplicate: true,
      contractVersion: 1,
      upload: committedUploadPayload(committedByClient),
      evidence: publicCustomerEvidence(committedByClient),
    });
  }

  const id = crypto.randomUUID();
  const evidenceId = replacement?.id || crypto.randomUUID();
  const replacementObjectKey = replacement?.object_key || "";
  const stagingObjectKey =
    `customer-project-upload-staging/${user.uid}/${projectId}/${id}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + CUSTOMER_EVIDENCE_SESSION_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const multipart = await getEvidenceBucket().createMultipartUpload(
    stagingObjectKey,
    {
      httpMetadata: { contentType },
      customMetadata: {
        customerUid: user.uid,
        projectId,
        uploadSessionId: id,
      },
    },
  );

  try {
    const inserted = await getD1().prepare(`
      INSERT INTO customer_project_evidence_upload_sessions
        (id, project_id, customer_uid, client_upload_id, metadata_hash,
         capture_slot, replacement_evidence_id, replacement_object_key,
         expected_evidence_revision, staging_object_key, upload_id,
         content_type, size_bytes, category, fact_keys, sharing_scope,
         part_size_bytes, status, evidence_id,
         privacy_status, expires_at, completed_at, last_error, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'initiated', ?, 'pending', ?, '', '', ?, ?
      WHERE ? <> ''
        AND (
          ? <> ''
          OR (
            (SELECT COUNT(*) FROM customer_project_evidence
              WHERE project_id = ? AND customer_uid = ? AND status = 'active')
            +
            (SELECT COUNT(*) FROM customer_project_evidence_upload_sessions
              WHERE project_id = ? AND customer_uid = ?
                AND replacement_evidence_id = ''
                AND status IN ('initiated', 'uploading', 'completing'))
          ) < ?
        )`)
      .bind(
        id,
        projectId,
        user.uid,
        clientUploadId,
        metadataHash,
        captureSlot,
        replacementEvidenceId,
        replacementObjectKey,
        expectedEvidenceRevision,
        stagingObjectKey,
        multipart.uploadId,
        contentType,
        sizeBytes,
        category,
        JSON.stringify(factKeys),
        sharingScope,
        CUSTOMER_EVIDENCE_PART_SIZE_BYTES,
        evidenceId,
        expiresAt,
        now,
        now,
        projectId,
        replacementEvidenceId,
        projectId,
        user.uid,
        projectId,
        user.uid,
        CUSTOMER_EVIDENCE_MAX_PROJECT_FILES,
      )
      .run();
    if (Number(inserted.meta.changes || 0) !== 1) {
      await multipart.abort();
      return json({
        ok: false,
        code: "PROJECT_EVIDENCE_LIMIT",
        error: "This project already has 12 saved or uploading photos and documents.",
      }, 409);
    }
  } catch {
    await multipart.abort();
    const raced = await getD1().prepare(`SELECT *
      FROM customer_project_evidence_upload_sessions
      WHERE customer_uid = ? AND project_id = ? AND client_upload_id = ?`)
      .bind(user.uid, projectId, clientUploadId)
      .first<CustomerEvidenceUploadSession>();
    if (raced?.metadata_hash === metadataHash) {
      return json({
        ok: true,
        duplicate: true,
        contractVersion: 1,
        upload: await sessionPayload(raced),
      });
    }
    if (replacementEvidenceId) {
      const racedReplacement = await getD1().prepare(`SELECT *
        FROM customer_project_evidence_upload_sessions
        WHERE customer_uid = ? AND project_id = ?
          AND replacement_evidence_id = ?
          AND status IN ('initiated', 'uploading', 'completing')
        LIMIT 1`)
        .bind(user.uid, projectId, replacementEvidenceId)
        .first<CustomerEvidenceUploadSession>();
      if (racedReplacement) {
        return json({
          ok: false,
          code: "UPLOAD_ALREADY_IN_PROGRESS",
          error: "A replacement upload is already in progress for this saved photo. Resume or abandon it before starting another.",
        }, 409);
      }
    }
    return json({
      ok: false,
      code: "UPLOAD_ALREADY_IN_PROGRESS",
      error: "This photo upload could not be started safely. Choose the photo again.",
    }, 409);
  }

  const session = await findSession(user.uid, id);
  if (!session) {
    await multipart.abort();
    return json({
      ok: false,
      error: "The upload session could not be created.",
    }, 500);
  }
  return json({
    ok: true,
    contractVersion: 1,
    upload: await sessionPayload(session),
  }, 201);
}

async function uploadPart(
  user: { uid: string },
  form: FormData,
) {
  const sessionId = cleanCustomerEvidenceId(form.get("sessionId"));
  const session = await findSession(user.uid, sessionId);
  if (!session) {
    return json({ ok: false, error: "Upload session not found." }, 404);
  }
  if (!["initiated", "uploading"].includes(session.status)) {
    return json({
      ok: false,
      error: "This upload is no longer accepting file parts.",
    }, 409);
  }
  if (session.expires_at <= new Date().toISOString()) {
    await expireSessions(user.uid, session.project_id);
    return json({
      ok: false,
      code: "UPLOAD_EXPIRED",
      error: "This photo upload expired. Start the upload again.",
    }, 410);
  }
  const project = await ownedProject(user.uid, session.project_id);
  if (!project || !ACTIVE_PROJECT_STATUSES.has(project.status)) {
    return json({
      ok: false,
      error: "This project is no longer accepting photos.",
    }, 409);
  }
  const partNumber = Number(form.get("partNumber"));
  const file = form.get("file");
  const totalParts = Math.ceil(
    Number(session.size_bytes) / Number(session.part_size_bytes),
  );
  if (
    !(file instanceof File)
    || !Number.isInteger(partNumber)
    || partNumber < 1
    || partNumber > totalParts
  ) {
    return json({ ok: false, error: "Add a valid upload part." }, 400);
  }
  const expectedBytes = partNumber === totalParts
    ? Number(session.size_bytes)
      - Number(session.part_size_bytes) * (totalParts - 1)
    : Number(session.part_size_bytes);
  if (file.size !== expectedBytes) {
    return json({
      ok: false,
      error: `Upload part ${partNumber} must contain exactly ${expectedBytes} bytes.`,
    }, 400);
  }

  const uploaded = await getEvidenceBucket()
    .resumeMultipartUpload(session.staging_object_key, session.upload_id)
    .uploadPart(partNumber, await file.arrayBuffer());
  const now = new Date().toISOString();
  const results = await getD1().batch([
    getD1().prepare(`INSERT INTO customer_project_evidence_upload_parts
      (id, session_id, part_number, etag, size_bytes, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM customer_project_evidence_upload_sessions
        WHERE id = ? AND customer_uid = ?
          AND status IN ('initiated', 'uploading')
      )
      ON CONFLICT(session_id, part_number) DO UPDATE SET
        etag = excluded.etag, size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at`)
      .bind(
        crypto.randomUUID(),
        session.id,
        partNumber,
        uploaded.etag,
        file.size,
        now,
        now,
        session.id,
        user.uid,
      ),
    getD1().prepare(`UPDATE customer_project_evidence_upload_sessions
      SET status = 'uploading', last_error = '', updated_at = ?
      WHERE id = ? AND customer_uid = ?
        AND status IN ('initiated', 'uploading')`)
      .bind(now, session.id, user.uid),
  ]);
  if (Number(results[0]?.meta.changes || 0) !== 1) {
    await stopMultipartUpload(session);
    return json({
      ok: false,
      error: "This upload stopped before the file part was saved.",
    }, 409);
  }
  const current = await findSession(user.uid, session.id);
  return json({
    ok: true,
    contractVersion: 1,
    upload: await sessionPayload(current || {
      ...session,
      status: "uploading",
      updated_at: now,
    }),
  });
}

async function markUnusableSession(
  session: CustomerEvidenceUploadSession,
  status: "rejected" | "conflict",
  error: string,
) {
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare(`UPDATE customer_project_evidence_upload_sessions
      SET status = ?, privacy_status = 'not-stored', last_error = ?, updated_at = ?
      WHERE id = ? AND customer_uid = ?`)
      .bind(status, error, now, session.id, session.customer_uid),
    getD1().prepare(`DELETE FROM customer_project_evidence_upload_parts
      WHERE session_id = ?`)
      .bind(session.id),
  ]);
}

async function finishFinalisingSession(
  session: CustomerEvidenceUploadSession,
) {
  if (session.status === "completed") return true;
  if (session.status !== "finalising") return false;
  const bucket = getEvidenceBucket();
  try {
    await bucket.delete(session.staging_object_key);
    if (session.replacement_object_key) {
      await bucket.delete(session.replacement_object_key);
    }
  } catch {
    await getD1().prepare(`UPDATE customer_project_evidence_upload_sessions
      SET last_error = 'private_object_cleanup_failed', updated_at = ?
      WHERE id = ? AND customer_uid = ? AND status = 'finalising'`)
      .bind(new Date().toISOString(), session.id, session.customer_uid)
      .run();
    return false;
  }
  const finishedAt = new Date().toISOString();
  const updated = await getD1().prepare(`
    UPDATE customer_project_evidence_upload_sessions
    SET status = 'completed', last_error = '', updated_at = ?
    WHERE id = ? AND customer_uid = ? AND status = 'finalising'
      AND EXISTS (
        SELECT 1 FROM customer_project_evidence
        WHERE id = ? AND project_id = ? AND customer_uid = ?
          AND status = 'active'
      )`)
    .bind(
      finishedAt,
      session.id,
      session.customer_uid,
      session.evidence_id,
      session.project_id,
      session.customer_uid,
    )
    .run();
  if (Number(updated.meta.changes || 0) === 1) return true;
  const latest = await findSession(session.customer_uid, session.id);
  return latest?.status === "completed";
}

async function complete(
  user: { uid: string },
  raw: Record<string, unknown>,
) {
  let session = await findSession(
    user.uid,
    cleanCustomerEvidenceId(raw.sessionId),
  );
  if (!session) {
    return json({ ok: false, error: "Upload session not found." }, 404);
  }
  if (session.status === "finalising") {
    const cleanupComplete = await finishFinalisingSession(session);
    const latest = await findSession(user.uid, session.id) || session;
    const evidence = await findEvidence(
      user.uid,
      session.evidence_id,
      session.project_id,
    );
    return json({
      ok: true,
      duplicate: true,
      cleanupPending: !cleanupComplete,
      contractVersion: 1,
      upload: await sessionPayload(latest),
      ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
    }, cleanupComplete ? 200 : 202);
  }
  if (session.status === "completed") {
    const evidence = await findEvidence(
      user.uid,
      session.evidence_id,
      session.project_id,
    );
    return json({
      ok: true,
      duplicate: true,
      contractVersion: 1,
      upload: await sessionPayload(session),
      ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
    });
  }
  if (!ACTIVE_UPLOAD_STATUSES.includes(session.status)) {
    return json({
      ok: false,
      error: "This upload cannot be completed.",
    }, 409);
  }
  if (session.expires_at <= new Date().toISOString()) {
    await expireSessions(user.uid, session.project_id);
    return json({
      ok: false,
      code: "UPLOAD_EXPIRED",
      error: "This photo upload expired. Start the upload again.",
    }, 410);
  }
  const project = await ownedProject(user.uid, session.project_id);
  if (!project || !ACTIVE_PROJECT_STATUSES.has(project.status)) {
    return json({
      ok: false,
      error: "This project is no longer accepting photos.",
    }, 409);
  }
  if (!await activeAccount(user.uid)) {
    return json({
      ok: false,
      error: "Complete your active customer account first.",
    }, 403);
  }

  let replacement: CustomerEvidenceRecord | null = null;
  if (session.replacement_evidence_id) {
    replacement = await findEvidence(
      user.uid,
      session.replacement_evidence_id,
      session.project_id,
    );
    if (!replacement) {
      await stopMultipartUpload(session);
      await markUnusableSession(session, "conflict", "replacement_missing");
      return json({
        ok: false,
        error: "The saved photo being replaced is no longer available.",
      }, 409);
    }
    if (
      Number(replacement.revision || 1)
      !== Number(session.expected_evidence_revision)
    ) {
      await stopMultipartUpload(session);
      await markUnusableSession(session, "conflict", "revision_conflict");
      return evidenceRevisionConflict(replacement);
    }
  }

  const parts = await sessionParts(session.id);
  const totalParts = Math.ceil(
    Number(session.size_bytes) / Number(session.part_size_bytes),
  );
  const uploadedBytes = parts.reduce(
    (total, part) => total + Number(part.size_bytes || 0),
    0,
  );
  if (
    parts.length !== totalParts
    || uploadedBytes !== Number(session.size_bytes)
  ) {
    return json({
      ok: false,
      code: "UPLOAD_INCOMPLETE",
      error: "Upload every photo part before completing this file.",
      uploadedParts: parts.length,
      totalParts,
    }, 409);
  }

  const bucket = getEvidenceBucket();
  if (session.status !== "completing") {
    const locked = await getD1().prepare(`
      UPDATE customer_project_evidence_upload_sessions
      SET status = 'completing', updated_at = ?
      WHERE id = ? AND customer_uid = ?
        AND status IN ('initiated', 'uploading')`)
      .bind(new Date().toISOString(), session.id, user.uid)
      .run();
    if (Number(locked.meta.changes || 0) !== 1) {
      const latest = await findSession(user.uid, session.id);
      if (latest?.status === "completed") {
        const evidence = await findEvidence(
          user.uid,
          latest.evidence_id,
          latest.project_id,
        );
        return json({
          ok: true,
          duplicate: true,
          contractVersion: 1,
          upload: await sessionPayload(latest),
          ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
        });
      }
      return json({
        ok: false,
        error: "This upload changed before completion. Refresh its status.",
      }, 409);
    }
    try {
      await bucket
        .resumeMultipartUpload(session.staging_object_key, session.upload_id)
        .complete(
          parts.map((part) => ({
            partNumber: Number(part.part_number),
            etag: part.etag,
          })),
        );
    } catch (error) {
      let assembled = false;
      try {
        assembled = Boolean(
          await bucket.head(session.staging_object_key),
        );
      } catch {
        assembled = false;
      }
      if (!assembled) {
        await getD1().prepare(`UPDATE customer_project_evidence_upload_sessions
          SET status = 'uploading', last_error = 'multipart_complete_failed',
            updated_at = ?
          WHERE id = ? AND customer_uid = ? AND status = 'completing'`)
          .bind(new Date().toISOString(), session.id, user.uid)
          .run();
        throw error;
      }
    }
    session = { ...session, status: "completing" };
  } else if (!await bucket.head(session.staging_object_key)) {
    return json({
      ok: false,
      code: "UPLOAD_RECOVERY_REQUIRED",
      error: "The assembled photo is temporarily unavailable. Try completing it again.",
    }, 409);
  }

  const staged = await bucket.get(session.staging_object_key);
  if (!staged) {
    return json({
      ok: false,
      code: "UPLOAD_RECOVERY_REQUIRED",
      error: "The assembled photo is temporarily unavailable. Try completing it again.",
    }, 409);
  }
  const uploadedBytesArray = new Uint8Array(await staged.arrayBuffer());
  if (
    uploadedBytesArray.byteLength !== Number(session.size_bytes)
    || !hasAllowedSignature(
      uploadedBytesArray,
      session.content_type,
    )
  ) {
    await bucket.delete(session.staging_object_key);
    await markUnusableSession(session, "rejected", "signature_mismatch");
    return json({
      ok: false,
      error: "The uploaded file contents do not match the selected photo or document type.",
    }, 400);
  }
  const storedBytes = session.content_type.startsWith("image/")
    ? sanitiseQuotingPhoto(uploadedBytesArray, session.content_type)
    : uploadedBytesArray;
  if (!storedBytes) {
    await bucket.delete(session.staging_object_key);
    await markUnusableSession(session, "rejected", "privacy_processing_failed");
    return json({
      ok: false,
      error: "This photo could not be safely stored. Convert it to JPEG and try again.",
    }, 400);
  }

  const privacyStatus = customerEvidencePrivacyStatus(session.content_type);
  const finalObjectKey =
    `customer-projects/${user.uid}/${session.project_id}/${crypto.randomUUID()}`;
  const fileName = privateCustomerEvidenceName(
    session.category,
    session.content_type,
    session.evidence_id,
  );
  const completedAt = new Date().toISOString();
  await bucket.put(finalObjectKey, exactArrayBuffer(storedBytes), {
    httpMetadata: { contentType: session.content_type },
    customMetadata: {
      customerUid: user.uid,
      projectId: session.project_id,
      evidenceId: session.evidence_id,
      sharingScope: session.sharing_scope,
      privacyStatus,
    },
  });

  const db = getD1();
  let evidenceWriteChanged = 0;
  try {
    if (replacement) {
      const nextRevision = Number(replacement.revision || 1) + 1;
      const statements = [
        db.prepare(`UPDATE customer_project_evidence
          SET client_upload_id = ?, file_name = ?, content_type = ?,
            size_bytes = ?, object_key = ?, privacy_status = ?,
            revision = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND customer_uid = ?
            AND status = 'active' AND revision = ? AND object_key = ?`)
          .bind(
            session.client_upload_id,
            fileName,
            session.content_type,
            storedBytes.byteLength,
            finalObjectKey,
            privacyStatus,
            nextRevision,
            completedAt,
            replacement.id,
            session.project_id,
            user.uid,
            session.expected_evidence_revision,
            replacement.object_key,
          ),
        db.prepare(`INSERT INTO customer_project_evidence_events
          (id, evidence_id, project_id, customer_uid, installer_uid,
           actor_type, actor_uid, event_type, created_at)
          SELECT ?, id, project_id, customer_uid, '', 'customer', ?,
            'replaced', ?
          FROM customer_project_evidence
          WHERE id = ? AND project_id = ? AND customer_uid = ?
            AND status = 'active' AND revision = ? AND object_key = ?`)
          .bind(
            crypto.randomUUID(),
            user.uid,
            completedAt,
            replacement.id,
            session.project_id,
            user.uid,
            nextRevision,
            finalObjectKey,
          ),
        db.prepare(`UPDATE customer_project_evidence_upload_sessions
          SET status = 'finalising', privacy_status = ?, completed_at = ?,
            last_error = '', updated_at = ?
          WHERE id = ? AND customer_uid = ? AND status = 'completing'
            AND evidence_id = ?
            AND EXISTS (
              SELECT 1 FROM customer_project_evidence
              WHERE id = ? AND project_id = ? AND customer_uid = ?
                AND status = 'active' AND revision = ? AND object_key = ?
            )`)
          .bind(
            privacyStatus,
            completedAt,
            completedAt,
            session.id,
            user.uid,
            replacement.id,
            replacement.id,
            session.project_id,
            user.uid,
            nextRevision,
            finalObjectKey,
          ),
        db.prepare(`UPDATE customer_projects SET updated_at = ?
          WHERE id = ? AND firebase_uid = ?
            AND EXISTS (
              SELECT 1 FROM customer_project_evidence
              WHERE id = ? AND project_id = ? AND customer_uid = ?
                AND status = 'active' AND revision = ? AND object_key = ?
            )`)
          .bind(
            completedAt,
            session.project_id,
            user.uid,
            replacement.id,
            session.project_id,
            user.uid,
            nextRevision,
            finalObjectKey,
          ),
      ];
      if (session.sharing_scope === "allocated-installers") {
        statements.push(db.prepare(`INSERT INTO customer_consent_receipts
          (id, firebase_uid, project_id, purpose, notice_version,
           granted_at, withdrawn_at, created_at)
          SELECT ?, ?, ?, 'installer_evidence_sharing', ?, ?, '', ?
          FROM customer_project_evidence
          WHERE id = ? AND project_id = ? AND customer_uid = ?
            AND status = 'active' AND revision = ? AND object_key = ?
          ON CONFLICT(id) DO UPDATE SET
            notice_version = excluded.notice_version,
            granted_at = excluded.granted_at, withdrawn_at = ''`)
          .bind(
            `customer-evidence-share:${session.project_id}`,
            user.uid,
            session.project_id,
            CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
            completedAt,
            completedAt,
            replacement.id,
            session.project_id,
            user.uid,
            nextRevision,
            finalObjectKey,
          ));
      }
      const results = await db.batch(statements);
      evidenceWriteChanged = Number(results[0]?.meta.changes || 0);
    } else {
      const statements = [
        db.prepare(`INSERT INTO customer_project_evidence
          (id, project_id, customer_uid, client_upload_id, category,
           capture_slot, fact_keys, sharing_scope, file_name, content_type,
           size_bytes, object_key, privacy_status, revision, status,
           created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?
          WHERE (
            SELECT COUNT(*) FROM customer_project_evidence
            WHERE project_id = ? AND customer_uid = ? AND status = 'active'
          ) < ?`)
          .bind(
            session.evidence_id,
            session.project_id,
            user.uid,
            session.client_upload_id,
            session.category,
            session.capture_slot,
            session.fact_keys,
            session.sharing_scope,
            fileName,
            session.content_type,
            storedBytes.byteLength,
            finalObjectKey,
            privacyStatus,
            completedAt,
            completedAt,
            session.project_id,
            user.uid,
            CUSTOMER_EVIDENCE_MAX_PROJECT_FILES,
          ),
        db.prepare(`INSERT INTO customer_project_evidence_events
          (id, evidence_id, project_id, customer_uid, installer_uid,
           actor_type, actor_uid, event_type, created_at)
          SELECT ?, id, project_id, customer_uid, '', 'customer', ?,
            'uploaded', ?
          FROM customer_project_evidence
          WHERE id = ? AND project_id = ? AND customer_uid = ?
            AND status = 'active' AND revision = 1`)
          .bind(
            crypto.randomUUID(),
            user.uid,
            completedAt,
            session.evidence_id,
            session.project_id,
            user.uid,
          ),
        db.prepare(`UPDATE customer_project_evidence_upload_sessions
          SET status = 'finalising', privacy_status = ?, completed_at = ?,
            last_error = '', updated_at = ?
          WHERE id = ? AND customer_uid = ? AND status = 'completing'
            AND evidence_id = ?
            AND EXISTS (
              SELECT 1 FROM customer_project_evidence
              WHERE id = ? AND project_id = ? AND customer_uid = ?
                AND status = 'active' AND revision = 1 AND object_key = ?
            )`)
          .bind(
            privacyStatus,
            completedAt,
            completedAt,
            session.id,
            user.uid,
            session.evidence_id,
            session.evidence_id,
            session.project_id,
            user.uid,
            finalObjectKey,
          ),
        db.prepare(`UPDATE customer_projects SET updated_at = ?
          WHERE id = ? AND firebase_uid = ?
            AND EXISTS (
              SELECT 1 FROM customer_project_evidence
              WHERE id = ? AND project_id = ? AND customer_uid = ?
                AND status = 'active' AND revision = 1 AND object_key = ?
            )`)
          .bind(
            completedAt,
            session.project_id,
            user.uid,
            session.evidence_id,
            session.project_id,
            user.uid,
            finalObjectKey,
          ),
      ];
      if (session.sharing_scope === "allocated-installers") {
        statements.push(db.prepare(`INSERT INTO customer_consent_receipts
          (id, firebase_uid, project_id, purpose, notice_version,
           granted_at, withdrawn_at, created_at)
          SELECT ?, ?, ?, 'installer_evidence_sharing', ?, ?, '', ?
          FROM customer_project_evidence
          WHERE id = ? AND project_id = ? AND customer_uid = ?
            AND status = 'active' AND revision = 1 AND object_key = ?
          ON CONFLICT(id) DO UPDATE SET
            notice_version = excluded.notice_version,
            granted_at = excluded.granted_at, withdrawn_at = ''`)
          .bind(
            `customer-evidence-share:${session.project_id}`,
            user.uid,
            session.project_id,
            CUSTOMER_EVIDENCE_SHARE_NOTICE_VERSION,
            completedAt,
            completedAt,
            session.evidence_id,
            session.project_id,
            user.uid,
            finalObjectKey,
          ));
      }
      const results = await db.batch(statements);
      evidenceWriteChanged = Number(results[0]?.meta.changes || 0);
    }

    if (evidenceWriteChanged !== 1) {
      await bucket.delete(finalObjectKey);
      await bucket.delete(session.staging_object_key);
      await markUnusableSession(
        session,
        "conflict",
        replacement ? "revision_conflict" : "project_limit",
      );
      if (replacement) {
        const latest = await findEvidence(
          user.uid,
          replacement.id,
          session.project_id,
        );
        return latest
          ? evidenceRevisionConflict(latest)
          : json({
            ok: false,
            error: "The saved photo being replaced is no longer available.",
          }, 409);
      }
      return json({
        ok: false,
        code: "PROJECT_EVIDENCE_LIMIT",
        error: "This project already has its maximum of 12 evidence files.",
      }, 409);
    }
  } catch (error) {
    const committed = await findEvidence(
      user.uid,
      session.evidence_id,
      session.project_id,
    );
    const committedSession = await findSession(user.uid, session.id);
    if (
      committed?.object_key === finalObjectKey
      && ["finalising", "completed"].includes(committedSession?.status || "")
    ) {
      evidenceWriteChanged = 1;
      session = committedSession || session;
    } else {
      await bucket.delete(finalObjectKey);
    }
    if (evidenceWriteChanged === 1) {
      // The transactional write committed even though the response was lost.
    } else {
      throw error;
    }
  }

  const finalising = await findSession(user.uid, session.id) || {
    ...session,
    status: "finalising",
    privacy_status: privacyStatus,
    completed_at: completedAt,
    updated_at: completedAt,
  };
  const cleanupComplete = await finishFinalisingSession(finalising);
  const completed = await findSession(user.uid, session.id) || finalising;
  const evidence = await findEvidence(
    user.uid,
    session.evidence_id,
    session.project_id,
  );
  return json({
    ok: true,
    cleanupPending: !cleanupComplete,
    contractVersion: 1,
    upload: await sessionPayload(completed),
    ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
  }, 201);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const url = new URL(request.url);
  const sessionId = cleanCustomerEvidenceId(
    url.searchParams.get("sessionId"),
  );
  if (sessionId) {
    const session = await findSession(user.uid, sessionId);
    if (!session) {
      return json({ ok: false, error: "Upload session not found." }, 404);
    }
    await expireSessions(user.uid, session.project_id);
    if (session.status === "finalising") {
      await finishFinalisingSession(session);
    }
    const current = await findSession(user.uid, sessionId);
    return json({
      ok: true,
      contractVersion: 1,
      upload: await sessionPayload(current || session),
    });
  }
  const projectId = cleanCustomerEvidenceId(
    url.searchParams.get("projectId"),
  );
  if (!await ownedProject(user.uid, projectId)) {
    return json({ ok: false, error: "Project not found." }, 404);
  }
  await expireSessions(user.uid, projectId);
  const rows = await getD1().prepare(`SELECT *
    FROM customer_project_evidence_upload_sessions
    WHERE customer_uid = ? AND project_id = ?
      AND status IN ('initiated', 'uploading', 'completing', 'finalising')
    ORDER BY updated_at DESC LIMIT 20`)
    .bind(user.uid, projectId)
    .all<CustomerEvidenceUploadSession>();
  for (const session of rows.results) {
    if (session.status === "finalising") {
      await finishFinalisingSession(session);
    }
  }
  const currentRows = await getD1().prepare(`SELECT *
    FROM customer_project_evidence_upload_sessions
    WHERE customer_uid = ? AND project_id = ?
      AND status IN ('initiated', 'uploading', 'completing', 'finalising')
    ORDER BY updated_at DESC LIMIT 20`)
    .bind(user.uid, projectId)
    .all<CustomerEvidenceUploadSession>();
  return json({
    ok: true,
    contractVersion: 1,
    uploads: await Promise.all(currentRows.results.map(sessionPayload)),
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      if (
        Number(request.headers.get("content-length") || 0)
        > MAX_PART_REQUEST_BYTES
      ) {
        return json({ ok: false, error: "The upload part was too large." }, 413);
      }
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return json({ ok: false, error: "The upload part could not be read." }, 400);
      }
      if (form.get("action") !== "upload_part") {
        return json({ ok: false, error: "Choose a valid upload action." }, 400);
      }
      return await uploadPart(user, form);
    }
    if (Number(request.headers.get("content-length") || 0) > 20_000) {
      return json({ ok: false, error: "The upload request was too large." }, 413);
    }
    let raw: Record<string, unknown>;
    try {
      raw = await request.json() as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "The upload request could not be read." }, 400);
    }
    if (raw.action === "initiate") return await initiate(user, raw);
    if (raw.action === "complete") return await complete(user, raw);
    return json({ ok: false, error: "Choose a valid upload action." }, 400);
  } catch {
    return json({
      ok: false,
      error: "The photo upload could not be completed safely.",
    }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const session = await findSession(
    user.uid,
    cleanCustomerEvidenceId(
      new URL(request.url).searchParams.get("sessionId"),
    ),
  );
  if (!session) {
    return json({ ok: false, error: "Upload session not found." }, 404);
  }
  if (session.status === "finalising") {
    const cleanupComplete = await finishFinalisingSession(session);
    const latest = await findSession(user.uid, session.id) || session;
    const evidence = await findEvidence(
      user.uid,
      session.evidence_id,
      session.project_id,
    );
    return json({
      ok: true,
      abandoned: false,
      cleanupPending: !cleanupComplete,
      upload: await sessionPayload(latest),
      ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
    }, cleanupComplete ? 200 : 202);
  }
  if (session.status === "completed") {
    const evidence = await findEvidence(
      user.uid,
      session.evidence_id,
      session.project_id,
    );
    return json({
      ok: true,
      abandoned: false,
      ...(evidence ? { evidence: publicCustomerEvidence(evidence) } : {}),
    });
  }
  if (ACTIVE_UPLOAD_STATUSES.includes(session.status)) {
    await stopMultipartUpload(session);
  }
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare(`UPDATE customer_project_evidence_upload_sessions
      SET status = 'abandoned', privacy_status = 'not-stored',
        last_error = '', updated_at = ?
      WHERE id = ? AND customer_uid = ? AND status <> 'completed'`)
      .bind(now, session.id, user.uid),
    getD1().prepare(`DELETE FROM customer_project_evidence_upload_parts
      WHERE session_id = ?`)
      .bind(session.id),
  ]);
  return json({ ok: true, abandoned: true });
}
