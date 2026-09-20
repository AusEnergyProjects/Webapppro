export type CreditexVoiceNumber = { id: string; number: string; label: string };
export type CreditexVoiceStaff = { id: string; displayName: string; role: string };
export type CreditexVoiceAssignment = { memberId: string; numberId: string };
export type CreditexVoiceWorkspace = {
  connection: null | { id: string; status: "connecting" | "connected"; accountLabel: string; defaultNumberId: string; defaultNumber: string; errorCode: string };
  numbers: CreditexVoiceNumber[];
  staff: CreditexVoiceStaff[];
  assignments: CreditexVoiceAssignment[];
};
export const CREDITEX_VOICE_WEBHOOK = "https://ausenergyassessments.com/api/creditex/audit-calls/telnyx";

export function creditexVoiceAssignments(value: unknown): CreditexVoiceAssignment[] {
  if (!Array.isArray(value) || value.length > 250) throw new Error("VOICE_ASSIGNMENTS_INVALID");
  const members = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || !("memberId" in item) || !("numberId" in item)
      || typeof item.memberId !== "string" || typeof item.numberId !== "string"
      || !item.memberId || item.memberId.length > 180 || !/^[A-Za-z0-9-]{1,80}$/.test(item.numberId)
      || members.has(item.memberId)) throw new Error("VOICE_ASSIGNMENTS_INVALID");
    members.add(item.memberId);
    return { memberId: item.memberId, numberId: item.numberId };
  });
}
