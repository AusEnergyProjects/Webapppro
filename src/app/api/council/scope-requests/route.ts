import { requireCouncilAccess, councilJson } from "@/lib/council-access-server";
import { readBoundedJsonRequest, BoundedJsonRequestError } from "@/lib/bounded-json-request";
import { residentialStateFromPostcode } from "@/lib/australian-postcodes.mjs";

export const runtime = "edge";
export async function GET(request: Request) {
  const access = await requireCouncilAccess(request);
  if (!access.ok) return access.response;
  try {
    const result = await access.db.prepare("SELECT id,postcodes_json,status,created_at FROM council_scope_requests WHERE council_id=? ORDER BY created_at DESC LIMIT 50").bind(access.council.id).all<{ id: string; postcodes_json: string; status: string; created_at: string }>();
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    return councilJson({ ok: true, requests: result.results.map((row) => ({ id: row.id, postcodes: JSON.parse(row.postcodes_json), status: row.status, createdAt: row.created_at })) });
  } catch { return councilJson({ ok: false, error: "Postcode requests could not be loaded." }, 503); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return councilJson({ ok: false, error: "Request origin was not accepted." }, 403);
  const access = await requireCouncilAccess(request);
  if (!access.ok) return access.response;
  if (access.council.role === "viewer") return councilJson({ ok: false, error: "An editor can request a change to the reporting area." }, 403);
  try {
    const raw = await readBoundedJsonRequest(request);
    const input = raw && typeof raw === "object" && "postcodes" in raw ? raw.postcodes : null;
    if (!Array.isArray(input) || input.length < 1 || input.length > 100 || input.some((value) => typeof value !== "string" || !/^\d{4}$/.test(value) || residentialStateFromPostcode(value) !== access.council.state)) return councilJson({ ok: false, error: `Enter valid residential postcodes in ${access.council.state}.` }, 400);
    const postcodes = [...new Set<string>(input)].filter((postcode) => !access.council.postcodes.includes(postcode)).sort();
    if (!postcodes.length) return councilJson({ ok: false, error: "Those postcodes are already approved." }, 400);
    const id = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();
    // The guarded audit authorises the insert inside one D1 transaction.
    const result = await access.db.batch([
      access.db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)
        SELECT ?,?,'council.scope_requested','council',?,'Requested council reporting postcodes.',?,?
        WHERE EXISTS (SELECT 1 FROM council_organisations c JOIN council_memberships m ON m.council_id=c.id
          WHERE c.id=? AND c.state=? AND c.status='active' AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor'))
        AND NOT EXISTS (SELECT 1 FROM council_scope_requests WHERE council_id=? AND status='pending')`)
        .bind(auditId,access.identity.uid,access.council.id,JSON.stringify({ requestId: id, postcodes }),now,access.council.id,access.council.state,access.identity.uid,access.council.id),
      access.db.prepare(`INSERT INTO council_scope_requests (id,council_id,postcodes_json,status,requested_by_uid,created_at)
        SELECT ?,?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE id=? AND admin_uid=?)`)
        .bind(id,access.council.id,JSON.stringify(postcodes),access.identity.uid,now,auditId,access.identity.uid),
    ]);
    const current = await requireCouncilAccess(request, access.council.id);
    if (!current.ok) return current.response;
    if (current.council.role === "viewer") return councilJson({ ok: false, error: "Your editor access has changed. Reload the council workspace." }, 403);
    if (!result[1].meta.changes) return councilJson({ ok: false, error: "A postcode request is already awaiting review. Contact TLink support to change that request." }, 409);
    return councilJson({ ok: true }, 201);
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) return councilJson({ ok: false, error: error.message }, error.status);
    return councilJson({ ok: false, error: "The postcode request could not be saved." }, 503);
  }
}
