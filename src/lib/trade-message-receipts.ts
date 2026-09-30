export type TradeMessageReceiptStatus = "sent" | "delivered" | "read";

export type TradeMessageRecipientReceipt = {
  memberId: string;
  name: string;
  status: TradeMessageReceiptStatus;
  deliveredAt: string | null;
  readAt: string | null;
};

// Only the message's sender receives this projection. Historical reads can
// have unknown timestamps; status remains authoritative in that case.
export type TradeMessageReceipt = {
  status: TradeMessageReceiptStatus;
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
  deliveredAt: string | null;
  readAt: string | null;
  recipients: TradeMessageRecipientReceipt[];
};
