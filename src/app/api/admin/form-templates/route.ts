import { getD1 } from "../../../../../db";
import { adminError, adminJson, cleanAdminText, requireAdminIdentity, sameOrigin, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "edge";

const TYPES = new Set(["checkbox", "text", "textarea", "date", "select"]);
const JURISDICTIONS = new Set(["AU", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
const CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "other"]);

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

function cleanInput(body: Record<string, unknown>) {
  const templateKey = cleanAdminText(body.templateKey, 100).toLowerCase();
  const version = Math.round(Number(body.version));
  const name = cleanAdminText(body.name, 140);
  const jurisdiction = cleanAdminText(body.jurisdiction, 10).toUpperCase();
  const description = cleanAdminText(body.description, 800);
  const guidance = cleanAdminText(body.guidance, 1200);
  const sourceNotes = cleanAdminText(body.sourceNotes, 1200);
  const categories = Array.isArray(body.categories) ? [...new Set(body.categories.map((item) => cleanAdminText(item, 60)))] : [];
  const rawFields = Array.isArray(body.fields) ? body.fields.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateKey) || !Number.isInteger(version) || version < 1 || version > 1000) throw new Error("INVALID_IDENTITY");
  if (!name || !description || !guidance || !JURISDICTIONS.has(jurisdiction) || !categories.length || categories.some((item) => !CATEGORIES.has(item))) throw new Error("INVALID_TEMPLATE");
  if (!rawFields.length || rawFields.length > 30) throw new Error("INVALID_FIELDS");
  const fields = rawFields.map((field) => {
    const key = cleanAdminText(field.key, 80).toLowerCase();
    const label = cleanAdminText(field.label, 180);
    const type = cleanAdminText(field.type, 20);
    const required = field.required === true;
    const maxLength = Math.max(20, Math.min(2000, Math.round(Number(field.maxLength || (type === "textarea" ? 1200 : 240)))));
    const options = Array.isArray(field.options) ? [...new Set(field.options.map((item) => cleanAdminText(item, 100)).filter(Boolean))].slice(0, 20) : [];
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key) || !label || !TYPES.has(type) || (type === "select" && options.length < 2)) throw new Error("INVALID_FIELDS");
    return { key, label, type, required, ...(type === "text" || type === "textarea" ? { maxLength } : {}), ...(type === "select" ? { options } : {}) };
  });
  if (new Set(fields.map((field) => field.key)).size !== fields.length) throw new Error("DUPLICATE_FIELDS");
  return { templateKey, version, name, jurisdiction, categories, description, guidance, sourceNotes, fields };
}

async function payload() {
  const rows = await getD1().prepare(`SELECT id, template_key, version, name, jurisdiction, categories, description,
    guidance, fields, source_notes, status, published_at, withdrawn_at, created_at, updated_at
    FROM trade_form_templates ORDER BY template_key, version DESC`).all<Record<string, unknown>>();
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
    const publishNow = body.publishNow === true;
    if (publishNow && !input.sourceNotes) return adminJson({ ok: false, error: "Add a standards, regulator or internal review note before publishing." }, 400);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await getD1().prepare(`INSERT INTO trade_form_templates
      (id, template_key, version, name, jurisdiction, categories, description, guidance, fields, source_notes,
       status, created_by_uid, published_by_uid, published_at, withdrawn_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`).bind(id, input.templateKey, input.version,
        input.name, input.jurisdiction, JSON.stringify(input.categories), input.description, input.guidance,
        JSON.stringify(input.fields), input.sourceNotes, publishNow ? "published" : "draft", admin.uid,
        publishNow ? admin.uid : "", publishNow ? now : "", now, now).run();
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
    const current = await getD1().prepare("SELECT id, name, version, status, source_notes FROM trade_form_templates WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!current) return adminJson({ ok: false, error: "Form template not found." }, 404);
    const now = new Date().toISOString();
    if (action === "publish") {
      if (!String(current.source_notes).trim()) return adminJson({ ok: false, error: "Add governance notes by creating a reviewed version before publishing." }, 400);
      await getD1().prepare("UPDATE trade_form_templates SET status = 'published', published_by_uid = ?, published_at = ?, withdrawn_at = '', updated_at = ? WHERE id = ? AND status = 'draft'").bind(admin.uid, now, now, id).run();
    } else if (action === "withdraw") {
      await getD1().prepare("UPDATE trade_form_templates SET status = 'withdrawn', withdrawn_at = ?, updated_at = ? WHERE id = ? AND status = 'published'").bind(now, now, id).run();
    } else return adminJson({ ok: false, error: "Choose publish or withdraw." }, 400);
    await writeAdminAudit(admin, `trade_form.${action}`, "trade_form_template", id, `${action === "publish" ? "Published" : "Withdrew"} ${String(current.name)}, version ${Number(current.version)}.`);
    return adminJson({ ok: true, templates: await payload() });
  } catch (error) { return adminError(error); }
}
