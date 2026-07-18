import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { normalisePacketLines, normaliseSuggestedCrewSize, type PacketPriceItem } from "@/lib/trade-job-packet";
import { jobPacketLibrary } from "@/lib/trade-job-packet-server";
import { publishedTradeFormTemplatesFor } from "@/lib/trade-form-templates-server";
import { canDispatch, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";
type Row = Record<string, unknown>;
const SERVICE_CATEGORIES = new Set(["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "electrical", "plumbing", "mounting-hardware", "controls", "other"]);

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_MEMBERSHIP_REQUIRED"].includes(code)) return adminJson({ ok: false, error: "An active verified installer account is required." }, 403);
  if (code === "JOB_PACKET_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can manage common jobs." }, 403);
  if (code === "JOB_PACKET_NOT_FOUND") return adminJson({ ok: false, error: "Common job not found." }, 404);
  if (code === "JOB_PACKET_LIMIT") return adminJson({ ok: false, error: "This workspace has reached its 200 job-packet limit." }, 409);
  if (code === "JOB_PACKET_NAME_EXISTS") return adminJson({ ok: false, error: "A common job with this name already exists." }, 409);
  if (["INVALID_JOB_PACKET", "INVALID_JOB_PACKET_LINES", "INVALID_JOB_PACKET_FORMS", "INVALID_JOB_PACKET_CREW", "INVALID_QUANTITY"].includes(code)) return adminJson({ ok: false, error: "Check the common job name, service, items, quantities, forms and crew size." }, 400);
  return adminJson({ ok: false, error: "The job-packet request could not be completed." }, 500);
}

function requireManager(access: TeamAccess) { if (!canDispatch(access)) throw new Error("JOB_PACKET_MANAGEMENT_REQUIRED"); }

async function ownedPacket(ownerUid: string, id: string) {
  const row = await getD1().prepare("SELECT * FROM trade_job_packets WHERE id = ? AND firebase_uid = ?").bind(id, ownerUid).first<Row>();
  if (!row) throw new Error("JOB_PACKET_NOT_FOUND"); return row;
}

async function priceItems(ownerUid: string) {
  const rows = await getD1().prepare(`SELECT id, item_code, name, item_type, unit_label, supplier_cost_cents_ex_gst,
      sell_price_cents_ex_gst, tax_code, expected_duration_minutes, required_skill
    FROM trade_price_book_items WHERE firebase_uid = ? AND record_status = 'active'
    ORDER BY name COLLATE NOCASE, item_code LIMIT 500`).bind(ownerUid).all<Row>();
  return rows.results.map((row) => ({ id: String(row.id), itemCode: String(row.item_code), name: String(row.name),
    itemType: String(row.item_type), unitLabel: String(row.unit_label), supplierCostCentsExGst: Number(row.supplier_cost_cents_ex_gst),
    sellPriceCentsExGst: Number(row.sell_price_cents_ex_gst), taxCode: String(row.tax_code) as "gst" | "none",
    expectedDurationMinutes: Number(row.expected_duration_minutes), requiredSkill: String(row.required_skill) } satisfies PacketPriceItem));
}

async function prepared(ownerUid: string, body: Row) {
  const name = cleanAdminText(body.name, 140); if (!name) throw new Error("INVALID_JOB_PACKET");
  const serviceCategory = cleanAdminText(body.serviceCategory, 60); if (!SERVICE_CATEGORIES.has(serviceCategory)) throw new Error("INVALID_JOB_PACKET");
  const recordStatus = cleanAdminText(body.recordStatus, 20); if (!["draft", "active"].includes(recordStatus)) throw new Error("INVALID_JOB_PACKET");
  const suggestedCrewSize = normaliseSuggestedCrewSize(body.suggestedCrewSize);
  const availableItems = await priceItems(ownerUid); const itemMap = new Map(availableItems.map((item) => [item.id, item]));
  const lines = normalisePacketLines(body.lines, itemMap); if (recordStatus === "active" && !lines.length) throw new Error("INVALID_JOB_PACKET_LINES");
  const jobTemplateId = cleanAdminText(body.jobTemplateId, 180);
  if (jobTemplateId) {
    const template = await getD1().prepare(`SELECT id FROM trade_crm_job_templates
      WHERE id = ? AND firebase_uid = ? AND record_status = 'active' AND service_category IN (?, 'other')`)
      .bind(jobTemplateId, ownerUid, serviceCategory).first<Row>();
    if (!template) throw new Error("INVALID_JOB_PACKET");
  }
  const publishedForms = await publishedTradeFormTemplatesFor(serviceCategory); const formMap = new Map(publishedForms.map((form) => [`${form.key}:${form.version}`, form]));
  const rawForms = Array.isArray(body.forms) ? body.forms : []; if (rawForms.length > 20) throw new Error("INVALID_JOB_PACKET_FORMS");
  const formKeys = new Set<string>(); const forms = rawForms.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("INVALID_JOB_PACKET_FORMS"); const row = raw as Row;
    const templateKey = cleanAdminText(row.templateKey, 120); const templateVersion = Number(row.templateVersion);
    const key = `${templateKey}:${templateVersion}`; if (!formMap.has(key) || formKeys.has(key)) throw new Error("INVALID_JOB_PACKET_FORMS"); formKeys.add(key);
    return { templateKey, templateVersion };
  });
  return { name, serviceCategory, recordStatus, suggestedCrewSize, jobTemplateId, lines, forms };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false); requireManager(access); const url = new URL(request.url);
    const categoryInput = cleanAdminText(url.searchParams.get("serviceCategory"), 60); const serviceCategory = SERVICE_CATEGORIES.has(categoryInput) ? categoryInput : "assessment";
    const [packets, items, templates, forms] = await Promise.all([
      jobPacketLibrary(access.ownerUid), priceItems(access.ownerUid),
      getD1().prepare(`SELECT id, name, service_category, task_titles FROM trade_crm_job_templates
        WHERE firebase_uid = ? AND record_status = 'active' ORDER BY name COLLATE NOCASE LIMIT 60`).bind(access.ownerUid).all<Row>(),
      publishedTradeFormTemplatesFor(serviceCategory),
    ]);
    return adminJson({ ok: true, packets, priceBookItems: items,
      jobTemplates: templates.results.map((row) => ({ id: String(row.id), name: String(row.name), serviceCategory: String(row.service_category), taskCount: (() => { try { const value = JSON.parse(String(row.task_titles || "[]")); return Array.isArray(value) ? value.length : 0; } catch { return 0; } })() })),
      formOptions: forms.map((form) => ({ templateKey: form.key, templateVersion: form.version, name: form.name, description: form.description })), serviceCategory });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false); requireManager(access); const body = await request.json() as Row;
    if (cleanAdminText(body.action, 30) !== "create") return adminJson({ ok: false, error: "Unsupported job-packet action." }, 400);
    const db = getD1(); const count = await db.prepare("SELECT COUNT(*) count FROM trade_job_packets WHERE firebase_uid = ?").bind(access.ownerUid).first<Row>();
    if (Number(count?.count || 0) >= 200) throw new Error("JOB_PACKET_LIMIT");
    const input = await prepared(access.ownerUid, body); const id = crypto.randomUUID(); const now = new Date().toISOString(); const code = `PKT-${id.slice(0, 8).toUpperCase()}`;
    const statements = [db.prepare(`INSERT INTO trade_job_packets
      (id, firebase_uid, packet_code, name, service_category, job_template_id, suggested_crew_size, record_status,
      revision, created_by_uid, updated_by_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(id, access.ownerUid, code, input.name, input.serviceCategory, input.jobTemplateId, input.suggestedCrewSize,
        input.recordStatus, access.actorUid, access.actorUid, now, now),
      ...input.lines.map((line, index) => db.prepare(`INSERT INTO trade_job_packet_items
        (id, packet_id, firebase_uid, position, price_book_item_id, quantity_milli, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, access.ownerUid, index + 1, line.priceBookItemId, line.quantityMilli, now)),
      ...input.forms.map((form, index) => db.prepare(`INSERT INTO trade_job_packet_forms
        (id, packet_id, firebase_uid, position, template_key, template_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, access.ownerUid, index + 1, form.templateKey, form.templateVersion, now)),
    ];
    try { await db.batch(statements); } catch (error) { if (String(error).includes("UNIQUE")) throw new Error("JOB_PACKET_NAME_EXISTS"); throw error; }
    return adminJson({ ok: true, packet: await ownedPacket(access.ownerUid, id) }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false); requireManager(access); const body = await request.json() as Row;
    const id = cleanAdminText(body.packetId, 180); const existing = await ownedPacket(access.ownerUid, id); const action = cleanAdminText(body.action, 30);
    const db = getD1(); const now = new Date().toISOString();
    if (action === "archive") {
      await db.prepare(`UPDATE trade_job_packets SET record_status = 'archived', revision = revision + 1, updated_by_uid = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND record_status != 'archived'`).bind(access.actorUid, now, id, access.ownerUid).run();
      return adminJson({ ok: true });
    }
    if (action !== "update" || existing.record_status === "archived") return adminJson({ ok: false, error: "Archived common jobs are read only." }, 409);
    const input = await prepared(access.ownerUid, body); const revision = Number(existing.revision) + 1;
    const statements = [db.prepare(`UPDATE trade_job_packets SET name = ?, service_category = ?, job_template_id = ?, suggested_crew_size = ?,
      record_status = ?, revision = ?, updated_by_uid = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND record_status != 'archived'`)
      .bind(input.name, input.serviceCategory, input.jobTemplateId, input.suggestedCrewSize, input.recordStatus, revision, access.actorUid, now, id, access.ownerUid),
      db.prepare("DELETE FROM trade_job_packet_items WHERE packet_id = ? AND firebase_uid = ?").bind(id, access.ownerUid),
      db.prepare("DELETE FROM trade_job_packet_forms WHERE packet_id = ? AND firebase_uid = ?").bind(id, access.ownerUid),
      ...input.lines.map((line, index) => db.prepare(`INSERT INTO trade_job_packet_items
        (id, packet_id, firebase_uid, position, price_book_item_id, quantity_milli, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, access.ownerUid, index + 1, line.priceBookItemId, line.quantityMilli, now)),
      ...input.forms.map((form, index) => db.prepare(`INSERT INTO trade_job_packet_forms
        (id, packet_id, firebase_uid, position, template_key, template_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, access.ownerUid, index + 1, form.templateKey, form.templateVersion, now)),
    ];
    try { await db.batch(statements); } catch (error) { if (String(error).includes("UNIQUE")) throw new Error("JOB_PACKET_NAME_EXISTS"); throw error; }
    return adminJson({ ok: true });
  } catch (error) { return errorResponse(error); }
}
