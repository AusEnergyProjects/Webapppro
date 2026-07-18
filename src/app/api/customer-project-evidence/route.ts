import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { hasAllowedSignature, sanitiseQuotingPhoto } from "@/lib/private-image-evidence";

export const runtime = "edge";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_FILES = 12;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const CATEGORIES = new Set(["property-photo", "existing-equipment", "switchboard", "supporting-document", "other"]);
const QUOTING_PHOTO_CATEGORIES = new Set(["property-photo", "existing-equipment", "switchboard"]);

type EvidenceBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

type EvidenceRecord = {
  id: string;
  project_id: string;
  customer_uid: string;
  client_upload_id: string;
  category: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  status: string;
  created_at: string;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function getEvidenceBucket() {
  const bucket = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!bucket) throw new Error("Project evidence storage is unavailable.");
  return bucket;
}

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").trim().slice(0, 180) || "project-evidence";
}

function publicRecord(record: EvidenceRecord) {
  return {
    id: record.id,
    category: record.category,
    fileName: record.file_name,
    contentType: record.content_type,
    sizeBytes: Number(record.size_bytes),
    createdAt: record.created_at,
  };
}

async function identity(request: Request) {
  try { return await requireFirebaseIdentity(request); }
  catch { return null; }
}

async function ownedProject(customerUid: string, projectId: string) {
  return getD1().prepare(`SELECT id, status FROM customer_projects WHERE id = ? AND firebase_uid = ?`)
    .bind(projectId, customerUid).first<{ id: string; status: string }>();
}

async function installerCanAccess(installerUid: string, record: EvidenceRecord) {
  const access = await getD1().prepare(`SELECT m.id
    FROM customer_projects p
    JOIN trade_opportunity_matches m ON m.opportunity_id = p.opportunity_id
    JOIN trade_opportunities o ON o.id = m.opportunity_id
    JOIN trade_accounts a ON a.firebase_uid = m.firebase_uid
    WHERE p.id = ? AND p.firebase_uid = ? AND m.firebase_uid = ?
      AND m.status IN ('offered', 'viewed', 'interested', 'connected')
      AND o.status IN ('open', 'paused') AND a.partner_type = 'installer'
      AND a.account_status = 'active' AND a.verification_status = 'approved' LIMIT 1`)
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
  const downloadId = (url.searchParams.get("download") || "").slice(0, 180);
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
  const projectId = (url.searchParams.get("projectId") || "").slice(0, 180);
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
  const projectId = String(form.get("projectId") || "").trim().slice(0, 180);
  const category = String(form.get("category") || "").trim();
  const clientUploadId = String(form.get("clientUploadId") || "").trim().slice(0, 180);
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
  if (!CATEGORIES.has(category)) return json({ ok: false, error: "Choose a valid property evidence category." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "Upload a PDF, JPEG, PNG or WebP file. Unsupported phone photos must be converted to JPEG first." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return json({ ok: false, error: "Each file must be no larger than 8 MB." }, 400);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasAllowedSignature(fileBytes, file.type)) return json({ ok: false, error: "The file contents do not match the selected photo or document type." }, 400);
  const storedBytes = QUOTING_PHOTO_CATEGORIES.has(category) ? sanitiseQuotingPhoto(fileBytes, file.type) : fileBytes;
  if (!storedBytes) return json({ ok: false, error: "This photo could not be made safe for installer sharing. Convert it to JPEG and try again." }, 400);
  const existing = await getD1().prepare(`SELECT * FROM customer_project_evidence
    WHERE project_id = ? AND customer_uid = ? AND client_upload_id = ? AND status = 'active'`)
    .bind(projectId, user.uid, clientUploadId).first<EvidenceRecord>();
  if (existing) return json({ ok: true, evidence: publicRecord(existing) });
  const count = await getD1().prepare(`SELECT COUNT(*) total FROM customer_project_evidence
    WHERE project_id = ? AND customer_uid = ? AND status = 'active'`).bind(projectId, user.uid).first<{ total: number }>();
  if (Number(count?.total || 0) >= MAX_PROJECT_FILES) return json({ ok: false, error: "This project already has its maximum of 12 evidence files." }, 409);

  const id = crypto.randomUUID();
  const objectKey = `customer-projects/${user.uid}/${projectId}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const fileName = safeFileName(file.name);
  const bucket = getEvidenceBucket();
  await bucket.put(objectKey, storedBytes.buffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: { customerUid: user.uid, projectId, evidenceId: id },
  });
  try {
    await getD1().batch([
      getD1().prepare(`INSERT INTO customer_project_evidence
        (id, project_id, customer_uid, client_upload_id, category, file_name, content_type, size_bytes, object_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(id, projectId, user.uid, clientUploadId, category, fileName, file.type, storedBytes.byteLength, objectKey, now, now),
      getD1().prepare(`INSERT INTO customer_project_evidence_events
        (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
        VALUES (?, ?, ?, ?, '', 'customer', ?, 'uploaded', ?)`)
        .bind(crypto.randomUUID(), id, projectId, user.uid, user.uid, now),
      getD1().prepare("UPDATE customer_projects SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(now, projectId, user.uid),
    ]);
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
  return json({ ok: true, evidence: publicRecord({ id, project_id: projectId, customer_uid: user.uid,
    client_upload_id: clientUploadId, category, file_name: fileName, content_type: file.type, size_bytes: storedBytes.byteLength, object_key: objectKey,
    status: "active", created_at: now }) }, 201);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const user = await identity(request);
  if (!user) return json({ ok: false, error: "Sign in to continue." }, 401);
  const id = (new URL(request.url).searchParams.get("id") || "").slice(0, 180);
  const record = await getD1().prepare(`SELECT * FROM customer_project_evidence
    WHERE id = ? AND customer_uid = ? AND status = 'active'`).bind(id, user.uid).first<EvidenceRecord>();
  if (!record) return json({ ok: false, error: "Project evidence not found." }, 404);
  await getEvidenceBucket().delete(record.object_key);
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare(`UPDATE customer_project_evidence SET status = 'deleted', updated_at = ?
      WHERE id = ? AND customer_uid = ? AND status = 'active'`).bind(now, id, user.uid),
    getD1().prepare(`INSERT INTO customer_project_evidence_events
      (id, evidence_id, project_id, customer_uid, installer_uid, actor_type, actor_uid, event_type, created_at)
      VALUES (?, ?, ?, ?, '', 'customer', ?, 'deleted', ?)`)
      .bind(crypto.randomUUID(), id, record.project_id, user.uid, user.uid, now),
  ]);
  return json({ ok: true });
}
