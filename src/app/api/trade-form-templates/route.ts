import { getD1 } from "../../../../db";
import { mfaErrorResponse, adminJson, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { TradeBusinessContextError } from "@/lib/trade-business-context-server";
import { cleanTradeFormTemplateInput } from "@/lib/trade-form-template-input";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";
type Row = Record<string, unknown>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function actorGuard(access: TeamAccess, write = false) {
  const bindings: (string | number)[] = [access.ownerUid, access.memberId];
  let identity: string;
  if (access.fieldSessionId) {
    if (access.actorUid !== `field-member:${access.memberId}`) throw new Error("TEAM_ACCESS_REQUIRED");
    identity = `EXISTS (SELECT 1 FROM trade_field_sessions session WHERE session.id = ?
      AND session.owner_uid = actor.owner_uid AND session.team_member_id = actor.id
      AND session.status = 'active' AND session.expires_at > ?)`;
    bindings.push(access.fieldSessionId, new Date().toISOString());
  } else {
    identity = "actor.member_uid = ?";
    bindings.push(access.actorUid);
  }
  return { sql: `actor.owner_uid = ? AND actor.id = ? AND actor.status = 'active' AND ${identity}
    ${write ? "AND (actor.member_uid = actor.owner_uid OR actor.can_manage_forms = 1)" : ""}`, bindings };
}

async function requireAuthor(access: TeamAccess) {
  const guard = actorGuard(access, true);
  if (!await getD1().prepare(`SELECT 1 FROM trade_team_members actor WHERE ${guard.sql}`)
    .bind(...guard.bindings).first()) throw new Error("FORM_AUTHOR_REQUIRED");
}

async function library(access: TeamAccess) {
  const guard = actorGuard(access);
  const rows = await getD1().prepare(`SELECT t.id, t.template_key, t.version, t.name, t.jurisdiction,
    t.categories, t.description, t.guidance, t.fields, t.status, t.updated_at,
    (actor.member_uid = actor.owner_uid OR actor.can_manage_forms = 1) can_manage
    FROM trade_team_members actor LEFT JOIN trade_form_templates t ON t.scope_owner_uid = actor.owner_uid
      AND t.version = (SELECT MAX(version) FROM trade_form_templates n
        WHERE n.template_key = t.template_key AND n.scope_owner_uid = t.scope_owner_uid)
    WHERE ${guard.sql} ORDER BY t.name`).bind(...guard.bindings).all<Row>();
  if (!rows.results.length) throw new Error("TEAM_ACCESS_REQUIRED");
  const templates = rows.results.filter(row => row.id).map((row) => ({ id: row.id, templateKey: row.template_key, version: row.version,
    name: row.name, jurisdiction: row.jurisdiction, categories: JSON.parse(String(row.categories)),
    description: row.description, guidance: row.guidance, fields: JSON.parse(String(row.fields)),
    status: row.status, updatedAt: row.updated_at }));
  return { canManage: Boolean(rows.results[0].can_manage), templates };
}

function errorResponse(error: unknown) {
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  if (error instanceof BoundedJsonRequestError) return adminJson({ ok: false, code: error.code, error: error.message }, error.status);
  if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, code: error.code, error: error.publicMessage }, error.status);
  const message = error instanceof Error ? error.message : "";
  if (message === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (message === "FORM_AUTHOR_REQUIRED") return adminJson({ ok: false, error: "Creating or editing business forms requires Create and edit business forms access." }, 403);
  if (message === "INVALID_CONDITION") return adminJson({ ok: false, code: "INVALID_CONDITION", error: "Connect each question to an earlier select or checkbox question and one of its valid answers. Connections cannot point forward or loop between questions or pages." }, 400);
  if (["INVALID_IDENTITY", "INVALID_TEMPLATE", "INVALID_FIELDS", "DUPLICATE_FIELDS"].includes(message)) {
    return adminJson({ ok: false, error: "Add a name, purpose, guidance, work category and 1 to 30 unique questions. Selections need at least two options." }, 400);
  }
  if (message.includes("UNIQUE") || message === "FORM_VERSION_CONFLICT") return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This form or your authoring access changed. Reload before saving." }, 409);
  if (["TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ABN_REVIEW_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "FIELD_ACCESS_REQUIRED", "FULL_ACCESS_REQUIRED"].includes(message)) return adminJson({ ok: false, error: "Active approved Team access is required." }, 403);
  return adminJson({ ok: false, error: "The form library could not be updated. Try again." }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    return adminJson({ ok: true, ...await library(access) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    await requireAuthor(access);
    const raw = await readBoundedJsonRequest(request, 100_000);
    if (!isRecord(raw)) throw new Error("INVALID_TEMPLATE");
    const body = raw;
    const id = crypto.randomUUID();
    const guard = actorGuard(access, true);
    const current = body.id ? await getD1().prepare(`SELECT * FROM trade_form_templates
      WHERE id = ? AND scope_owner_uid = ? AND EXISTS (SELECT 1 FROM trade_team_members actor WHERE ${guard.sql})`)
      .bind(String(body.id), access.ownerUid, ...guard.bindings).first<Row>() : null;
    if (body.id && !current) return adminJson({ ok: false, error: "Business form not found." }, 404);
    if (current && (body.expectedVersion !== current.version || body.expectedUpdatedAt !== current.updated_at)) {
      return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This form changed. Reload before saving." }, 409);
    }
    const input = cleanTradeFormTemplateInput({ ...body,
      templateKey: current?.template_key || `business-${id}`, version: current ? Number(current.version) + 1 : 1,
      sourceNotes: "Business supporting form. Does not replace mandatory activity requirements." });
    const now = new Date().toISOString();
    const db = getD1();
    const result = await db.batch([db.prepare(`INSERT INTO trade_form_templates
      (id, scope_owner_uid, template_key, version, name, jurisdiction, categories, description,
        guidance, fields, source_notes, status, created_by_uid, published_by_uid, published_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM trade_team_members actor WHERE ${guard.sql})
        AND COALESCE((SELECT MAX(version) FROM trade_form_templates WHERE scope_owner_uid = ? AND template_key = ?), 0) = ?
        AND (? = '' OR EXISTS (SELECT 1 FROM trade_form_templates WHERE id = ? AND scope_owner_uid = ? AND updated_at = ?))`)
      .bind(id, access.ownerUid, input.templateKey, input.version, input.name, input.jurisdiction,
        JSON.stringify(input.categories), input.description, input.guidance, JSON.stringify(input.fields),
        input.sourceNotes, access.actorUid, access.actorUid, now, now, now, ...guard.bindings,
        access.ownerUid, input.templateKey, current ? Number(current.version) : 0,
        current ? String(current.id) : "", current ? String(current.id) : "", access.ownerUid, current ? String(current.updated_at) : ""),
      db.prepare(`INSERT INTO trade_team_member_events
        (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
        SELECT ?, ?, ?, ?, 'member', ?, 'business_form.published', ?, ? WHERE changes() = 1`)
        .bind(crypto.randomUUID(), access.ownerUid, access.memberId, access.actorUid, access.memberId,
          JSON.stringify({ templateId: id, templateKey: input.templateKey, version: input.version }), now),
    ]);
    if (Number(result[0]?.meta.changes || 0) !== 1) throw new Error("FORM_VERSION_CONFLICT");
    return adminJson({ ok: true, savedId: id, ...await library(access) }, 201);
  } catch (error) { return errorResponse(error); }
}
