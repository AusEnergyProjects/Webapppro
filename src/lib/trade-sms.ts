export type TradeSmsStatus = "unknown" | "queued" | "sending" | "sent" | "failed" | "delivered";

const gsmBasic = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const gsmExtended = new Set(Array.from("\f^{}\\[~]|€"));

export function smsSegments(body: string) {
  let septets = 0;
  for (const character of body) {
    if (gsmBasic.has(character)) septets++;
    else if (gsmExtended.has(character)) septets += 2;
    else return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
  }
  return septets <= 160 ? 1 : Math.ceil(septets / 153);
}

export function tradeSmsBody(value: unknown, businessName: string) {
  if (typeof value !== "string") throw new Error("SMS_BODY_INVALID");
  const body = value.trim();
  if (!body || body.length > 480 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)) throw new Error("SMS_BODY_INVALID");
  const sender = businessName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Your trade business";
  return `${sender}: ${body}\nReply STOP to unsubscribe.`;
}

export function twilioSmsStatus(value: unknown): TradeSmsStatus | null {
  const statuses: Record<string, TradeSmsStatus> = { accepted: "queued", queued: "queued", sending: "sending", sent: "sent", delivered: "delivered", undelivered: "failed", failed: "failed", canceled: "failed" };
  return statuses[String(value)] || null;
}

export function smsStatusRank(status: string) {
  return ["unknown", "queued", "sending", "sent", "failed", "delivered"].indexOf(status);
}

export function smsConsentKeyword(body: string, optOutType: string) {
  const keyword = body.trim().toUpperCase();
  if (optOutType === "STOP" || ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"].includes(keyword)) return "stop";
  if (optOutType === "START" || ["START", "YES", "UNSTOP"].includes(keyword)) return "start";
  return "";
}

export function smsDailyLimit(value: unknown) {
  const limit = value === undefined ? 100 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("SMS_LIMIT_INVALID");
  return limit;
}
