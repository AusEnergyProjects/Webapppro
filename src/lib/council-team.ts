import type { CouncilRole } from "./council-access-server";

export type CouncilTeamMember = {
  id: string;
  email: string;
  displayName: string;
  role: CouncilRole;
  status: "active" | "suspended";
  pending: boolean;
  isSelf: boolean;
  createdAt: string;
  acceptedAt: string | null;
  updatedAt: string;
};

export type CouncilTeam = {
  councilId: string;
  canManage: boolean;
  members: CouncilTeamMember[];
  invitationPath: "/council";
};

export type CouncilTeamAction =
  | { action: "invite"; email: string; displayName: string; role: "editor" | "viewer" }
  | { action: "role"; membershipId: string; role: CouncilRole }
  | { action: "revoke" | "restore"; membershipId: string };

export const COUNCIL_TEAM_MAX_BODY_BYTES = 4096;
export class CouncilTeamInputError extends Error {}

export function parseCouncilTeamAction(value: unknown): CouncilTeamAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CouncilTeamInputError("Send a valid team action.");
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const allowed = raw.action === "invite" ? ["action", "email", "displayName", "role"]
    : raw.action === "role" ? ["action", "membershipId", "role"] : ["action", "membershipId"];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new CouncilTeamInputError("The team action contains unsupported fields.");
  if (raw.action === "invite") {
    const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)) throw new CouncilTeamInputError("Enter a valid invitation email address.");
    if (typeof raw.displayName !== "string" || displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) throw new CouncilTeamInputError("Use a name of up to 120 characters without line breaks.");
    if (raw.role !== "viewer" && raw.role !== "editor") throw new CouncilTeamInputError("Invite a viewer or editor. An owner can change their role afterwards.");
    return { action: "invite", email, displayName, role: raw.role };
  }
  if (typeof raw.membershipId !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(raw.membershipId)) throw new CouncilTeamInputError("Choose a valid team member.");
  if (raw.action === "role") {
    if (raw.role !== "owner" && raw.role !== "editor" && raw.role !== "viewer") throw new CouncilTeamInputError("Choose a valid council role.");
    return { action: "role", membershipId: raw.membershipId, role: raw.role };
  }
  if (raw.action === "revoke" || raw.action === "restore") return { action: raw.action, membershipId: raw.membershipId };
  throw new CouncilTeamInputError("Choose a supported team action.");
}

export function createCouncilDemoTeam(): CouncilTeam {
  const timestamp = "2026-09-01T00:00:00.000Z";
  return { councilId: "demonstration", canManage: true, invitationPath: "/council", members: [
    { id: "demo-owner", displayName: "You", email: "owner@greendale.example", role: "owner", status: "active", pending: false, isSelf: true, createdAt: timestamp, acceptedAt: timestamp, updatedAt: timestamp },
    { id: "demo-editor", displayName: "Community programs", email: "programs@greendale.example", role: "editor", status: "active", pending: false, isSelf: false, createdAt: timestamp, acceptedAt: timestamp, updatedAt: timestamp },
    { id: "demo-viewer", displayName: "Sustainability reporting", email: "reporting@greendale.example", role: "viewer", status: "active", pending: true, isSelf: false, createdAt: timestamp, acceptedAt: null, updatedAt: timestamp },
  ] };
}

/** Local practice only. The live server independently enforces these access rules. */
export function applyCouncilDemoTeamAction(team: CouncilTeam, action: CouncilTeamAction): CouncilTeam {
  if (!team.canManage) throw new CouncilTeamInputError("Only a council owner can manage the team.");
  const now = new Date().toISOString();
  if (action.action === "invite") {
    if (team.members.some(member => member.email === action.email)) throw new CouncilTeamInputError("This email is already on the team. Restore its access if needed.");
    return { ...team, members: [...team.members, { id: `demo-${crypto.randomUUID()}`, email: action.email, displayName: action.displayName, role: action.role, status: "active", pending: true, isSelf: false, createdAt: now, acceptedAt: null, updatedAt: now }] };
  }
  const member = team.members.find(candidate => candidate.id === action.membershipId);
  if (!member) throw new CouncilTeamInputError("This team member could not be found.");
  if (member.isSelf) throw new CouncilTeamInputError("Ask another owner to change your own access.");
  if (action.action !== "restore" && member.role === "owner" && member.status === "active" && !team.members.some(candidate => candidate.id !== member.id && candidate.role === "owner" && candidate.status === "active" && !candidate.pending)) throw new CouncilTeamInputError("Keep at least one accepted owner on the team.");
  if ((action.action === "restore") !== (member.status === "suspended")) throw new CouncilTeamInputError("This member's access has changed. Refresh the team list.");
  return { ...team, members: team.members.map(candidate => candidate.id === member.id ? {
    ...candidate, role: action.action === "role" ? action.role : candidate.role,
    status: action.action === "revoke" ? "suspended" : "active", updatedAt: now,
  } : candidate) };
}
