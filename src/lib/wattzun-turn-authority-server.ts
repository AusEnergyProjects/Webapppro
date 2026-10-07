import { getD1 } from "../../db";
import { requireInstallerTeamAccess, type TeamAccess } from "./trade-team-server";
import { requireWattzunAccess, WattzunAccessError, type WattzunAccess } from "./wattzun-portal-access-server";
import type { WattzunPortal } from "./wattzun-portal";

/** One completed authority read, owned by one turn. Never a pending-I/O cache. */
export type WattzunTurnAuthority = {
  readonly access: WattzunAccess;
  readonly tradeTeam?: TeamAccess;
};
export type WattzunTurnAuthorityDependencies = {
  team: typeof requireInstallerTeamAccess;
  access: typeof requireWattzunAccess;
  database: typeof getD1;
};
const defaults: WattzunTurnAuthorityDependencies = { team: requireInstallerTeamAccess, access: requireWattzunAccess, database: getD1 };

export function requireWattzunTurnTeam(authority: WattzunTurnAuthority): TeamAccess {
  const { access, tradeTeam } = authority;
  if (access.scope.portal !== "trade" || !tradeTeam || tradeTeam.actorUid !== access.actorUid
    || tradeTeam.ownerUid !== access.scope.scopeId || tradeTeam.businessName !== access.scope.label) {
    throw new WattzunAccessError(403, "Your business or access changed. Start the task again.");
  }
  return tradeTeam;
}

export async function readWattzunTurnAuthority(request: Request, portal: WattzunPortal, scopeId: string,
  previous?: WattzunTurnAuthority, deps: WattzunTurnAuthorityDependencies = defaults): Promise<WattzunTurnAuthority> {
  request.signal.throwIfAborted();
  let authority: WattzunTurnAuthority;
  if (portal === "trade") {
    const headers = new Headers(request.headers); headers.set("X-TLink-Business", scopeId); headers.delete("Content-Length");
    const team = await deps.team(new Request(request.url, { headers, signal: request.signal }));
    if (team.ownerUid !== scopeId) throw new WattzunAccessError(403, "Choose a business you have access to.");
    authority = { tradeTeam: team, access: { db: deps.database(), actorUid: team.actorUid,
      scope: { portal, scopeId: team.ownerUid, label: team.businessName } } };
  } else authority = { access: await deps.access(request, portal, scopeId) };
  request.signal.throwIfAborted();
  const current = authority.access;
  if (current.scope.portal !== portal || current.scope.scopeId !== scopeId || previous
    && (current.actorUid !== previous.access.actorUid || current.scope.portal !== previous.access.scope.portal
      || current.scope.scopeId !== previous.access.scope.scopeId || current.scope.label !== previous.access.scope.label)) {
    throw new WattzunAccessError(403, "Your workspace changed. Refresh before continuing with Wattzun.");
  }
  return authority;
}
