export const TRADE_QUOTE_DRAFT_SAVED_EVENT = "tlink:quote-draft-saved";

export type TradeQuoteDraftSaved = {
  actorUid: string;
  ownerUid: string;
  workOrderId: string;
};

export function readTradeQuoteDraftSaved(value: unknown): TradeQuoteDraftSaved | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("actorUid" in value) || !("ownerUid" in value) || !("workOrderId" in value) || Object.keys(value).length !== 3) return null;
  const { actorUid, ownerUid, workOrderId } = value;
  if (![actorUid, ownerUid, workOrderId].every(id => typeof id === "string" && id.length > 0 && id.length <= 180 && id.trim() === id)) return null;
  if (typeof actorUid !== "string" || typeof ownerUid !== "string" || typeof workOrderId !== "string") return null;
  return { actorUid, ownerUid, workOrderId };
}

export function notifyTradeQuoteDraftSaved(detail: TradeQuoteDraftSaved): void {
  if (typeof window !== "undefined" && readTradeQuoteDraftSaved(detail)) {
    window.dispatchEvent(new CustomEvent(TRADE_QUOTE_DRAFT_SAVED_EVENT, { detail }));
  }
}
