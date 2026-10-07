import { getD1 } from "../../db";
import { requireFirebaseIdentity, type FirebaseIdentity } from "./firebase-server";

export type CouncilRole = "owner" | "editor" | "viewer";
export type CouncilAccessScope = {
  id: string;
  name: string;
  slug: string;
  state: string;
  postcodes: string[];
  role: CouncilRole;
};

type MembershipRow = {
  id: string;
  name: string;
  slug: string;
  state: string;
  role: string;
};
type PostcodeRow = { council_id: string; postcode: string };

export function councilJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function councilAccessError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return councilJson({ ok: false, code, error: "Sign in to your council account to continue." }, 401);
  if (code === "EMAIL_VERIFICATION_REQUIRED") return councilJson({ ok: false, code, error: "Verify your email address before opening your council workspace." }, 403);
  console.error("Council access unavailable", { reference: crypto.randomUUID() });
  return councilJson({ ok: false, code: "COUNCIL_UNAVAILABLE", error: "Council access is temporarily unavailable. Try again shortly." }, 503);
}

export function isCouncilRole(value: unknown): value is CouncilRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

/** Bind only an existing, active invitation to its verified email owner. No account is provisioned here. */
export async function councilMemberships(db: D1Database, identity: FirebaseIdentity): Promise<CouncilAccessScope[]> {
  if (!identity.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const now = new Date().toISOString();
  // D1 executes these in order in one transaction: claim, then re-read the
  // authoritative membership and postcode scope without separate round trips.
  const [claim, rows, scopes] = await db.batch<MembershipRow | PostcodeRow>([
    db.prepare(`UPDATE council_memberships
    SET firebase_uid = ?, accepted_at = ?, updated_at = ?
    WHERE email = ? AND firebase_uid IS NULL AND status = 'active'
      AND EXISTS (SELECT 1 FROM council_organisations c WHERE c.id = council_memberships.council_id AND c.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM council_memberships bound
        WHERE bound.council_id = council_memberships.council_id AND bound.firebase_uid = ?)`)
      .bind(identity.uid, now, now, identity.email, identity.uid),
    db.prepare(`SELECT c.id, c.name, c.slug, c.state, m.role
    FROM council_memberships m JOIN council_organisations c ON c.id = m.council_id
    WHERE m.firebase_uid = ? AND m.status = 'active' AND c.status = 'active'
    ORDER BY c.name, c.id`).bind(identity.uid),
    db.prepare(`SELECT p.council_id, p.postcode
    FROM council_postcodes p JOIN council_organisations c ON c.id = p.council_id AND c.state = p.state
    JOIN council_memberships m ON m.council_id = c.id
    WHERE m.firebase_uid = ? AND m.status = 'active' AND c.status = 'active'
    ORDER BY p.postcode`).bind(identity.uid),
  ]);
  if (!claim?.success || !rows?.success || !scopes?.success) throw new Error("COUNCIL_ACCESS_UNAVAILABLE");
  return rows.results.flatMap((row) => "id" in row && isCouncilRole(row.role) ? [{
    id: row.id, name: row.name, slug: row.slug, state: row.state, role: row.role,
    postcodes: scopes.results.filter((scope): scope is PostcodeRow => "council_id" in scope && scope.council_id === row.id).map((scope) => scope.postcode),
  }] : []);
}

export type CouncilAccessResult =
  | { ok: true; db: D1Database; identity: FirebaseIdentity; council: CouncilAccessScope }
  | { ok: false; response: Response };

export async function requireCouncilAccess(request: Request, councilId?: string): Promise<CouncilAccessResult> {
  try {
    const identity = await requireFirebaseIdentity(request);
    const db = getD1();
    const memberships = await councilMemberships(db, identity);
    const selectedId = councilId || new URL(request.url).searchParams.get("councilId") || "";
    const council = selectedId
      ? memberships.find((membership) => membership.id === selectedId)
      : memberships.length === 1 ? memberships[0] : undefined;
    if (!council) {
      const multiple = !selectedId && memberships.length > 1;
      return { ok: false, response: councilJson({ ok: false,
        code: multiple ? "COUNCIL_SELECTION_REQUIRED" : "COUNCIL_ACCESS_REQUIRED",
        error: multiple ? "Choose a council workspace to continue." : "Your account does not have access to this council workspace. Ask the workspace administrator for an invitation.",
      }, 403) };
    }
    return { ok: true, db, identity, council };
  } catch (error) {
    return { ok: false, response: councilAccessError(error) };
  }
}
