"use client";

import { useState } from "react";
import {
  saveTradeRebateEstimateDraft,
  type TradeRebateEstimateDraft,
} from "@/lib/trade-rebate-draft";

export type TradeRebateEstimateSummary = Omit<
  TradeRebateEstimateDraft,
  "createdAt" | "customerDiscountDollars"
>;

function defaultDiscount(estimate: TradeRebateEstimateSummary) {
  if (estimate.unit !== "AUD") return "";
  const value = Number(estimate.quantity);
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "";
}

export function TradeRebateEstimateAction({
  estimate,
  ownerUid,
}: {
  estimate: TradeRebateEstimateSummary;
  ownerUid: string;
}) {
  const [discount, setDiscount] = useState(() => defaultDiscount(estimate));
  const [saved, setSaved] = useState(false);

  return (
    <section className="trade-rebate-document-action">
      <div>
        <span>USE THIS ESTIMATE</span>
        <strong>{estimate.quantity} {estimate.unit}</strong>
        <small>
          Enter the discount you will pass to the customer. Certificate market
          value and provider fees can vary.
        </small>
      </div>
      <label>
        Customer discount before GST
        <span className="trade-rebate-document-amount">
          <b>$</b>
          <input
            inputMode="decimal"
            value={discount}
            placeholder="0.00"
            onChange={(event) => {
              setDiscount(event.target.value.replace(/[^0-9.]/g, "").slice(0, 11));
              setSaved(false);
            }}
          />
        </span>
      </label>
      <button
        type="button"
        disabled={!/^\d{1,8}(?:\.\d{1,2})?$/.test(discount) || Number(discount) <= 0}
        onClick={() => {
          const draft = saveTradeRebateEstimateDraft(
            window.sessionStorage,
            ownerUid,
            { ...estimate, customerDiscountDollars: discount },
          );
          setSaved(Boolean(draft));
        }}
      >
        {saved ? "Ready for your next quote or invoice" : "Use in next quote or invoice"}
      </button>
    </section>
  );
}
