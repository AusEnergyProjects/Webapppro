export const TRADE_QUOTE_VIEWS = [
  { key: "preparing", label: "Preparing", description: "Drafts and work you have chosen to quote." },
  { key: "awaiting", label: "Awaiting customer", description: "Issued quotes waiting for a decision. These stay here until the customer responds or you mark the job as lost." },
  { key: "accepted", label: "Accepted", description: "Agreed quotes, ready to open and prepare the job." },
  { key: "history", label: "Lost / history", description: "Lost, declined and cancelled quotes, kept for reference." },
] as const;

export type TradeQuoteView = typeof TRADE_QUOTE_VIEWS[number]["key"];
export type TradeQuoteIndexItem = {
  id: string;
  workNumber: string;
  title: string;
  customerName: string;
  quoteNumber: string;
  view: TradeQuoteView;
  status: string;
  versionNumber: number | null;
  totalCents: number | null;
  hasChoices: boolean;
  latestIssued: { versionNumber: number; status: string; issuedAt: string; decidedAt: string } | null;
  delivery: { status: string; label: string; sentAt: string; deliveredAt: string } | null;
};
export type TradeQuoteIndex = {
  items: TradeQuoteIndexItem[];
  counts: Record<TradeQuoteView, number>;
  pagination: { page: number; pageSize: number; total: number; pageCount: number; hasNext: boolean; nextCursor: string };
};

export function tradeQuoteIndexStatusLabel(status: string) {
  const labels: Record<string, string> = {
    not_started: "Ready to prepare", draft: "Draft", issuing: "Preparing to send",
    issued: "Awaiting customer", accepted: "Accepted", declined: "Declined",
    lost: "Lost", cancelled: "Cancelled", customer_changed: "Customer changed, review quote", decision_missing: "Acceptance needs review",
  };
  return labels[status] || "Open to review";
}
