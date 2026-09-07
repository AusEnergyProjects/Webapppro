import { getD1 } from "../../../../db";
import { adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { cleanTradeFormTemplateInput } from "@/lib/trade-form-template-input";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";
type Row = Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function templates(ownerUid: string) {
  const rows = await getD1().prepare(`SELECT id, template_key, version, name, jurisdiction,
    categories, description, guidance, fields, status, updated_at
    FROM trade_form_templates t WHERE scope_owner_uid = ?
      AND version = (SELECT MAX(version) FROM trade_form_templates n
        WHERE n.template_key = t.template_key AND n.scope_owner_uid = t.scope_owner_uid)
    ORDER BY name`).bind(ownerUid).all<Row>();
  return rows.results.map((row) => ({ id: row.id, templateKey: row.template_key, version: row.version,
    name: row.name, jurisdiction: row.jurisdiction, categories: JSON.parse(String(row.categories)),
    description: row.description, guidance: row.guidance, fields: JSON.parse(String(row.fields)),
    status: row.status, updatedAt: row.updated_at }));
}

function errorResponse(error: unknown) {
  if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["INVALID_IDENTITY", "INVALID_TEMPLATE", "INVALID_FIELDS", "DUPLICATE_FIELDS"].includes(message)) {
    return adminJson({ ok: false, error: "Add a name, purpose, guidance, work category and 1 to 30 unique questions. Selections need at least two options." }, 400);
  }
  if (message.includes("UNIQUE")) return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This form changed in another session. Reload before saving." }, 409);
  if (["TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FIELD_ACCESS_REQUIRED", "FULL_ACCESS_REQUIRED"].includes(message)) return adminJson({ ok: false, error: "Active approved Team access is required." }, 403);
  return adminJson({ ok: false, error: "The form library could not be updated. Try again." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner && !access.canViewFieldEvidence) return adminJson({ ok: false, error: "Your Team access does not include forms." }, 403);
    return adminJson({ ok: true, canManage: access.isOwner || (access.canManageJobs && access.jobScope === "team" && access.canManageFieldEvidence), templates: await templates(access.ownerUid) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.isOwner && !(access.canManageJobs && access.jobScope === "team" && access.canManageFieldEvidence)) {
      return adminJson({ ok: false, error: "Managing business forms needs team-wide Manage jobs and Manage field evidence permissions." }, 403);
    }
    const raw = await readBoundedJsonRequest(request, 100_000);
    if (!isRecord(raw)) throw new Error("INVALID_TEMPLATE");
    const body = raw;
    const id = crypto.randomUUID();
    const current = body.id ? await getD1().prepare(`SELECT * FROM trade_form_templates
      WHERE id = ? AND scope_owner_uid = ?`).bind(String(body.id), access.ownerUid).first<Row>() : null;
    if (body.id && !current) return adminJson({ ok: false, error: "Business form not found." }, 404);
    if (current && (body.expectedVersion !== current.version || body.expectedUpdatedAt !== current.updated_at)) {
      return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This form changed. Reload before saving." }, 409);
    }
    const input = cleanTradeFormTemplateInput({ ...body,
      templateKey: current?.template_key || `business-${id}`, version: current ? Number(current.version) + 1 : 1,
      sourceNotes: "Business supporting form. Does not replace mandatory activity requirements." });
    const now = new Date().toISOString();
    await getD1().prepare(`INSERT INTO trade_form_templates
      (id, scope_owner_uid, template_key, version, name, jurisdiction, categories, description,
        guidance, fields, source_notes, status, created_by_uid, published_by_uid, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`)
      .bind(id, access.ownerUid, input.templateKey, input.version, input.name, input.jurisdiction,
        JSON.stringify(input.categories), input.description, input.guidance, JSON.stringify(input.fields),
        input.sourceNotes, access.actorUid, access.actorUid, now, now, now).run();
    return adminJson({ ok: true, canManage: true, savedId: id, templates: await templates(access.ownerUid) }, 201);
  } catch (error) { return errorResponse(error); }
}
