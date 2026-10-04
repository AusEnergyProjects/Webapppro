import { requireCouncilAccess } from "@/lib/council-access-server";
import { listCouncilCampaigns } from "@/lib/council-campaign-server";
import { CouncilCampaignInputError, parseCouncilCampaignInput } from "@/lib/council-campaigns";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "@/lib/bounded-json-request";

export const runtime = "edge";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Authorization" } });
const editable = `EXISTS (SELECT 1 FROM council_organisations c JOIN council_memberships m ON m.council_id=c.id
  WHERE c.id=? AND c.state=? AND c.status='active' AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor'))`;

export async function GET(request: Request) {
  const access = await requireCouncilAccess(request, new URL(request.url).searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  try {
    const campaigns = await listCouncilCampaigns(access.db, access.council.id);
    const current = await requireCouncilAccess(request, access.council.id);
    return current.ok ? json({ ok: true, campaigns }) : current.response;
  }
  catch { return json({ ok: false, error: "Campaigns could not be loaded. Please try again." }, 503); }
}

async function save(request: Request, update: boolean) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  const access = await requireCouncilAccess(request, new URL(request.url).searchParams.get("councilId") || undefined);
  if (!access.ok) return access.response;
  if (access.council.role === "viewer") return json({ ok: false, error: "Your account has report access. An editor can manage campaigns." }, 403);
  try {
    const raw = await readBoundedJsonRequest(request);
    const input = parseCouncilCampaignInput(raw);
    const fields: Record<string, unknown> = raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw)) : {};
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const guard = [access.council.id, access.council.state, access.identity.uid];
    const auditPrefix = "INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)";
    let audit: D1PreparedStatement;
    let mutation: D1PreparedStatement;
    if (update) {
      if (typeof fields.id !== "string" || fields.id.length > 64 || !["active", "paused"].includes(String(fields.status))) throw new CouncilCampaignInputError("Choose a valid campaign and status.");
      audit = access.db.prepare(`${auditPrefix}
        SELECT ?,?,'council.campaign_updated','council',?,'Updated council campaign.',?,?
        WHERE ${editable} AND EXISTS (SELECT 1 FROM council_campaigns WHERE id=? AND council_id=?)`)
        .bind(auditId, access.identity.uid, access.council.id, JSON.stringify({ campaignId: fields.id, ...input, status: fields.status }), now, ...guard, fields.id, access.council.id);
      mutation = access.db.prepare(`UPDATE council_campaigns SET title=?,kind=?,audience=?,starts_at=?,location=?,meeting_url=?,status=?,updated_at=?
        WHERE id=? AND council_id=? AND EXISTS (SELECT 1 FROM admin_audit_log WHERE id=? AND admin_uid=?)`)
        .bind(input.title,input.kind,input.audience,input.startsAt,input.location,input.meetingUrl,fields.status,now,fields.id,access.council.id,auditId,access.identity.uid);
    } else {
      const id = crypto.randomUUID();
      // Authority and the register limit are checked in the same transaction as the insert.
      audit = access.db.prepare(`${auditPrefix}
        SELECT ?,?,'council.campaign_created','council',?,'Created council campaign.',?,?
        WHERE ${editable} AND (SELECT COUNT(*) FROM council_campaigns WHERE council_id=?)<200`)
        .bind(auditId,access.identity.uid,access.council.id,JSON.stringify({ campaignId: id, ...input, status: "active" }),now,...guard,access.council.id);
      mutation = access.db.prepare(`INSERT INTO council_campaigns (id,council_id,code,title,kind,audience,status,starts_at,location,meeting_url,opens,created_at,updated_at)
        SELECT ?,?,?,?,?,?,'active',?,?,?,0,?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=? AND admin_uid=?)`)
        .bind(id,access.council.id,crypto.randomUUID().replaceAll("-",""),input.title,input.kind,input.audience,input.startsAt,input.location,input.meetingUrl,now,now,auditId,access.identity.uid);
    }
    const result = await access.db.batch([audit, mutation]);
    const campaigns = result[1].meta.changes ? await listCouncilCampaigns(access.db, access.council.id) : [];
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    if (current.council.role === "viewer") return json({ ok: false, error: "Your editor access has changed. Reload the council workspace." }, 403);
    if (!result[1].meta.changes) return json({ ok: false, error: update ? "Campaign was not found in your council."
      : "This council has reached its 200 campaign limit. Contact TLink support to review the campaign register." }, update ? 404 : 409);
    return json({ ok: true, campaigns }, update ? 200 : 201);
  } catch (error) {
    if (error instanceof CouncilCampaignInputError || error instanceof BoundedJsonRequestError) return json({ ok: false, error: error.message }, error instanceof BoundedJsonRequestError ? error.status : 400);
    return json({ ok: false, error: "The campaign could not be saved. Please try again." }, 503);
  }
}
export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
