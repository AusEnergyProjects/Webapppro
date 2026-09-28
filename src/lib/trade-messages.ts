export function teamMessageBody(value: unknown, allowEmpty = false) {
  if (typeof value !== "string") throw new Error("MESSAGE_INVALID");
  const body = value.trim();
  if ((!body && !allowEmpty) || body.length > 2000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)) throw new Error("MESSAGE_INVALID");
  return body;
}

export function messageRequestId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(value)) throw new Error("MESSAGE_REQUEST_INVALID");
  return value;
}

export function teamThreadInput(value: { memberIds?: unknown; subject?: unknown }, actorMemberId: string) {
  if (!Array.isArray(value.memberIds) || !value.memberIds.length || value.memberIds.length > 24
    || value.memberIds.some(id => typeof id !== "string" || !id || id.length > 180)) throw new Error("MESSAGE_MEMBERS_INVALID");
  const memberIds = [...new Set([actorMemberId, ...value.memberIds])].sort();
  if (memberIds.length < 2) throw new Error("MESSAGE_MEMBERS_INVALID");
  const kind = memberIds.length === 2 ? "dm" : "group";
  const subject = typeof value.subject === "string" ? value.subject.trim().replace(/\s+/g, " ") : "";
  if (subject.length > 80 || (kind === "group" && !subject) || /[\u0000-\u001f\u007f]/.test(subject)) throw new Error("MESSAGE_SUBJECT_INVALID");
  return { memberIds, kind, subject: kind === "dm" ? "" : subject, dmKey: kind === "dm" ? JSON.stringify(memberIds) : "" };
}
