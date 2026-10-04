import { getD1 } from "../../../../../db";
import { adminAuditStatement, adminError, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { councilJson, isCouncilRole } from "@/lib/council-access-server";
import { canonicalAustralianState, residentialStateFromPostcode } from "@/lib/australian-postcodes.mjs";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/bounded-request-body.mjs";

export const runtime = "edge";
const MAX_BODY_BYTES = 16_384;
const MAX_POSTCODES = 100;

type CouncilRow = { id: string; name: string; slug: string; state: string; status: string; created_at: string; updated_at: string };
type MemberRow = { id: string; council_id: string; email: string; display_name: string; role: string; status: string; firebase_uid: string | null };
type ScopeRequestRow = { id: string; council_id: string; postcodes_json: string; status: string; created_at: string };

class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function text(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.trim().length > maximum) throw new InputError("Check the text fields and try again.");
  return value.trim();
}

function postcodes(value: unknown, state: string) {
  if (!Array.isArray(value) || value.length > MAX_POSTCODES || value.some((item) => typeof item !== "string" || !/^\d{4}$/.test(item) || residentialStateFromPostcode(item) !== state)) {
    throw new InputError(`Choose up to ${MAX_POSTCODES} valid ${state} postcodes. Approve only the council's agreed reporting area.`);
  }
  return [...new Set<string>(value)].sort();
}

function membership(body: Record<string, unknown>) {
  const email = text(body.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Enter a valid council member email address.");
  const role = body.role || "owner";
  if (!isCouncilRole(role)) throw new InputError("Choose owner, editor or viewer access.");
  const displayName = body.displayName === undefined ? "" : text(body.displayName, 120);
  return { email, role, displayName };
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") || "").includes("application/json")) throw new InputError("Send council settings as JSON.", 415);
  try {
    const value: unknown = JSON.parse(await readBoundedRequestText(request, MAX_BODY_BYTES));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("Send valid council settings.");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw new InputError("Council settings are too large.", 413);
    if (error instanceof InputError) throw error;
    throw new InputError("Send valid council settings.");
  }
}

export async function GET(request: Request) {
  try {
    await requireAdminIdentity(request, ["owner", "admin"]);
    const db = getD1();
    const [organisations, scopes, members, requests] = await Promise.all([
      db.prepare("SELECT id, name, slug, state, status, created_at, updated_at FROM council_organisations ORDER BY name").all<CouncilRow>(),
      db.prepare("SELECT council_id, postcode FROM council_postcodes ORDER BY postcode").all<{ council_id: string; postcode: string }>(),
      db.prepare("SELECT id, council_id, email, display_name, role, status, firebase_uid FROM council_memberships ORDER BY email").all<MemberRow>(),
      db.prepare("SELECT id, council_id, postcodes_json, status, created_at FROM council_scope_requests ORDER BY created_at DESC").all<ScopeRequestRow>(),
    ]);
    return councilJson({ ok: true, councils: organisations.results.map((council) => ({
      id: council.id, name: council.name, slug: council.slug, state: council.state, status: council.status,
      createdAt: council.created_at, updatedAt: council.updated_at,
      postcodes: scopes.results.filter((scope) => scope.council_id === council.id).map((scope) => scope.postcode),
      members: members.results.filter((member) => member.council_id === council.id).map((member) => ({
        id: member.id, email: member.email, displayName: member.display_name, role: member.role, status: member.status, pending: member.firebase_uid === null,
      })),
      scopeRequests: requests.results.filter((scope) => scope.council_id === council.id).map((scope) => ({
        id: scope.id, postcodes: JSON.parse(scope.postcodes_json), status: scope.status, createdAt: scope.created_at,
      })),
    })) });
  } catch (error) { return adminError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return councilJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const admin = await requireAdminIdentity(request, ["owner", "admin"]);
    const body = await readBody(request);
    const db = getD1();
    const now = new Date().toISOString();
    const action = text(body.action, 30);
    if (action === "create") {
      const name = text(body.name, 120);
      const slug = text(body.slug, 64).toLowerCase();
      const state = canonicalAustralianState(body.state);
      if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || !state) throw new InputError("Enter a council name, a valid URL name and an Australian state.");
      const scope = postcodes(body.postcodes, state);
      const invite = membership(body);
      const existing = await db.prepare("SELECT id FROM council_organisations WHERE slug = ?").bind(slug).first();
      if (existing) throw new InputError("That council URL is already registered.", 409);
      const id = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO council_organisations (id,name,slug,state,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)").bind(id, name, slug, state, now, now),
        db.prepare(`INSERT INTO council_memberships (id,council_id,email,display_name,role,status,invited_by_uid,created_at,updated_at)
          VALUES (?,?,?,?,?,'active',?,?,?)`).bind(memberId, id, invite.email, invite.displayName, invite.role, admin.uid, now, now),
        ...scope.map((postcode) => db.prepare("INSERT INTO council_postcodes (council_id,state,postcode,approved_by_uid,created_at) VALUES (?,?,?,?,?)").bind(id, state, postcode, admin.uid, now)),
        adminAuditStatement(db, admin, "council.created", "council", id, "Created council workspace with approved reporting scope and member invitation.", { name, state, postcodes: scope, memberId, role: invite.role }),
      ]);
      return councilJson({ ok: true, councilId: id }, 201);
    }

    const councilId = text(body.councilId, 180);
    const council = await db.prepare("SELECT id,name,slug,state,status,created_at,updated_at FROM council_organisations WHERE id = ?").bind(councilId).first<CouncilRow>();
    if (!council) throw new InputError("Council workspace not found.", 404);
    if (action === "update") {
      const name = text(body.name, 120);
      const status = body.status;
      if (name.length < 2 || (status !== "active" && status !== "suspended")) throw new InputError("Enter a council name and valid access status.");
      if (body.state !== undefined && body.state !== council.state) throw new InputError("The council state cannot be changed. Review its approved scope instead.");
      await db.batch([
        db.prepare("UPDATE council_organisations SET name = ?, status = ?, updated_at = ? WHERE id = ?").bind(name, status, now, councilId),
        adminAuditStatement(db, admin, "council.updated", "council", councilId, "Updated council organisation details or access.", { before: { name: council.name, status: council.status }, name, status }),
      ]);
    } else if (action === "invite") {
      const invite = membership(body);
      const existing = await db.prepare("SELECT id FROM council_memberships WHERE council_id = ? AND email = ?").bind(councilId, invite.email).first();
      if (existing) throw new InputError("That email already has a council membership. Update its existing access instead.", 409);
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO council_memberships (id,council_id,email,display_name,role,status,invited_by_uid,created_at,updated_at)
          VALUES (?,?,?,?,?,'active',?,?,?)`).bind(id, councilId, invite.email, invite.displayName, invite.role, admin.uid, now, now),
        adminAuditStatement(db, admin, "council.member_invited", "council", councilId, "Invited a council member.", { memberId: id, email: invite.email, role: invite.role }),
      ]);
    } else if (action === "member") {
      const memberId = text(body.membershipId, 180);
      const role = body.role;
      const status = body.status;
      if (!isCouncilRole(role) || (status !== "active" && status !== "suspended")) throw new InputError("Choose a valid council role and access status.");
      const member = await db.prepare("SELECT id,role,status FROM council_memberships WHERE id = ? AND council_id = ?").bind(memberId, councilId).first<{ id: string; role: string; status: string }>();
      if (!member) throw new InputError("Council membership not found.", 404);
      await db.batch([
        db.prepare("UPDATE council_memberships SET role = ?, status = ?, updated_at = ? WHERE id = ? AND council_id = ?").bind(role, status, now, memberId, councilId),
        adminAuditStatement(db, admin, "council.member_updated", "council", councilId, "Updated council member access.", { memberId, before: { role: member.role, status: member.status }, role, status }),
      ]);
    } else if (action === "scope") {
      const scope = postcodes(body.postcodes, council.state);
      const requestId = body.requestId === undefined ? "" : text(body.requestId, 180);
      if (requestId) {
        const requestRow = await db.prepare("SELECT id,postcodes_json FROM council_scope_requests WHERE id = ? AND council_id = ? AND status = 'pending'").bind(requestId, councilId).first<{ id: string; postcodes_json: string }>();
        if (!requestRow) throw new InputError("Pending postcode request not found.", 404);
        const requested = postcodes(JSON.parse(requestRow.postcodes_json), council.state);
        if (requested.some((postcode) => !scope.includes(postcode))) throw new InputError("The approved reporting scope must include every postcode in this request.");
      }
      const previous = await db.prepare("SELECT postcode FROM council_postcodes WHERE council_id = ? ORDER BY postcode").bind(councilId).all<{ postcode: string }>();
      await db.batch([
        db.prepare("DELETE FROM council_postcodes WHERE council_id = ?").bind(councilId),
        ...scope.map((postcode) => db.prepare("INSERT INTO council_postcodes (council_id,state,postcode,approved_by_uid,created_at) VALUES (?,?,?,?,?)").bind(councilId, council.state, postcode, admin.uid, now)),
        ...(requestId ? [db.prepare("UPDATE council_scope_requests SET status = 'approved', reviewed_by_uid = ?, reviewed_at = ? WHERE id = ? AND council_id = ? AND status = 'pending'").bind(admin.uid, now, requestId, councilId)] : []),
        adminAuditStatement(db, admin, "council.scope_approved", "council", councilId, "Updated the approved council reporting postcodes.", { before: previous.results.map((row) => row.postcode), postcodes: scope, requestId }),
      ]);
    } else {
      throw new InputError("Choose a supported council management action.");
    }
    return councilJson({ ok: true, councilId });
  } catch (error) {
    if (error instanceof InputError) return councilJson({ ok: false, error: error.message }, error.status);
    return adminError(error);
  }
}
