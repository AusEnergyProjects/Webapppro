import type { TradeMessageReceipt as TeamMessageReceipt } from "@/lib/trade-message-receipts";
import styles from "./TradeMessageReceipt.module.css";

function time(value: string) {
  return new Date(value).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function MessageTicks({ status }: { status: "sent" | "delivered" | "read" }) {
  return <svg width="21" height="13" viewBox="0 0 25 16" fill="none" aria-hidden="true"><path d="m2 8 4 4L16 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />{status !== "sent" && <path d="m11 9 3 3L24 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}</svg>;
}

export default function TradeMessageReceipt({ receipt }: { receipt?: TeamMessageReceipt | null }) {
  // Only persisted messages render this component. A missing receipt on an older
  // response confirms sending, never delivery or a read.
  const status = receipt?.status || "sent";
  const label = status === "read" ? `Read${receipt?.readAt ? ` ${time(receipt.readAt)}` : " · time unavailable"}`
    : status === "delivered" ? "Delivered" : "Sent";
  const partial = receipt && receipt.recipientCount > 1 && receipt.readCount > 0 && status !== "read"
    ? ` · ${receipt.readCount}/${receipt.recipientCount} read` : "";
  const detail = receipt?.recipients.map(person => `${person.name}: ${person.status === "read" ? `Read${person.readAt ? ` ${time(person.readAt)}` : " (time unavailable)"}` : person.status === "delivered" ? "Delivered" : "Sent"}`).join("\n") || label;
  return <span className={`${styles.receipt} ${status === "read" ? styles.read : ""}`} role="img" aria-label={label + partial} title={detail}>
    <MessageTicks status={status} />
    {status === "read" ? <span aria-hidden="true">{label}</span> : partial ? <span aria-hidden="true">{partial.slice(3)}</span> : null}
  </span>;
}
