import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { hasAllowedSignature, sanitiseQuotingPhoto } from "@/lib/private-image-evidence";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
} from "@/lib/trade-access-server";

export const runtime = "edge";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);
const MEDIA_KINDS = new Set(["logo", "banner"]);

type EvidenceBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: BodyInit;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(key: string): Promise<void>;
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

function mediaKind(value: unknown) {
  const kind = typeof value === "string" ? value.trim() : "";
  return MEDIA_KINDS.has(kind) ? kind as "logo" | "banner" : null;
}

function getEvidenceBucket() {
  const bucket = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!bucket) throw new Error("Business branding storage is unavailable.");
  return bucket;
}

async function verifiedAccess(request: Request) {
  try {
    return await requireVerifiedTradeAccess(request, {
      partnerTypes: ["installer", "supplier"],
    });
  } catch (error) {
    const status = error instanceof TradeAccessError ? error.status : 403;
    const code = error instanceof TradeAccessError ? error.code : "TRADE_ACCESS_REQUIRED";
    return json({
      ok: false,
      code,
      error: error instanceof Error ? error.message : "Verified trade access is required.",
    }, status);
  }
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const access = await verifiedAccess(request);
  if (access instanceof Response) return access;
  const kind = mediaKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) return json({ ok: false, error: "Choose the logo or banner." }, 400);
  const keyColumn = kind === "logo" ? "logo_object_key" : "banner_object_key";
  const contentTypeColumn = kind === "logo" ? "logo_content_type" : "banner_content_type";
  const record = await getD1().prepare(`
    SELECT ${keyColumn} object_key, ${contentTypeColumn} content_type
    FROM trade_accounts
    WHERE firebase_uid = ?
  `).bind(access.firebaseUid).first<{ object_key: string; content_type: string }>();
  if (!record?.object_key) return json({ ok: false, error: "Business branding image not found." }, 404);
  const object = await getEvidenceBucket().get(record.object_key);
  if (!object) return json({ ok: false, error: "Stored business branding image not found." }, 404);
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="business-${kind}.${record.content_type === "image/png" ? "png" : "jpg"}"`,
      "Content-Type": object.httpMetadata?.contentType || record.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const access = await verifiedAccess(request);
  if (access instanceof Response) return access;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "The business branding upload could not be read." }, 400);
  }
  const kind = mediaKind(form.get("kind"));
  const file = form.get("file");
  if (!kind) return json({ ok: false, error: "Choose whether this image is the logo or banner." }, 400);
  if (!(file instanceof File) || !file.name) {
    return json({ ok: false, error: `Choose a ${kind} image to upload.` }, 400);
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return json({ ok: false, error: "Upload a JPEG or PNG image." }, 400);
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return json({ ok: false, error: "The branding image must be no larger than 3 MB." }, 400);
  }

  const originalBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasAllowedSignature(originalBytes, file.type, false)) {
    return json({
      ok: false,
      error: "The file contents do not match the selected JPEG or PNG image type.",
    }, 400);
  }
  const sanitised = sanitiseQuotingPhoto(originalBytes, file.type);
  if (!sanitised) {
    return json({
      ok: false,
      error: "The image metadata could not be removed safely. Export a fresh JPEG or PNG and try again.",
    }, 400);
  }
  const storedBytes = new Uint8Array(sanitised.byteLength);
  storedBytes.set(sanitised);
  const objectKey = `trade-branding/${access.firebaseUid}/${kind}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const bucket = getEvidenceBucket();
  await bucket.put(objectKey, storedBytes.buffer, {
    httpMetadata: { contentType: file.type },
    customMetadata: {
      ownerUid: access.firebaseUid,
      mediaKind: kind,
      uploadedAt: now,
      metadataPolicy: "stripped",
    },
  });

  const objectKeyColumn = kind === "logo" ? "logo_object_key" : "banner_object_key";
  const contentTypeColumn = kind === "logo" ? "logo_content_type" : "banner_content_type";
  try {
    const result = await getD1().prepare(`
      UPDATE trade_accounts
      SET ${objectKeyColumn} = ?, ${contentTypeColumn} = ?,
          settings_updated_at = ?, updated_at = ?
      WHERE firebase_uid = ? AND account_status = 'active'
    `).bind(objectKey, file.type, now, now, access.firebaseUid).run();
    if (!result.meta.changes) throw new Error("TRADE_ACCOUNT_NOT_ACTIVE");
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
  return json({
    ok: true,
    kind,
    contentType: file.type,
    sizeBytes: storedBytes.byteLength,
    mediaUrl: `/api/trade-profile-media?kind=${kind}`,
    updatedAt: now,
  }, 201);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const access = await verifiedAccess(request);
  if (access instanceof Response) return access;
  let raw: { kind?: unknown };
  try {
    raw = await request.json() as { kind?: unknown };
  } catch {
    return json({ ok: false, error: "The branding removal request could not be read." }, 400);
  }
  const kind = mediaKind(raw.kind);
  if (!kind) return json({ ok: false, error: "Choose the logo or banner." }, 400);
  const objectKeyColumn = kind === "logo" ? "logo_object_key" : "banner_object_key";
  const contentTypeColumn = kind === "logo" ? "logo_content_type" : "banner_content_type";
  const now = new Date().toISOString();
  await getD1().prepare(`
    UPDATE trade_accounts
    SET ${objectKeyColumn} = '', ${contentTypeColumn} = '',
        settings_updated_at = ?, updated_at = ?
    WHERE firebase_uid = ? AND account_status = 'active'
  `).bind(now, now, access.firebaseUid).run();

  // The old immutable object is deliberately retained. Issued quote snapshots
  // can continue to resolve the exact branding bytes used when they were sent.
  return json({ ok: true, kind, hasMedia: false, updatedAt: now });
}
