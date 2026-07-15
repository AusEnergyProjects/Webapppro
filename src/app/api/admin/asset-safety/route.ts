import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { ASSET_SAFETY_SEVERITIES, safetyNoticeMatchesAsset } from "@/lib/asset-lifecycle.mjs";
import { HANDOVER_ASSET_CATEGORIES, isIsoDate } from "@/lib/trade-handover.mjs";

export const runtime = "edge";

const SEVERITIES = new Set(ASSET_SAFETY_SEVERITIES.map((item: string[]) => item[0]));
const CATEGORIES = new Set(HANDOVER_ASSET_CATEGORIES.map((item: string[]) => item[0]));

function validHttpsUrl(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function noticeInput(body: Record<string, unknown>) {
  const title = cleanAdminText(body.title, 140);
  const summary = cleanAdminText(body.summary, 1200);
  const severity = cleanAdminText(body.severity, 20);
  const assetCategory = cleanAdminText(body.assetCategory, 60);
  const brand = cleanAdminText(body.brand, 100);
  const modelNumber = cleanAdminText(body.modelNumber, 120);
  const sourceUrl = cleanAdminText(body.sourceUrl, 500);
  const sourceLabel = cleanAdminText(body.sourceLabel, 120) || "Official safety source";
  const effectiveAt = cleanAdminText(body.effectiveAt, 10);
  const expiresAt = cleanAdminText(body.expiresAt, 10);
  if (!title || !summary || !SEVERITIES.has(severity)) throw new Error("INVALID_NOTICE");
  if (!assetCategory && !brand && !modelNumber) throw new Error("SCOPE_REQUIRED");
  if (assetCategory && !CATEGORIES.has(assetCategory)) throw new Error("INVALID_NOTICE");
  if (!validHttpsUrl(sourceUrl)) throw new Error("SOURCE_REQUIRED");
  if (!isIsoDate(effectiveAt) || !isIsoDate(expiresAt) || (effectiveAt && expiresAt && expiresAt < effectiveAt)) throw new Error("INVALID_DATE");
  return { title, summary, severity, assetCategory, brand, modelNumber, sourceUrl, sourceLabel, effectiveAt, expiresAt };
}

async function noticesPayload() {
  const db = getD1();
  const [noticeRows, assetRows, acknowledgementRows] = await Promise.all([
    db.prepare(`SELECT id, created_by_uid, title, summary, severity, asset_category, brand, model_number,
      source_url, source_label, effective_at, expires_at, status, published_at, withdrawn_at, created_at, updated_at
      FROM asset_safety_notices ORDER BY created_at DESC LIMIT 250`).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.id, a.asset_category, a.brand, a.model_number FROM trade_installed_assets a
      JOIN trade_handover_packs p ON p.id = a.handover_pack_id
      WHERE a.record_status = 'active' AND p.status = 'published'`).all<Record<string, unknown>>(),
    db.prepare(`SELECT notice_id, COUNT(*) acknowledgement_count FROM asset_safety_acknowledgements
      GROUP BY notice_id`).all<Record<string, unknown>>(),
  ]);
  return noticeRows.results.map((row: Record<string, unknown>) => ({
    id: String(row.id), title: String(row.title), summary: String(row.summary), severity: String(row.severity),
    assetCategory: String(row.asset_category || ""), brand: String(row.brand || ""), modelNumber: String(row.model_number || ""),
    sourceUrl: String(row.source_url), sourceLabel: String(row.source_label), effectiveAt: String(row.effective_at || ""),
    expiresAt: String(row.expires_at || ""), status: String(row.status), publishedAt: String(row.published_at || ""),
    withdrawnAt: String(row.withdrawn_at || ""), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    affectedAssetCount: assetRows.results.filter((asset: Record<string, unknown>) => safetyNoticeMatchesAsset(row, {
      assetCategory: asset.asset_category, brand: asset.brand, modelNumber: asset.model_number,
    })).length,
    acknowledgementCount: Number(acknowledgementRows.results.find((item: Record<string, unknown>) => item.notice_id === row.id)?.acknowledgement_count || 0),
  }));
}

function inputError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVALID_NOTICE") return adminJson({ ok: false, error: "Add a title, clear summary and supported severity." }, 400);
  if (code === "SCOPE_REQUIRED") return adminJson({ ok: false, error: "Target at least one asset category, brand or model number." }, 400);
  if (code === "SOURCE_REQUIRED") return adminJson({ ok: false, error: "Add an HTTPS link to the official safety or manufacturer source." }, 400);
  if (code === "INVALID_DATE") return adminJson({ ok: false, error: "Choose valid effective and expiry dates." }, 400);
  return adminError(error);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner", "admin", "reviewer", "support"]);
    return adminJson({ ok: true, notices: await noticesPayload() });
  } catch (error) { return adminError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const input = noticeInput(body);
    const status = body.publishNow === true ? "published" : "draft";
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await getD1().prepare(`INSERT INTO asset_safety_notices
      (id, created_by_uid, title, summary, severity, asset_category, brand, model_number, source_url,
       source_label, effective_at, expires_at, status, published_at, withdrawn_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
      .bind(id, admin.uid, input.title, input.summary, input.severity, input.assetCategory, input.brand,
        input.modelNumber, input.sourceUrl, input.sourceLabel, input.effectiveAt, input.expiresAt,
        status, status === "published" ? now : "", now, now).run();
    await writeAdminAudit(admin, status === "published" ? "asset_safety.publish" : "asset_safety.draft", "asset_safety_notice", id,
      status === "published" ? "Published an asset safety notice to matched private asset libraries." : "Created a draft asset safety notice.",
      { severity: input.severity, assetCategory: input.assetCategory, brand: input.brand, modelNumber: input.modelNumber });
    return adminJson({ ok: true, notices: await noticesPayload() }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid safety notice request." }, 400);
    return inputError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const id = cleanAdminText(body.id, 180);
    const action = cleanAdminText(body.action, 30);
    const existing = await getD1().prepare("SELECT id, status FROM asset_safety_notices WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!existing) return adminJson({ ok: false, error: "Safety notice not found." }, 404);
    const now = new Date().toISOString();
    if (action === "publish") {
      await getD1().prepare(`UPDATE asset_safety_notices SET status = 'published', published_at = ?, withdrawn_at = '', updated_at = ? WHERE id = ?`)
        .bind(now, now, id).run();
      await writeAdminAudit(admin, "asset_safety.publish", "asset_safety_notice", id, "Published an asset safety notice to matched private asset libraries.");
    } else if (action === "withdraw") {
      await getD1().prepare(`UPDATE asset_safety_notices SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, id).run();
      await writeAdminAudit(admin, "asset_safety.withdraw", "asset_safety_notice", id, "Withdrew an asset safety notice from active asset libraries.");
    } else return adminJson({ ok: false, error: "Choose publish or withdraw." }, 400);
    return adminJson({ ok: true, notices: await noticesPayload() });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid safety notice update." }, 400);
    return adminError(error);
  }
}
