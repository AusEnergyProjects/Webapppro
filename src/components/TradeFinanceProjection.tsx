import type { BusinessReport } from "@/lib/trade-business-reports";
import { revenueProjection } from "@/lib/trade-finance-projection";
import styles from "./TradeBusinessReports.module.css";

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const exactMoney = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const date = (day: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export function TradeFinanceProjection({ report }: { report: BusinessReport }) {
  const projection = revenueProjection(report);
  if (!projection.available && projection.reason === "no_access") return null;
  return <section className={styles.card} aria-label="Revenue projection">
    <header><div><h4>Revenue projection</h4><p>An estimate if the selected period&apos;s daily net invoicing pace continues.</p></div></header>
    {projection.available ? <>
      <div className={styles.metrics}>{projection.estimates.map(estimate => <div key={estimate.days} className={styles.metric}>
        <span>Next {estimate.days} days</span><strong>{money(estimate.cents)}</strong>
        <small>{date(projection.startsOn)} to {date(estimate.endsOn)}</small>
        <small>Net invoicing, excluding GST</small>
      </div>)}</div>
      <p className={styles.hint}>Based on {exactMoney(projection.netInvoicedCents)} net invoicing over {projection.elapsedDays} calendar {projection.elapsedDays === 1 ? "day" : "days"}, {date(projection.sourceStart)} to {date(projection.sourceEnd)}. Daily pace: {exactMoney(projection.dailyInvoicedCents)}, excluding GST.</p>
      <p className={styles.hint}>Issued invoices less credits. Unpaid balances are excluded. This estimates future invoicing, not cash receipts, profit or guaranteed revenue.</p>
    </> : <p>{projection.message}</p>}
  </section>;
}
