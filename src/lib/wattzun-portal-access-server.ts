import { getD1 } from "../../db";
import { requireFirebaseIdentity } from "./firebase-server";
import { listTradeBusinesses, TradeBusinessContextError } from "./trade-business-context-server";
import { requireInstallerTeamAccess } from "./trade-team-server";
import { TradeAccessError } from "./trade-access-server";
import { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE } from "./firebase-mfa";
import { councilMemberships, requireCouncilAccess } from "./council-access-server";
import { ComplianceAccessError, requireComplianceAccess } from "./compliance-access-server";
import { CREDITEX_PARTNER_ORGANISATION_CODE } from "./trade-compliance-intent";
import type { WattzunPortal, WattzunScope } from "./wattzun-portal";

export class WattzunAccessError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export type WattzunAccess = { db: D1Database; actorUid: string; scope: WattzunScope };

export async function authenticateWattzun(request: Request): Promise<void> {
  const identity = await requireFirebaseIdentity(request);
  if (!identity.emailVerified) throw new WattzunAccessError(403, "Verify your email before opening Wattzun in this workspace.");
}
export async function requireWattzunAccess(request: Request, portal: WattzunPortal, scopeId: string): Promise<WattzunAccess> {
  if (portal === "trade") {
    const headers = new Headers(request.headers);
    headers.set("X-TLink-Business", scopeId);
    // Access checks need identity and the selected business, never the request's consumed body.
    const access = await requireInstallerTeamAccess(new Request(request.url, { headers }));
    if (access.ownerUid !== scopeId) throw new WattzunAccessError(403, "Choose a business you have access to.");
    return { db: getD1(), actorUid: access.actorUid, scope: { portal, scopeId: access.ownerUid, label: access.businessName } };
  }
  if (portal === "creditex") {
    const db = getD1();
    const access = await requireComplianceAccess(request, { organisationId: scopeId, claimPendingInvitation: false }, db);
    if (access.organisationCode !== CREDITEX_PARTNER_ORGANISATION_CODE || access.organisationId !== scopeId) {
      throw new WattzunAccessError(403, "Current Creditex workspace access is required.");
    }
    return { db, actorUid: access.uid, scope: { portal, scopeId: access.organisationId,
      label: access.organisationTradingName || access.organisationLegalName } };
  }
  const access = await requireCouncilAccess(request, scopeId);
  if (!access.ok) throw new WattzunAccessError(access.response.status, access.response.status === 401
    ? "Sign in to your council workspace to continue." : "Current access to this council workspace is required.");
  return { db: access.db, actorUid: access.identity.uid, scope: { portal, scopeId: access.council.id, label: access.council.name } };
}

function unavailableMembership(error: unknown) {
  return error instanceof WattzunAccessError && error.status === 403
    || error instanceof TradeAccessError && error.status === 403
    || error instanceof TradeBusinessContextError && error.status === 403
    || error instanceof ComplianceAccessError && error.status === 403;
}
export async function listWattzunScopes(request: Request, portal: WattzunPortal): Promise<WattzunScope[]> {
  const identity = await requireFirebaseIdentity(request);
  if (!identity.emailVerified) throw new WattzunAccessError(403, "Verify your email before opening Wattzun.");
  const db = getD1();
  let ids: string[];
  if (portal === "trade") ids = (await listTradeBusinesses(identity)).map(business => business.ownerUid);
  else if (portal === "council") ids = (await councilMemberships(db, identity)).map(council => council.id);
  else {
    const rows = await db.prepare(`SELECT organisation.id FROM compliance_users member
      JOIN compliance_organisations organisation ON organisation.id=member.organisation_id
      WHERE member.firebase_uid=? AND member.status='active' AND organisation.status='active'
        AND organisation.organisation_code=? ORDER BY organisation.id`)
      .bind(identity.uid, CREDITEX_PARTNER_ORGANISATION_CODE).all<{ id: string }>();
    ids = rows.results.map(row => row.id);
  }
  const scopes: WattzunScope[] = [];
  for (const id of new Set(ids)) {
    try { scopes.push((await requireWattzunAccess(request, portal, id)).scope); }
    catch (error) { if (!unavailableMembership(error)) throw error; }
  }
  return scopes;
}

export function wattzunAccessFailure(error: unknown): { status: number; message: string } | null {
  if (error instanceof WattzunAccessError) return { status: error.status, message: error.message };
  if (error instanceof TradeBusinessContextError) return { status: error.status, message: error.publicMessage };
  if (error instanceof TradeAccessError || error instanceof ComplianceAccessError) return { status: error.status, message: error.message };
  if (error instanceof FirebaseMfaRequiredError) return { status: 403, message: MFA_REQUIRED_MESSAGE };
  if (error instanceof Error && error.message === "AUTH_REQUIRED") return { status: 401, message: "Sign in to your workspace to continue." };
  return null;
}
