import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";

export const runtime = "edge";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const ROLE_CATEGORIES = {
  installer: new Set(["business-registration", "trade-licence", "insurance", "scheme-approval"]),
  supplier: new Set(["business-registration", "product-compliance", "warranty", "australian-support"]),
};

type EvidenceBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

type DocumentRecord = {
  id: string;
  firebase_uid: string;
  category: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  expiry_date: string;
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
  if (!bucket) throw new Error("Verification storage is unavailable.");
  return bucket;
}

async function identityOrResponse(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

function safeDownloadName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "verification-evidence";
}

function publicRecord(record: DocumentRecord) {
  return {
    id: record.id,
    category: record.category,
    fileName: record.file_name,
    contentType: record.content_type,
    sizeBytes: record.size_bytes,
    expiryDate: record.expiry_date,
    status: record.status,
    createdAt: record.created_at,
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);

  const downloadId = new URL(request.url).searchParams.get("download");
  if (downloadId) {
    const record = await getD1().prepare(`
      SELECT id, firebase_uid, category, file_name, content_type, size_bytes,
             object_key, expiry_date, status, created_at
      FROM verification_documents
      WHERE id = ? AND firebase_uid = ?
    `).bind(downloadId, identity.uid).first<DocumentRecord>();
    if (!record) return json({ ok: false, error: "Document not found." }, 404);

    const object = await getEvidenceBucket().get(record.object_key);
    if (!object) return json({ ok: false, error: "Stored document not found." }, 404);
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${safeDownloadName(record.file_name)}"`,
        "Content-Type": object.httpMetadata?.contentType || record.content_type,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const result = await getD1().prepare(`
    SELECT id, firebase_uid, category, file_name, content_type, size_bytes,
           object_key, expiry_date, status, created_at
    FROM verification_documents
    WHERE firebase_uid = ?
    ORDER BY created_at DESC
  `).bind(identity.uid).all<DocumentRecord>();
  return json({ ok: true, documents: (result.results || []).map(publicRecord) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);

  const account = await getD1().prepare(`
    SELECT partner_type FROM trade_accounts WHERE firebase_uid = ?
  `).bind(identity.uid).first<{ partner_type: string }>();
  if (!account) return json({ ok: false, error: "Complete the business profile first." }, 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "The upload could not be read." }, 400);
  }

  const file = form.get("file");
  const category = String(form.get("category") || "");
  const expiryDate = String(form.get("expiryDate") || "").trim();
  const role = account.partner_type === "supplier" ? "supplier" : "installer";
  if (!(file instanceof File) || !file.name) return json({ ok: false, error: "Choose a document to upload." }, 400);
  if (!ROLE_CATEGORIES[role].has(category)) return json({ ok: false, error: "Choose a valid evidence category." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "Upload a PDF, JPEG or PNG file." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return json({ ok: false, error: "The document must be no larger than 8 MB." }, 400);
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return json({ ok: false, error: "Choose a valid expiry date." }, 400);

  const id = crypto.randomUUID();
  const objectKey = `verification/${identity.uid}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const bucket = getEvidenceBucket();
  await bucket.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { owner: identity.uid, documentId: id },
  });

  try {
    await getD1().prepare(`
      INSERT INTO verification_documents (
        id, firebase_uid, category, file_name, content_type, size_bytes,
        object_key, expiry_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)
    `).bind(id, identity.uid, category, file.name.slice(0, 180), file.type, file.size, objectKey, expiryDate, now, now).run();
    await getD1().prepare(`
      UPDATE trade_accounts
      SET verification_status = CASE
        WHEN verification_status IN ('approved', 'submitted') THEN verification_status
        ELSE 'evidence_started'
      END, updated_at = ?
      WHERE firebase_uid = ?
    `).bind(now, identity.uid).run();
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }

  return json({ ok: true, document: publicRecord({ id, firebase_uid: identity.uid, category, file_name: file.name.slice(0, 180), content_type: file.type, size_bytes: file.size, object_key: objectKey, expiry_date: expiryDate, status: "uploaded", created_at: now }) }, 201);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  const record = await getD1().prepare(`
    SELECT id, firebase_uid, category, file_name, content_type, size_bytes,
           object_key, expiry_date, status, created_at
    FROM verification_documents
    WHERE id = ? AND firebase_uid = ?
  `).bind(id, identity.uid).first<DocumentRecord>();
  if (!record) return json({ ok: false, error: "Document not found." }, 404);

  await getEvidenceBucket().delete(record.object_key);
  await getD1().prepare(`DELETE FROM verification_documents WHERE id = ? AND firebase_uid = ?`).bind(id, identity.uid).run();
  const remaining = await getD1().prepare(`SELECT COUNT(*) AS total FROM verification_documents WHERE firebase_uid = ?`).bind(identity.uid).first<{ total: number }>();
  if (!remaining?.total) {
    await getD1().prepare(`
      UPDATE trade_accounts
      SET verification_status = CASE
        WHEN verification_status IN ('approved', 'submitted') THEN verification_status
        ELSE 'not_started'
      END, updated_at = ?
      WHERE firebase_uid = ?
    `).bind(new Date().toISOString(), identity.uid).run();
  }
  return json({ ok: true });
}
