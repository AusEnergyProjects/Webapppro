"use client";

import { useId } from "react";
import { annualPlanDifference, type PublishedPlanMatch } from "@/lib/published-plan-reference";
import styles from "./CurrentPlanComparison.module.css";

function money(value: number): string {
  return "$" + value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CurrentPlanInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return <div className={styles.input}>
    <label htmlFor={id}>Your current Plan or Offer ID <span>(optional)</span></label>
    <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} maxLength={128} autoComplete="off" spellCheck={false} aria-describedby={`${id}-help`} placeholder="e.g. 1ST787440MR" />
    <p id={`${id}-help`}>Copy the code for the plan you are on from your bill or plan fact sheet. It is different from your account or meter number. Some bills advertise another offer, so check which plan the code belongs to. No code? Leave this blank.</p>
  </div>;
}

export function CurrentPlanComparison({ value, onChange, match, selectedKey, onSelect, fuel }: {
  value: string;
  onChange: (value: string) => void;
  match: PublishedPlanMatch;
  selectedKey: string;
  onSelect: (key: string) => void;
  fuel: "electricity" | "gas";
}) {
  const id = useId();
  return <section className={styles.reference} aria-labelledby={id}>
    <h2 id={id}>Compare with the plan on your bill</h2>
    <CurrentPlanInput value={value} onChange={onChange} />
    <div className={styles.result} role="status">
      {match.status === "empty" && <p>Add its ID to see how each offer compares with the published prices for that plan.</p>}
      {match.status === "invalid" && <p>Enter the Plan or Offer ID, rather than a website link. You can also leave it blank and compare the available offers.</p>}
      {match.status === "missing" && <p>We could not match this code to an offer we can compare for your network and setup. It may be an older or private plan, or its retailer data may be unavailable. Check the code or continue without it.</p>}
      {match.choices.length > 1 && <label className={styles.choice}>More than one published record uses this ID. Choose the prices that match your bill.
        <select value={selectedKey} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Choose a published record</option>
          {match.choices.map((plan) => <option key={plan.key} value={plan.key}>{plan.brand}: {plan.name} | {plan.id} | {money(plan.annualCost)}/year</option>)}
        </select>
      </label>}
      {match.status === "matched" && <div className={styles.matched}>
        <div><span>Published offer matched</span><h3>{match.plan.name}</h3><p>{match.plan.brand} | {match.plan.id}</p><p>{match.plan.rateDescription}</p></div>
        <div className={styles.cost}><strong>{money(match.plan.annualCost)}/year</strong><span>estimated using the same {fuel} usage as the other offers</span></div>
        <p className={styles.notice}>Check these prices against your latest bill. The code matches a published offer, but your existing contract can have different prices or discounts. The differences below compare published estimates, not a guaranteed saving on your actual bill.</p>
        <a className={styles.offers} href={`#${fuel}-plan-offers`}>Compare offers against this plan</a>
      </div>}
    </div>
    {value.trim() && <button type="button" className={styles.clear} onClick={() => onChange("")}>Continue without a plan ID</button>}
  </section>;
}

export function PlanPriceDifference({ referenceCost, annualCost, isReference = false }: {
  referenceCost: number;
  annualCost: number;
  isReference?: boolean;
}) {
  const difference = annualPlanDifference(referenceCost, annualCost);
  return <p className={`${styles.difference} ${difference < 0 ? styles.more : ""}`}>
    {isReference ? "Your selected reference plan" : difference === 0 ? "Same estimated yearly cost as your reference plan" : `${money(Math.abs(difference))}/year ${difference > 0 ? "less" : "more"} than your reference plan`}
  </p>;
}
