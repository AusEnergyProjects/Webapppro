export type SavedMessageSource = {
  source: "team_chat"; threadId: string; threadName: string; messageId: string;
  senderMemberId: string; senderName: string; messageCreatedAt: string;
  savedByMemberId: string; savedByUid: string; savedByName: string; savedAt: string;
  itemKind: "link" | "image" | "audio"; sourceAttachmentId: string; url: string;
};

export type SavedMessageJobFile = {
  id: string; fileName: string; contentType: string; sizeBytes: number; source: SavedMessageSource;
};

export function safeMessageLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function messageLinks(body: string): string[] {
  const links = (body.match(/https?:\/\/[^\s<>"']+/gi) || []).map(value => {
    let candidate = value.replace(/[.,;!?]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (candidate.endsWith(close) && candidate.split(close).length > candidate.split(open).length) candidate = candidate.slice(0, -1);
    }
    return safeMessageLink(candidate);
  });
  return [...new Set(links.filter((value): value is string => Boolean(value)))].slice(0, 10);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function savedMessageSource(value: string): SavedMessageSource {
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed)) throw new Error("CHAT_FILE_METADATA_INVALID");
  const fields = ["threadId", "threadName", "messageId", "senderMemberId", "senderName", "messageCreatedAt",
    "savedByMemberId", "savedByUid", "savedByName", "savedAt", "sourceAttachmentId", "url"] as const;
  if (!("source" in parsed) || parsed.source !== "team_chat" || !("itemKind" in parsed)
    || !["link", "image", "audio"].includes(String(parsed.itemKind))) throw new Error("CHAT_FILE_METADATA_INVALID");
  const result: Record<string, string> = {};
  for (const key of fields) {
    const value = parsed[key];
    if (typeof value !== "string") throw new Error("CHAT_FILE_METADATA_INVALID");
    result[key] = value;
  }
  const itemKind = parsed.itemKind === "link" ? "link" : parsed.itemKind === "image" ? "image" : "audio";
  if (itemKind === "link" && !safeMessageLink(result.url)) throw new Error("CHAT_FILE_METADATA_INVALID");
  return { source: "team_chat", itemKind, threadId: result.threadId, threadName: result.threadName, messageId: result.messageId,
    senderMemberId: result.senderMemberId, senderName: result.senderName, messageCreatedAt: result.messageCreatedAt,
    savedByMemberId: result.savedByMemberId, savedByUid: result.savedByUid, savedByName: result.savedByName,
    savedAt: result.savedAt, sourceAttachmentId: result.sourceAttachmentId, url: result.url };
}
