export type TeamCallParticipant = {
    memberId: string;
    name: string;
    sessionId: string;
    joinedAt: string;
};
export type TeamCall = {
    id: string;
    threadId: string;
    threadName: string;
    mode: "audio" | "video";
    status: "active" | "ended";
    createdByMemberId: string;
    createdAt: string;
    expiresAt: string;
    participants: TeamCallParticipant[];
};
export type TeamCallSignalPayload = {
    type: "offer" | "answer";
    sdp: string;
} | {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
    usernameFragment?: string | null;
};
export type TeamCallSignal = {
    id: string;
    sequence: number;
    fromMemberId: string;
    fromSessionId: string;
    toSessionId: string;
    requestId: string;
    type: "offer" | "answer" | "ice";
    payload: TeamCallSignalPayload;
};
export const TEAM_CALL_MAX_PARTICIPANTS = 6;
export const TEAM_CALL_MAX_SECONDS = 3600;
export const TEAM_CALL_HEARTBEAT_SECONDS = 45;
export function teamCallId(value: unknown): string {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,120}$/.test(value))
        throw new Error("CALL_INPUT_INVALID");
    return value;
}
export function teamCallMode(value: unknown): "audio" | "video" {
    if (value !== "audio" && value !== "video")
        throw new Error("CALL_INPUT_INVALID");
    return value;
}
export function teamCallCursor(value: unknown): number {
    const cursor = typeof value === "number" ? value : typeof value === "string" && /^\d{1,12}$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw new Error("CALL_INPUT_INVALID");
    return cursor;
}
export function teamCallSignalInput(type: unknown, value: unknown): {
    type: TeamCallSignal["type"];
    payload: TeamCallSignalPayload;
} {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("CALL_SIGNAL_INVALID");
    const data: Record<string, unknown> = value as Record<string, unknown>;
    if (type === "offer" || type === "answer") {
        if (Object.keys(data).some(key => !["type", "sdp"].includes(key)) || data.type !== type || typeof data.sdp !== "string" || !data.sdp.startsWith("v=0") || data.sdp.length > 60000 || /\0/.test(data.sdp))
            throw new Error("CALL_SIGNAL_INVALID");
        return { type, payload: { type, sdp: data.sdp } };
    }
    if (type !== "ice" || Object.keys(data).some(key => !["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"].includes(key))
        || typeof data.candidate !== "string" || data.candidate.length > 2048 || /[\r\n\0]/.test(data.candidate)
        || (data.sdpMid != null && (typeof data.sdpMid !== "string" || data.sdpMid.length > 100))
        || (data.sdpMLineIndex != null && (typeof data.sdpMLineIndex !== "number" || !Number.isInteger(data.sdpMLineIndex) || data.sdpMLineIndex < 0 || data.sdpMLineIndex > 1000))
        || (data.usernameFragment != null && (typeof data.usernameFragment !== "string" || data.usernameFragment.length > 256)))
        throw new Error("CALL_SIGNAL_INVALID");
    return { type, payload: { candidate: data.candidate, sdpMid: typeof data.sdpMid === "string" ? data.sdpMid : null, sdpMLineIndex: typeof data.sdpMLineIndex === "number" ? data.sdpMLineIndex : null,
            ...(data.usernameFragment !== undefined ? { usernameFragment: typeof data.usernameFragment === "string" ? data.usernameFragment : null } : {}) } };
}
