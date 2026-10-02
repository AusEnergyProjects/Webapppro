export type PortalWorkspace = "admin" | "creditex";
export type PortalPerson = { id: string; name: string; role: string; avatarRevision: string };
export type PortalMessage = { id: string; body: string; senderId: string; senderName: string; senderAvatarRevision: string; recipientId: string; createdAt: string };
export type PortalTask = {
  id: string; title: string; detail: string; assigneeId: string; assigneeName: string;
  creatorId: string; creatorName: string; status: "open" | "done"; dueOn: string;
  createdAt: string; updatedAt: string; completedAt: string; revision: number; canEdit: boolean; canComplete: boolean;
};
export type PortalTaskCapabilities = { canViewTeam: boolean; canCreate: boolean; canAssign: boolean; canComplete: boolean };
export type PortalTaskList = PortalTaskCapabilities & { tasks: PortalTask[]; page: number; totalPages: number; total: number };
export type PortalPeople = PortalTaskCapabilities & { people: PortalPerson[]; hasMore: boolean; memberId: string };
export type PortalMessageList = { messages: PortalMessage[]; before: string; hasMore: boolean; memberId: string; canSend: boolean };

export class PortalTeamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function portalWorkspace(value: unknown): PortalWorkspace {
  if (value !== "admin" && value !== "creditex") throw new PortalTeamError(400, "Choose a workspace.");
  return value;
}
export function portalText(value: unknown, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) {
    throw new PortalTeamError(400, "Check the entered details and their length.");
  }
  return value.trim();
}
export function portalIdentifier(value: unknown): string {
  const id = portalText(value, 180, true);
  if (!/^[A-Za-z0-9:_-]+$/.test(id)) throw new PortalTeamError(400, "Choose a valid team member or record.");
  return id;
}
export function portalRequestId(value: unknown): string {
  const id = portalIdentifier(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new PortalTeamError(400, "Refresh and try the request again.");
  }
  return id;
}
export function portalDueDate(value: unknown): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new PortalTeamError(400, "Choose a valid due date.");
  }
  return value;
}
