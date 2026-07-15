import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { accountEntitlements } from "@/lib/direct-trade-entitlements-server";
import { HANDOVER_DOCUMENT_CATEGORIES } from "@/lib/trade-handover.mjs";
import { requireAdminIdentity, writeAdminAudit } from "@/lib/admin-server";
import { canCustomerAccessHandover } from "@/lib/customer-asset-ownership-server";

export const runtime = "edge";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const DOCUMENT_CATEGORIES = new Set(HANDOVER_DOCUMENT_CATEGORIES.map((item: string[]) => item[0]));
const EDITABLE_PACK_STATUSES = new Set(["draft", "changes_requested"]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

type EvidenceBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

type DocumentAccessRecord = {
  id: string;
  file_name: string;
  content_type: string;
  object_key: string;
  customer_visible: number;
  pack_status: string;
  handover_pack_id: string;
  owner_uid: string;
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
  if (!bucket) throw new Error("Handover document storage is unavailable.");
  return bucket;
}

function safeDownloadName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "handover-document";
}

async function identityOrResponse(request: Request) {
  try { return await requireFirebaseIdentity(request); }
  catch { return null; }
}

async function editableInstallerPack(firebaseUid: string, workOrderId: string) {
  const account = await getD1().prepare(`SELECT partner_type, account_status, billing_status
    FROM trade_accounts WHERE firebase_uid = ?`).bind(firebaseUid).first<Record<string, unknown>>();
  if (!account || account.account_status !== "active" || account.partner_type !== "installer") return null;
  const entitlements = await accountEntitlements(firebaseUid, "installer", account.billing_status);
  if (!entitlements.features.business_operations) throw new Error("FULL_ACCESS_REQUIRED");
  return getD1().prepare(`SELECT p.id, p.status, p.work_order_id
    FROM trade_handover_packs p
    JOIN trade_work_orders w ON w.id = p.work_order_id
    WHERE p.work_order_id = ? AND p.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
    .bind(workOrderId, firebaseUid, firebaseUid).first<{ id: string; status: string; work_order_id: string }>();
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  const documentId = new URL(request.url).searchParams.get("download") || "";
  if (!documentId) return json({ ok: false, error: "Choose a handover document." }, 400);
  const record = await getD1().prepare(`SELECT d.id, d.file_name, d.content_type, d.object_key,
    d.customer_visible, p.status pack_status, p.id handover_pack_id, p.firebase_uid owner_uid
    FROM trade_handover_documents d
    JOIN trade_handover_packs p ON p.id = d.handover_pack_id
    WHERE d.id = ?`).bind(documentId).first<DocumentAccessRecord>();
  if (!record) return json({ ok: false, error: "Handover document not found." }, 404);
  const ownerAccess = record.owner_uid === identity.uid;
  const customerAccess = record.pack_status === "published" && Boolean(record.customer_visible)
    && await canCustomerAccessHandover(identity.uid, record.handover_pack_id);
  let adminAccess = false;
  if (!ownerAccess && !customerAccess) {
    try {
      const admin = await requireAdminIdentity(request);
      adminAccess = true;
      await writeAdminAudit(admin, "handover.document_download", "trade_handover_document", record.id,
        `Downloaded protected handover document ${record.file_name}.`);
    } catch {
      return json({ ok: false, error: "Handover document access was not accepted." }, 403);
    }
  }
  if (!ownerAccess && !customerAccess && !adminAccess) return json({ ok: false, error: "Handover document access was not accepted." }, 403);
  const object = await getEvidenceBucket().get(record.object_key);
  if (!object) return json({ ok: false, error: "Stored handover document not found." }, 404);
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${safeDownloadName(record.file_name)}"`,
      "Content-Type": object.httpMetadata?.contentType || record.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  let form: FormData;
  try { form = await request.formData(); }
  catch { return json({ ok: false, error: "The handover upload could not be read." }, 400); }
  const workOrderId = String(form.get("workOrderId") || "").trim().slice(0, 180);
  const category = String(form.get("category") || "").trim();
  const customerVisible = String(form.get("customerVisible") || "true") !== "false";
  const file = form.get("file");
  let pack: Awaited<ReturnType<typeof editableInstallerPack>>;
  try { pack = await editableInstallerPack(identity.uid, workOrderId); }
  catch (error) {
    return json({ ok: false, error: error instanceof Error && error.message === "FULL_ACCESS_REQUIRED"
      ? "Handover documents require paid Business Hub access or an administrator grant."
      : "The handover pack could not be opened." }, 403);
  }
  if (!pack) return json({ ok: false, error: "Start a valid installer handover pack first." }, 404);
  if (!EDITABLE_PACK_STATUSES.has(pack.status)) return json({ ok: false, error: "This handover is locked while it is under review or already published." }, 409);
  if (!(file instanceof File) || !file.name) return json({ ok: false, error: "Choose a handover document to upload." }, 400);
  if (EMAIL_PATTERN.test(file.name)) return json({ ok: false, error: "Remove customer email addresses from the handover filename before uploading." }, 400);
  if (!DOCUMENT_CATEGORIES.has(category)) return json({ ok: false, error: "Choose a valid handover document category." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: "Upload a PDF, JPEG or PNG file." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return json({ ok: false, error: "The document must be no larger than 8 MB." }, 400);

  const id = crypto.randomUUID();
  const objectKey = `handovers/${identity.uid}/${pack.id}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const bucket = getEvidenceBucket();
  await bucket.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { owner: identity.uid, handoverPackId: pack.id, documentId: id },
  });
  try {
    await getD1().batch([
      getD1().prepare(`INSERT INTO trade_handover_documents
        (id, handover_pack_id, work_order_id, firebase_uid, category, file_name, content_type,
         size_bytes, object_key, customer_visible, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, pack.id, workOrderId, identity.uid, category, file.name.slice(0, 180), file.type,
          file.size, objectKey, customerVisible ? 1 : 0, now, now),
      getD1().prepare("UPDATE trade_handover_packs SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(now, pack.id, identity.uid),
      getD1().prepare(`INSERT INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'handover_document_added', ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, identity.uid, `${category.replaceAll("-", " ")} added to the handover record.`, now),
    ]);
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
  return json({ ok: true, document: {
    id,
    category,
    fileName: file.name.slice(0, 180),
    contentType: file.type,
    sizeBytes: file.size,
    customerVisible,
    createdAt: now,
  } }, 201);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const identity = await identityOrResponse(request);
  if (!identity) return json({ ok: false, error: "Sign in to continue." }, 401);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const workOrderId = url.searchParams.get("workOrderId") || "";
  let pack: Awaited<ReturnType<typeof editableInstallerPack>>;
  try { pack = await editableInstallerPack(identity.uid, workOrderId); }
  catch { return json({ ok: false, error: "Handover document access was not accepted." }, 403); }
  if (!pack) return json({ ok: false, error: "Handover pack not found." }, 404);
  if (!EDITABLE_PACK_STATUSES.has(pack.status)) return json({ ok: false, error: "This handover is locked while it is under review or already published." }, 409);
  const record = await getD1().prepare(`SELECT id, object_key FROM trade_handover_documents
    WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ?`)
    .bind(id, pack.id, identity.uid).first<{ id: string; object_key: string }>();
  if (!record) return json({ ok: false, error: "Handover document not found." }, 404);
  await getEvidenceBucket().delete(record.object_key);
  const now = new Date().toISOString();
  await getD1().batch([
    getD1().prepare("DELETE FROM trade_handover_documents WHERE id = ? AND handover_pack_id = ? AND firebase_uid = ?")
      .bind(id, pack.id, identity.uid),
    getD1().prepare("UPDATE trade_handover_packs SET updated_at = ? WHERE id = ? AND firebase_uid = ?")
      .bind(now, pack.id, identity.uid),
  ]);
  return json({ ok: true });
}
