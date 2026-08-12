import { getD1 } from "../../../../db";
import { getCustomerProjectEvidenceBucket as getEvidenceBucket } from "@/lib/customer-project-evidence-bucket";
import { accountHasFeature } from "@/lib/direct-trade-entitlements-server";
import {
  hasAllowedSignature,
  privateImageDimensions,
  sanitiseQuotingPhoto,
} from "@/lib/private-image-evidence";
import {
  PUBLIC_PLAN_QUOTE_ALLOWED_TYPES,
  PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES,
  PUBLIC_PLAN_QUOTE_MAX_FILES,
  PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION,
  PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS,
  PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES,
  PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
  PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  publicPlanQuoteCategoryIntersection,
  publicPlanQuotePhotoReplayDecision,
  publicPlanQuotePromptSnapshot,
  publicPlanQuoteUploadKeyHashMatches,
  publicPlanQuoteUploadRateDecision,
  publicPlanQuoteWithdrawalDecision,
  validPublicPlanQuoteClientUploadId,
  validPublicPlanQuoteUploadReference,
} from "@/lib/public-plan-quote-preparation.mjs";
import {
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
} from "@/lib/public-plan-enquiry.mjs";
import { drainPublicPlanQuotePhotoCleanup } from "@/lib/public-plan-quote-photo-cleanup";
import {
  requireVerifiedTradeAccess,
  TradeAccessError,
  verifiedTradeAccountPredicate,
} from "@/lib/trade-access-server";

export const runtime = "edge";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_OVERHEAD_BYTES = 64 * 1024;
const UPLOAD_RATE_LIMIT = PUBLIC_PLAN_QUOTE_MAX_FILES * 2;
const PREAUTH_RATE_LIMIT = PUBLIC_PLAN_QUOTE_MAX_FILES * 4;
const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
const UPLOAD_RATE_MAX_WRITE_ATTEMPTS = 12;
const INVALID_UPLOAD_KEY_HASH = "0".repeat(64);
const MULTIPART_CONTENT_TYPE_PATTERN =
  /^multipart\/form-data\s*;\s*boundary=(?:"[^"\r\n]{1,70}"|[0-9A-Za-z'()+_,\-./:=?]{1,70})$/i;
const CURRENT_QUOTE_ACCESS_EXISTS_SQL = `EXISTS (
  SELECT 1
  FROM public_trade_lead_quote_preparations current_preparation
  JOIN trade_opportunities current_opportunity
    ON current_opportunity.id = current_preparation.opportunity_id
    AND current_opportunity.source_reference = current_preparation.source_reference
    AND current_opportunity.status IN ('open', 'paused')
  JOIN public_trade_lead_contact_releases current_contact
    ON current_contact.opportunity_id = current_opportunity.id
    AND current_contact.source_reference = current_opportunity.source_reference
    AND current_contact.status = 'active'
    AND current_contact.notice_version = ?
    AND current_contact.consent_purpose = ?
    AND datetime(current_contact.granted_at) IS NOT NULL
    AND current_contact.withdrawn_at = ''
  WHERE current_preparation.id = ?
    AND current_preparation.opportunity_id = ?
    AND current_preparation.source_reference = ?
    AND current_preparation.upload_key_hash = ?
    AND current_preparation.status = 'active'
    AND current_preparation.notice_version = ?
    AND current_preparation.consent_purpose = ?
    AND datetime(current_preparation.granted_at) IS NOT NULL
)`;

type PreparationRow = {
  id: string;
  opportunity_id: string;
  source_reference: string;
  photo_prompt_ids: string;
  expected_photo_count: number;
  upload_key_hash: string;
  service_categories: string;
};

type WithdrawalPreparationRow = PreparationRow & {
  status: "active" | "withdrawn";
  withdrawn_at: string;
};

type PhotoRow = {
  id: string;
  opportunity_id: string;
  client_upload_id: string;
  prompt_id: string;
  prompt_label: string;
  service_categories: string;
  content_type: string;
  size_bytes: number;
  object_key: string;
  sha256: string;
  privacy_status: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type UploadRateResult = {
  allowed: boolean;
  unavailable?: boolean;
  retryAfterSeconds?: number;
};

function currentQuoteAccessBindings(preparation: PreparationRow) {
  return [
    PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    PUBLIC_PLAN_CONSENT_PURPOSE,
    preparation.id,
    preparation.opportunity_id,
    preparation.source_reference,
    preparation.upload_key_hash,
    PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
    PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
  ] as const;
}

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sameOrigin(request: Request, required = false) {
  const origin = request.headers.get("origin");
  return (!required && !origin) || origin === new URL(request.url).origin;
}

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "local";
}

function exactArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const digest = await crypto.subtle.digest("SHA-256", exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function parseStringList(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

async function checkUploadRateLimit(
  request: Request,
  sourceReference: string,
  uploadKey: string,
  scope: "source" | "client",
  limit = UPLOAD_RATE_LIMIT,
): Promise<UploadRateResult> {
  const now = Date.now();
  const clientSourceHash = await sha256Hex(
    `public-plan-quote-photo:${sourceReference}:${uploadKey}:${scope === "source" ? "all-clients" : clientAddress(request)}`,
  );
  const db = getD1();
  for (let attempt = 0; attempt < UPLOAD_RATE_MAX_WRITE_ATTEMPTS; attempt += 1) {
    const row = await db.prepare(`SELECT timestamps, version
      FROM public_trade_lead_quote_upload_limits
      WHERE client_source_hash = ?`)
      .bind(clientSourceHash)
      .first<{ timestamps: string; version: number }>();
    let timestamps: unknown = [];
    if (row) {
      try {
        timestamps = JSON.parse(row.timestamps);
      } catch {
        return { allowed: false, unavailable: true };
      }
    }
    const decision = publicPlanQuoteUploadRateDecision(timestamps, now, {
      limit,
      windowMs: UPLOAD_RATE_WINDOW_MS,
    });
    if (!decision.allowed) return decision;
    const nextTimestamps = JSON.stringify(decision.nextTimestamps);
    const write = row
      ? await db.prepare(`UPDATE public_trade_lead_quote_upload_limits
          SET timestamps = ?, version = version + 1, updated_at = ?
          WHERE client_source_hash = ? AND version = ?`)
        .bind(nextTimestamps, now, clientSourceHash, row.version)
        .run()
      : await db.prepare(`INSERT OR IGNORE INTO public_trade_lead_quote_upload_limits
          (client_source_hash, timestamps, version, updated_at)
          VALUES (?, ?, 0, ?)`)
        .bind(clientSourceHash, nextTimestamps, now)
        .run();
    if (Number(write.meta.changes || 0) === 1) {
      await db.prepare(`DELETE FROM public_trade_lead_quote_upload_limits
        WHERE updated_at < ?`)
        .bind(now - (UPLOAD_RATE_WINDOW_MS * 2))
        .run()
        .catch(() => undefined);
      return { allowed: true };
    }
  }
  return { allowed: false, unavailable: true };
}

function publicPhoto(record: PhotoRow) {
  return {
    id: record.id,
    clientUploadId: record.client_upload_id,
    promptId: record.prompt_id,
    promptLabel: record.prompt_label,
    serviceCategories: parseStringList(record.service_categories),
    contentType: record.content_type,
    sizeBytes: Number(record.size_bytes),
    privacyStatus: record.privacy_status,
    createdAt: record.created_at,
  };
}

async function deleteTombstonedPhotoObject(photo: PhotoRow) {
  const db = getD1();
  try {
    await getEvidenceBucket().delete(photo.object_key);
  } catch {
    await db.prepare(`UPDATE public_trade_lead_quote_photos
      SET updated_at = ?
      WHERE id = ? AND status = 'deleted' AND object_key = ?`)
      .bind(new Date().toISOString(), photo.id, photo.object_key)
      .run()
      .catch(() => undefined);
    return false;
  }
  const purgedAt = new Date().toISOString();
  const purged = await db.prepare(`UPDATE public_trade_lead_quote_photos
    SET status = 'purged', updated_at = ?
    WHERE id = ? AND status = 'deleted' AND object_key = ?`)
    .bind(purgedAt, photo.id, photo.object_key)
    .run();
  return Number(purged.meta.changes || 0) === 1;
}

async function deletePurgedPhotoObject(photo: PhotoRow) {
  try {
    await getEvidenceBucket().delete(photo.object_key);
    return true;
  } catch {
    await getD1().prepare(`UPDATE public_trade_lead_quote_photos
      SET updated_at = ?
      WHERE id = ? AND status = 'purged' AND object_key = ?`)
      .bind(new Date().toISOString(), photo.id, photo.object_key)
      .run()
      .catch(() => undefined);
    return false;
  }
}

async function tombstonePhotoAndDeleteObject(
  photo: PhotoRow,
  allowedStatuses: readonly string[],
) {
  const placeholders = allowedStatuses.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const cleanupClientUploadId = `cleanup.${crypto.randomUUID()}`;
  const tombstoned = await getD1().prepare(`UPDATE public_trade_lead_quote_photos
    SET status = 'deleted', client_upload_id = ?, updated_at = ?
    WHERE id = ? AND object_key = ? AND status IN (${placeholders})`)
    .bind(cleanupClientUploadId, now, photo.id, photo.object_key, ...allowedStatuses)
    .run()
    .catch(() => null);
  if (Number(tombstoned?.meta.changes || 0) === 1) {
    return deleteTombstonedPhotoObject({
      ...photo,
      status: "deleted",
      updated_at: now,
    });
  }
  return false;
}

async function cleanupExpiredPendingPhotos() {
  await drainPublicPlanQuotePhotoCleanup({
    db: getD1(),
    bucket: getEvidenceBucket(),
    limit: 20,
  });
}

async function deleteUnreferencedPhotoObject(photo: PhotoRow) {
  const db = getD1();
  let current: PhotoRow | null;
  try {
    current = await db.prepare(`SELECT *
      FROM public_trade_lead_quote_photos
      WHERE object_key = ?
      LIMIT 1`)
      .bind(photo.object_key)
      .first<PhotoRow>();
  } catch {
    return false;
  }
  if (current?.status === "active") return false;
  if (current?.status === "pending") {
    return tombstonePhotoAndDeleteObject(current, ["pending"]);
  }
  if (current?.status === "deleted") {
    return deleteTombstonedPhotoObject(current);
  }
  if (current?.status === "purged") {
    return deletePurgedPhotoObject(current);
  }

  const now = new Date().toISOString();
  try {
    await db.prepare(`INSERT OR IGNORE INTO public_trade_lead_quote_photos
      (id, opportunity_id, client_upload_id, prompt_id, prompt_label,
       service_categories, content_type, size_bytes, object_key, sha256,
       privacy_status, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deleted', ?, ?)`)
      .bind(
        crypto.randomUUID(),
        photo.opportunity_id,
        `cleanup.${crypto.randomUUID()}`,
        photo.prompt_id,
        photo.prompt_label,
        photo.service_categories,
        photo.content_type,
        photo.size_bytes,
        photo.object_key,
        photo.sha256,
        photo.privacy_status,
        photo.created_at || now,
        now,
      )
      .run();
    current = await db.prepare(`SELECT *
      FROM public_trade_lead_quote_photos
      WHERE object_key = ?
      LIMIT 1`)
      .bind(photo.object_key)
      .first<PhotoRow>();
  } catch {
    return false;
  }
  if (current?.status === "deleted") {
    return deleteTombstonedPhotoObject(current);
  }
  if (current?.status === "purged") return deletePurgedPhotoObject(current);
  if (!current) {
    try {
      await getEvidenceBucket().delete(photo.object_key);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function deletePendingPhotoAndObject(photo: PhotoRow) {
  if (await tombstonePhotoAndDeleteObject(photo, ["pending"])) return true;
  return deleteUnreferencedPhotoObject(photo);
}

async function revokePhotoAndObject(photo: PhotoRow) {
  if (await tombstonePhotoAndDeleteObject(photo, ["pending", "active"])) return true;
  return deleteUnreferencedPhotoObject(photo);
}

async function cleanupWithdrawnPhoto(photo: PhotoRow) {
  if (photo.status === "purged") {
    await deletePurgedPhotoObject(photo);
    return false;
  }
  if (photo.status === "deleted") {
    return deleteTombstonedPhotoObject(photo);
  }
  if (await revokePhotoAndObject(photo)) return true;
  const current = await getD1().prepare(`SELECT *
    FROM public_trade_lead_quote_photos
    WHERE id = ? AND opportunity_id = ?
    LIMIT 1`)
    .bind(photo.id, photo.opportunity_id)
    .first<PhotoRow>();
  if (!current) return true;
  if (current.status === "deleted") {
    return deleteTombstonedPhotoObject(current);
  }
  return false;
}

async function activePreparation(sourceReference: string) {
  return getD1().prepare(`SELECT preparation.*, opportunity.service_categories
    FROM public_trade_lead_quote_preparations preparation
    JOIN trade_opportunities opportunity
      ON opportunity.id = preparation.opportunity_id
      AND opportunity.source_reference = preparation.source_reference
    JOIN public_trade_lead_contact_releases contact
      ON contact.opportunity_id = opportunity.id
      AND contact.source_reference = opportunity.source_reference
      AND contact.status = 'active'
      AND contact.notice_version = ?
      AND contact.consent_purpose = ?
      AND datetime(contact.granted_at) IS NOT NULL
      AND contact.withdrawn_at = ''
    WHERE preparation.source_reference = ?
      AND preparation.status = 'active'
      AND preparation.notice_version = ?
      AND preparation.consent_purpose = ?
      AND datetime(preparation.granted_at) IS NOT NULL
      AND opportunity.status IN ('open', 'paused')
    LIMIT 1`)
    .bind(
      PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
      PUBLIC_PLAN_CONSENT_PURPOSE,
      sourceReference,
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
    )
    .first<PreparationRow>();
}

async function preparationForWithdrawal(sourceReference: string) {
  return getD1().prepare(`SELECT preparation.*, opportunity.service_categories
    FROM public_trade_lead_quote_preparations preparation
    JOIN trade_opportunities opportunity
      ON opportunity.id = preparation.opportunity_id
      AND opportunity.source_reference = preparation.source_reference
    WHERE preparation.source_reference = ?
      AND preparation.status IN ('active', 'withdrawn')
    LIMIT 1`)
    .bind(sourceReference)
    .first<WithdrawalPreparationRow>();
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request, true)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const sourceReference = request.headers.get("x-quote-source-reference")?.trim() || "";
  const uploadKey = request.headers.get("x-quote-upload-key")?.trim() || "";
  if (!validPublicPlanQuoteUploadReference(sourceReference, uploadKey)) {
    return json({ ok: false, error: "The private quote removal reference was invalid." }, 400);
  }
  let preAuthRateLimit: UploadRateResult;
  try {
    preAuthRateLimit = await checkUploadRateLimit(
      request,
      "public-photo-upload",
      "pre-auth",
      "client",
      PREAUTH_RATE_LIMIT,
    );
  } catch {
    preAuthRateLimit = { allowed: false, unavailable: true };
  }
  if (!preAuthRateLimit.allowed) {
    if (preAuthRateLimit.unavailable) {
      return json({ ok: false, error: "Quote detail removal is temporarily unavailable. Try again later." }, 503);
    }
    return Response.json(
      { ok: false, error: "Too many quote detail removal attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(preAuthRateLimit.retryAfterSeconds || 3600),
        },
      },
    );
  }
  const suppliedKeyHash = await sha256Hex(uploadKey);
  let preparation = await preparationForWithdrawal(sourceReference);
  const decision = publicPlanQuoteWithdrawalDecision({
    status: preparation?.status,
    suppliedKeyHash,
    storedKeyHash: preparation?.upload_key_hash || INVALID_UPLOAD_KEY_HASH,
  });
  if (!preparation || decision === "reject") {
    return json({ ok: false, error: "The private quote removal reference was not accepted." }, 403);
  }
  await cleanupExpiredPendingPhotos().catch(() => undefined);
  let alreadyWithdrawn = decision === "already-withdrawn";
  if (decision === "withdraw") {
    const now = new Date().toISOString();
    const withdrawn = await getD1().prepare(`UPDATE public_trade_lead_quote_preparations
      SET status = 'withdrawn', withdrawn_at = ?, question_answers = '[]',
        photo_prompt_ids = '[]', expected_photo_count = 0, updated_at = ?
      WHERE id = ? AND source_reference = ? AND status = 'active'
        AND upload_key_hash = ?`)
      .bind(now, now, preparation.id, sourceReference, suppliedKeyHash)
      .run();
    if (Number(withdrawn.meta.changes || 0) !== 1) {
      preparation = await preparationForWithdrawal(sourceReference);
      const racedDecision = publicPlanQuoteWithdrawalDecision({
        status: preparation?.status,
        suppliedKeyHash,
        storedKeyHash: preparation?.upload_key_hash || INVALID_UPLOAD_KEY_HASH,
      });
      if (!preparation || racedDecision !== "already-withdrawn") {
        return json({ ok: false, error: "The private quote details could not be removed. Try again." }, 409);
      }
      alreadyWithdrawn = true;
    } else {
      preparation = { ...preparation, status: "withdrawn", withdrawn_at: now };
    }
  }
  const photos = await getD1().prepare(`SELECT *
    FROM public_trade_lead_quote_photos
    WHERE opportunity_id = ? AND status IN ('pending', 'active', 'deleted', 'purged')
    ORDER BY created_at
    LIMIT ?`)
    .bind(preparation.opportunity_id, PUBLIC_PLAN_QUOTE_MAX_FILES)
    .all<PhotoRow>();
  for (const photo of photos.results) {
    await cleanupWithdrawnPhoto(photo);
  }
  const remainingCleanup = await getD1().prepare(`SELECT COUNT(*) total
    FROM public_trade_lead_quote_photos
    WHERE opportunity_id = ? AND status IN ('pending', 'active', 'deleted', 'purged')`)
    .bind(preparation.opportunity_id)
    .first<{ total: number }>();
  const cleanupPending = Math.max(0, Number(remainingCleanup?.total || 0));
  return json({
    ok: true,
    alreadyWithdrawn,
    cleanupPending,
  }, cleanupPending ? 202 : 200);
}

export async function POST(request: Request) {
  if (!sameOrigin(request, true)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const contentType = request.headers.get("content-type")?.trim() || "";
  if (!MULTIPART_CONTENT_TYPE_PATTERN.test(contentType)) {
    return json({ ok: false, error: "Quote photos must be uploaded as form data." }, 415);
  }
  const declaredLengthHeader = request.headers.get("content-length")?.trim() || "";
  if (!declaredLengthHeader) {
    return json({ ok: false, error: "The quote photo upload length is required." }, 411);
  }
  if (!/^\d+$/.test(declaredLengthHeader)) {
    return json({ ok: false, error: "The quote photo upload length was invalid." }, 400);
  }
  const declaredLength = Number(declaredLengthHeader);
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
    return json({ ok: false, error: "The quote photo upload length was invalid." }, 400);
  }
  if (declaredLength > PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES + REQUEST_OVERHEAD_BYTES) {
    return json({ ok: false, error: "Each quote photo must be no larger than 8 MB." }, 413);
  }
  const headerSourceReference = request.headers.get("x-quote-source-reference")?.trim() || "";
  const headerUploadKey = request.headers.get("x-quote-upload-key")?.trim() || "";
  if (!validPublicPlanQuoteUploadReference(headerSourceReference, headerUploadKey)) {
    return json({ ok: false, error: "The private quote photo upload reference was invalid." }, 400);
  }
  let preAuthRateLimit: UploadRateResult;
  try {
    preAuthRateLimit = await checkUploadRateLimit(
      request,
      "public-photo-upload",
      "pre-auth",
      "client",
      PREAUTH_RATE_LIMIT,
    );
  } catch {
    preAuthRateLimit = { allowed: false, unavailable: true };
  }
  if (!preAuthRateLimit.allowed) {
    if (preAuthRateLimit.unavailable) {
      return json({ ok: false, error: "Quote photo uploads are temporarily unavailable. Try again later." }, 503);
    }
    return Response.json(
      { ok: false, error: "Too many quote photo upload attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(preAuthRateLimit.retryAfterSeconds || 3600),
        },
      },
    );
  }
  const preparation = await activePreparation(headerSourceReference);
  const suppliedKeyHash = await sha256Hex(headerUploadKey);
  const uploadKeyAccepted = publicPlanQuoteUploadKeyHashMatches(
    suppliedKeyHash,
    preparation?.upload_key_hash || INVALID_UPLOAD_KEY_HASH,
  );
  if (!preparation || !uploadKeyAccepted) {
    return json({ ok: false, error: "The private quote photo upload reference was not accepted." }, 403);
  }
  let sourceRateLimit: UploadRateResult;
  let clientRateLimit: UploadRateResult;
  try {
    sourceRateLimit = await checkUploadRateLimit(
      request,
      headerSourceReference,
      headerUploadKey,
      "source",
    );
    clientRateLimit = sourceRateLimit.allowed
      ? await checkUploadRateLimit(
        request,
        headerSourceReference,
        headerUploadKey,
        "client",
      )
      : sourceRateLimit;
  } catch {
    sourceRateLimit = { allowed: false, unavailable: true };
    clientRateLimit = sourceRateLimit;
  }
  const rateLimit = !sourceRateLimit.allowed ? sourceRateLimit : clientRateLimit;
  if (!rateLimit.allowed) {
    if (rateLimit.unavailable) {
      return json({ ok: false, error: "Quote photo uploads are temporarily unavailable. Try again later." }, 503);
    }
    return Response.json(
      { ok: false, error: "Too many quote photo upload attempts. Try again later." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateLimit.retryAfterSeconds || 3600),
        },
      },
    );
  }
  await cleanupExpiredPendingPhotos().catch(() => undefined);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "The quote photo could not be read." }, 400);
  }
  const sourceReference = String(form.get("sourceReference") || "").trim();
  const uploadKey = String(form.get("uploadKey") || "").trim();
  const clientUploadId = String(form.get("clientUploadId") || "").trim();
  const promptId = String(form.get("promptId") || "").trim();
  const file = form.get("file");
  if (
    !validPublicPlanQuoteUploadReference(sourceReference, uploadKey)
    || sourceReference !== headerSourceReference
    || uploadKey !== headerUploadKey
  ) {
    return json({ ok: false, error: "The private quote photo upload reference was invalid." }, 400);
  }
  if (!validPublicPlanQuoteClientUploadId(clientUploadId)) {
    return json({ ok: false, error: "Choose the quote photo again before uploading." }, 400);
  }
  if (!(file instanceof File) || !file.name) {
    return json({ ok: false, error: "Choose a quote photo to upload." }, 400);
  }
  const allowedPromptIds = parseStringList(preparation.photo_prompt_ids);
  const serviceCategories = parseStringList(preparation.service_categories);
  const prompt = allowedPromptIds.includes(promptId)
    ? publicPlanQuotePromptSnapshot(promptId, serviceCategories)
    : null;
  if (!prompt) {
    return json({ ok: false, error: "Choose a photo requested for the selected services." }, 400);
  }
  if (!PUBLIC_PLAN_QUOTE_ALLOWED_TYPES.includes(file.type)) {
    return json({ ok: false, error: "Upload a JPEG or PNG quote photo." }, 400);
  }
  if (file.size <= 0 || file.size > PUBLIC_PLAN_QUOTE_MAX_FILE_BYTES) {
    return json({ ok: false, error: "Each quote photo must be no larger than 8 MB." }, 400);
  }
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  if (!hasAllowedSignature(originalBytes, file.type, false)) {
    return json({ ok: false, error: "The file contents do not match the selected image type." }, 400);
  }
  const dimensions = privateImageDimensions(originalBytes, file.type);
  if (!dimensions) {
    return json({ ok: false, error: "The selected file is not a readable JPEG or PNG image." }, 400);
  }
  if (
    dimensions.width > PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION
    || dimensions.height > PUBLIC_PLAN_QUOTE_MAX_IMAGE_DIMENSION
    || dimensions.width * dimensions.height > PUBLIC_PLAN_QUOTE_MAX_IMAGE_PIXELS
  ) {
    return json({ ok: false, error: "Choose a photo no larger than 8,192 pixels on either side or 25 megapixels." }, 400);
  }
  const storedBytes = sanitiseQuotingPhoto(originalBytes, file.type);
  if (!storedBytes) {
    return json({ ok: false, error: "This photo could not be stored without private location metadata. Convert it to JPEG and try again." }, 400);
  }
  const storedHash = await sha256Hex(storedBytes);
  const db = getD1();
  let photo = await db.prepare(`SELECT *
    FROM public_trade_lead_quote_photos
    WHERE opportunity_id = ? AND client_upload_id = ?
    LIMIT 1`)
    .bind(preparation.opportunity_id, clientUploadId)
    .first<PhotoRow>();
  if (photo) {
    const replayDecision = publicPlanQuotePhotoReplayDecision({
      promptId: photo.prompt_id,
      contentType: photo.content_type,
      sha256: photo.sha256,
      status: photo.status,
    }, {
      promptId,
      contentType: file.type,
      sha256: storedHash,
    });
    if (replayDecision === "mismatch") {
      return json({
        ok: false,
        code: "IDEMPOTENCY_MISMATCH",
        error: "This photo upload reference was already used for a different file.",
      }, 409);
    }
    if (replayDecision === "replay") {
      return json({ ok: true, duplicate: true, photo: publicPhoto(photo) });
    }
  }

  const now = new Date().toISOString();
  if (!photo || photo.status === "deleted") {
    const photoId = photo?.id || crypto.randomUUID();
    const objectKey = `public-plan-quote-photos/${preparation.opportunity_id}/${crypto.randomUUID()}`;
    const write = photo
      ? await db.prepare(`UPDATE public_trade_lead_quote_photos
          SET status = 'pending', object_key = ?, updated_at = ?
          WHERE id = ? AND status = 'deleted'
            AND (SELECT COUNT(*) FROM public_trade_lead_quote_photos
              WHERE opportunity_id = ? AND status IN ('pending', 'active')) < ?
            AND (SELECT COALESCE(SUM(size_bytes), 0) FROM public_trade_lead_quote_photos
              WHERE opportunity_id = ? AND status IN ('pending', 'active')) + ? <= ?
            AND ${CURRENT_QUOTE_ACCESS_EXISTS_SQL}`)
        .bind(
          objectKey,
          now,
          photoId,
          preparation.opportunity_id,
          Math.min(Number(preparation.expected_photo_count), PUBLIC_PLAN_QUOTE_MAX_FILES),
          preparation.opportunity_id,
          storedBytes.byteLength,
          PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES,
          ...currentQuoteAccessBindings(preparation),
        )
        .run()
      : await db.prepare(`INSERT INTO public_trade_lead_quote_photos
      (id, opportunity_id, client_upload_id, prompt_id, prompt_label,
       service_categories, content_type, size_bytes, object_key, sha256,
       privacy_status, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'metadata-stripped', 'pending', ?, ?
      WHERE
        (SELECT COUNT(*) FROM public_trade_lead_quote_photos
          WHERE opportunity_id = ? AND status IN ('pending', 'active')) < ?
        AND
        (SELECT COALESCE(SUM(size_bytes), 0) FROM public_trade_lead_quote_photos
          WHERE opportunity_id = ? AND status IN ('pending', 'active')) + ? <= ?
        AND ${CURRENT_QUOTE_ACCESS_EXISTS_SQL}`)
        .bind(
          photoId,
          preparation.opportunity_id,
          clientUploadId,
          promptId,
          prompt.label,
          JSON.stringify(prompt.services),
          file.type,
          storedBytes.byteLength,
          objectKey,
          storedHash,
          now,
          now,
          preparation.opportunity_id,
          Math.min(Number(preparation.expected_photo_count), PUBLIC_PLAN_QUOTE_MAX_FILES),
          preparation.opportunity_id,
          storedBytes.byteLength,
          PUBLIC_PLAN_QUOTE_MAX_TOTAL_BYTES,
          ...currentQuoteAccessBindings(preparation),
        )
        .run();
    if (Number(write.meta.changes || 0) !== 1) {
      const raced = await db.prepare(`SELECT *
        FROM public_trade_lead_quote_photos
        WHERE opportunity_id = ? AND client_upload_id = ?
        LIMIT 1`)
        .bind(preparation.opportunity_id, clientUploadId)
        .first<PhotoRow>();
      const currentPreparation = await activePreparation(headerSourceReference);
      if (
        currentPreparation
        &&
        raced
        && raced.prompt_id === promptId
        && raced.content_type === file.type
        && raced.sha256 === storedHash
        && raced.status === "active"
      ) {
        return json({ ok: true, duplicate: true, photo: publicPhoto(raced) });
      }
      if (!currentPreparation) {
        return json({ ok: false, error: "The private quote photo upload reference was not accepted." }, 403);
      }
      return json({
        ok: false,
        code: "QUOTE_PHOTO_LIMIT",
        error: "This enquiry already has all selected quote photos.",
      }, 409);
    }
    photo = {
      id: photoId,
      opportunity_id: preparation.opportunity_id,
      client_upload_id: clientUploadId,
      prompt_id: promptId,
      prompt_label: prompt.label,
      service_categories: JSON.stringify(prompt.services),
      content_type: file.type,
      size_bytes: storedBytes.byteLength,
      object_key: objectKey,
      sha256: storedHash,
      privacy_status: "metadata-stripped",
      status: "pending",
      created_at: photo?.created_at || now,
      updated_at: now,
    };
  }

  if (!photo || photo.status !== "pending") {
    return json({ ok: false, error: "This quote photo is no longer accepting uploads." }, 409);
  }
  const bucket = getEvidenceBucket();
  try {
    if (!await bucket.head(photo.object_key)) {
      await bucket.put(photo.object_key, exactArrayBuffer(storedBytes), {
        httpMetadata: { contentType: file.type },
        customMetadata: {
          opportunityId: preparation.opportunity_id,
          photoId: photo.id,
          promptId,
          sharingScope: "verified-matched-trades",
          privacyStatus: "metadata-stripped",
        },
      });
    }
  } catch {
    await deletePendingPhotoAndObject(photo);
    return json({ ok: false, error: "The quote photo could not be stored. Retry this photo." }, 503);
  }
  let activated;
  try {
    activated = await db.prepare(`UPDATE public_trade_lead_quote_photos
      SET status = 'active', updated_at = ?
      WHERE id = ? AND status = 'pending'
        AND ${CURRENT_QUOTE_ACCESS_EXISTS_SQL}`)
      .bind(
        new Date().toISOString(),
        photo.id,
        ...currentQuoteAccessBindings(preparation),
      )
      .run();
  } catch {
    await deletePendingPhotoAndObject(photo);
    return json({ ok: false, error: "The quote photo could not be finalised. Retry this photo." }, 503);
  }
  if (Number(activated.meta.changes || 0) !== 1) {
    const raced = await db.prepare(`SELECT * FROM public_trade_lead_quote_photos
      WHERE id = ? AND status = 'active' LIMIT 1`)
      .bind(photo.id)
      .first<PhotoRow>();
    const currentPreparation = await activePreparation(headerSourceReference);
    if (raced && currentPreparation) {
      return json({ ok: true, duplicate: true, photo: publicPhoto(raced) });
    }
    if (raced) await revokePhotoAndObject(raced);
    else await deletePendingPhotoAndObject(photo);
    return json({ ok: false, error: "The quote photo could not be finalised. Retry this photo." }, 409);
  }
  photo.status = "active";
  photo.updated_at = new Date().toISOString();
  return json({
    ok: true,
    photo: publicPhoto(photo),
  }, 201);
}

function tradeAccessCode(error: unknown) {
  return error instanceof TradeAccessError
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  let access: Awaited<ReturnType<typeof requireVerifiedTradeAccess>>;
  try {
    access = await requireVerifiedTradeAccess(request, { partnerTypes: ["installer"] });
  } catch (error) {
    const code = tradeAccessCode(error);
    if (code === "AUTH_REQUIRED") return json({ ok: false, error: "Sign in to continue." }, 401);
    return json({ ok: false, error: "An active approved installer account is required." }, 403);
  }
  if (!await accountHasFeature(access.identity.uid, "installer", "installer_leads")) {
    return json({ ok: false, error: "Complete trade verification before opening quote photos." }, 403);
  }
  const photoId = new URL(request.url).searchParams.get("download")?.trim() || "";
  if (!UUID_PATTERN.test(photoId)) {
    return json({ ok: false, error: "Choose a valid quote photo." }, 400);
  }
  const row = await getD1().prepare(`SELECT photo.*, match.id match_id,
      match.matched_categories
    FROM public_trade_lead_quote_photos photo
    JOIN public_trade_lead_quote_preparations preparation
      ON preparation.opportunity_id = photo.opportunity_id
      AND preparation.status = 'active'
      AND preparation.notice_version = ?
      AND preparation.consent_purpose = ?
      AND datetime(preparation.granted_at) IS NOT NULL
      AND preparation.withdrawn_at = ''
    JOIN trade_opportunities opportunity
      ON opportunity.id = photo.opportunity_id
      AND opportunity.source_reference = preparation.source_reference
      AND opportunity.status = 'open'
      AND datetime(opportunity.expires_at) > datetime('now')
    JOIN trade_opportunity_matches match
      ON match.opportunity_id = opportunity.id
      AND match.firebase_uid = ?
      AND match.status IN ('offered', 'viewed', 'interested', 'connected')
    JOIN trade_accounts account
      ON account.firebase_uid = match.firebase_uid
      AND account.partner_type = 'installer'
      AND ${verifiedTradeAccountPredicate("account")}
    JOIN public_trade_lead_contact_releases contact
      ON contact.id = (
        SELECT current_release.id
        FROM public_trade_lead_contact_releases current_release
        WHERE current_release.opportunity_id = opportunity.id
          AND current_release.source_reference = opportunity.source_reference
        ORDER BY datetime(current_release.updated_at) DESC,
          datetime(current_release.granted_at) DESC,
          current_release.id DESC
        LIMIT 1
      )
      AND contact.status = 'active'
      AND contact.notice_version = ?
      AND contact.consent_purpose = ?
      AND datetime(contact.granted_at) IS NOT NULL
      AND contact.withdrawn_at = ''
    WHERE photo.id = ? AND photo.status = 'active'
    LIMIT 1`)
    .bind(
      PUBLIC_PLAN_QUOTE_PHOTO_NOTICE_VERSION,
      PUBLIC_PLAN_QUOTE_PHOTO_PURPOSE,
      access.identity.uid,
      PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
      PUBLIC_PLAN_CONSENT_PURPOSE,
      photoId,
    )
    .first<PhotoRow & { match_id: string; matched_categories: string }>();
  if (
    !row
    || !publicPlanQuoteCategoryIntersection(
      row.service_categories,
      row.matched_categories,
    ).length
  ) {
    return json({ ok: false, error: "Quote photo access was not accepted." }, 403);
  }
  const object = await getEvidenceBucket().get(row.object_key);
  if (!object) {
    return json({ ok: false, error: "The stored quote photo was not found." }, 404);
  }
  await getD1().prepare(`INSERT INTO public_trade_lead_quote_photo_events
    (id, photo_id, opportunity_id, match_id, installer_uid, event_type, created_at)
    VALUES (?, ?, ?, ?, ?, 'viewed', ?)`)
    .bind(
      crypto.randomUUID(),
      row.id,
      row.opportunity_id,
      row.match_id,
      access.identity.uid,
      new Date().toISOString(),
    )
    .run();
  const extension = row.content_type === "image/png"
    ? "png"
    : "jpg";
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="customer-quote-photo.${extension}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": object.httpMetadata?.contentType || row.content_type,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
