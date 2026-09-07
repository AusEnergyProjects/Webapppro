import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";
import { cleanTradeFormTemplateInput as cleanInput } from "@/lib/trade-form-template-input";
import { ENERGY_SERVICE_IDS } from "@/lib/energy-service-catalogue.mjs";

export const runtime = "edge";
const CATEGORIES = new Set<string>([...ENERGY_SERVICE_IDS, "rental-inspection", "electrical", "plumbing", "mounting-hardware", "controls"]);

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

async function payload() {
  const rows = await getD1().prepare(`SELECT id, template_key, version, name, jurisdiction, categories, description,
    guidance, fields, source_notes, status, published_at, withdrawn_at, created_at, updated_at
    FROM trade_form_templates WHERE scope_owner_uid = '' ORDER BY template_key, version DESC`).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id), templateKey: String(row.template_key), version: Number(row.version), name: String(row.name),
    jurisdiction: String(row.jurisdiction), categories: parseJson<string[]>(row.categories, []),
    description: String(row.description), guidance: String(row.guidance), fields: parseJson(row.fields, []),
    sourceNotes: String(row.source_notes), status: String(row.status), publishedAt: String(row.published_at),
    withdrawnAt: String(row.withdrawn_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

function inputError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "INVALID_IDENTITY") return adminJson({ ok: false, error: "Use a stable lowercase template key and a version from 1 to 1000." }, 400);
  if (code === "INVALID_TEMPLATE") return adminJson({ ok: false, error: "Add a name, purpose, field guidance, jurisdiction and at least one work category." }, 400);
  if (code === "INVALID_FIELDS" || code === "DUPLICATE_FIELDS") return adminJson({ ok: false, error: "Add 1 to 30 uniquely keyed fields. Selection fields need at least two options." }, 400);
  return adminError(error);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner", "admin", "reviewer", "support"]);
    return adminJson({ ok: true, templates: await payload() });
  } catch (error) { return adminError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const input = cleanInput(body);
    const publishNow = body.publishNow !== false;
    if (publishNow && !input.sourceNotes) return adminJson({ ok: false, error: "Add a standards, regulator or internal review note before publishing." }, 400);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    const inserted = await getD1().prepare(`INSERT INTO trade_form_templates
      (id, template_key, version, name, jurisdiction, categories, description, guidance, fields, source_notes,
       status, created_by_uid, published_by_uid, published_at, withdrawn_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?
      WHERE ? = COALESCE((SELECT MAX(version) FROM trade_form_templates WHERE template_key = ? AND scope_owner_uid = ''), 0) + 1`).bind(id, input.templateKey, input.version,
        input.name, input.jurisdiction, JSON.stringify(input.categories), input.description, input.guidance,
        JSON.stringify(input.fields), input.sourceNotes, publishNow ? "published" : "draft", admin.uid,
        publishNow ? admin.uid : "", publishNow ? now : "", now, now, input.version, input.templateKey).run();
    if (Number(inserted.meta.changes) !== 1) return adminJson({ ok: false, error: "This template changed. Reload and create the next version." }, 409);
    await writeAdminAudit(admin, publishNow ? "trade_form.publish" : "trade_form.draft", "trade_form_template", id,
      `${publishNow ? "Published" : "Created"} ${input.name}, version ${input.version}.`);
    return adminJson({ ok: true, templates: await payload() }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid form template request." }, 400);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return adminJson({ ok: false, error: "That template key and version already exist. Create the next version instead." }, 409);
    return inputError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const id = cleanAdminText(body.id, 180); const action = cleanAdminText(body.action, 20);
    const current = await getD1().prepare("SELECT id, name, version, status, source_notes, categories FROM trade_form_templates WHERE id = ? AND scope_owner_uid = ''").bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Form template not found." }, 404);
    const now = new Date().toISOString();
    if (action === "publish") {
      if (!String(current.source_notes).trim()) return adminJson({ ok: false, error: "Add governance notes by creating a reviewed version before publishing." }, 400);
      const categories = parseJson<string[]>(current.categories, []);
      if (!categories.length || categories.some((category) => !CATEGORIES.has(category))) {
        return adminJson({ ok: false, error: "Clone this legacy form and choose current work categories before publishing." }, 409);
      }
      const published = await getD1().prepare(`UPDATE trade_form_templates SET status = 'published', published_by_uid = ?, published_at = ?, withdrawn_at = '', updated_at = ?
        WHERE id = ? AND scope_owner_uid = '' AND status = 'draft' AND version > COALESCE((SELECT MAX(head.version) FROM trade_form_templates head
          WHERE head.template_key = trade_form_templates.template_key AND head.scope_owner_uid = '' AND head.status IN ('published', 'withdrawn')), 0)`)
        .bind(admin.uid, now, now, id).run();
      if (Number(published.meta.changes) !== 1) return adminJson({ ok: false, error: "A newer version has changed this template's availability. Reload and create the next version." }, 409);
    } else if (action === "withdraw") {
      await getD1().prepare("UPDATE trade_form_templates SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE id = ? AND status = 'published'").bind(now, now, id).run();
    } else return adminJson({ ok: false, error: "Choose publish or withdraw." }, 400);
    await writeAdminAudit(admin, `trade_form.${action}`, "trade_form_template", id, `${action === "publish" ? "Published" : "Withdrew"} ${String(current.name)}, version ${Number(current.version)}.`);
    return adminJson({ ok: true, templates: await payload() });
  } catch (error) { return adminError(error); }
}
