"use client";
import { ENQUIRY_COMPLETION_OPTIONS, enquiryCalendarDate } from "@/lib/enquiry-timing.mjs";
import styles from "./EnquiryTimingFields.module.css";

export type EnquiryTiming = { quoteWindowValue: number; quoteWindowUnit: string; requestedCompletion: string; requestedCompletionDate: string };
export const DEFAULT_ENQUIRY_TIMING: EnquiryTiming = { quoteWindowValue: 30, quoteWindowUnit: "days", requestedCompletion: "flexible", requestedCompletionDate: "" };
export function EnquiryTimingFields({ value, onChange }: { value: EnquiryTiming; onChange: (value: EnquiryTiming) => void }) {
  return <fieldset className={styles.fields}><legend>Your timing</legend>
    <label><span>When are you hoping to have this work completed by?</span><select value={value.requestedCompletion} onChange={event => onChange({ ...value, requestedCompletion: event.target.value, requestedCompletionDate: "" })}>
      {ENQUIRY_COMPLETION_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    {value.requestedCompletion === "date" && <label><span>Preferred completion date</span><input type="date" value={value.requestedCompletionDate} min={enquiryCalendarDate()} onChange={event => onChange({ ...value, requestedCompletionDate: event.target.value })} required /></label>}
    <label><span>How long would you like to accept quotes and contact?</span><div className={styles.window}>
      <input aria-label="Number of days or months" type="number" min={1} max={value.quoteWindowUnit === "months" ? 12 : 365} step={1} value={value.quoteWindowValue || ""} onChange={event => onChange({ ...value, quoteWindowValue: Number(event.target.value) })} required />
      <select aria-label="Quote window unit" value={value.quoteWindowUnit} onChange={event => onChange({ ...value, quoteWindowUnit: event.target.value, quoteWindowValue: Math.min(value.quoteWindowValue, event.target.value === "months" ? 12 : 365) })}><option value="days">Days</option><option value="months">Months</option></select>
    </div></label>
    <p>New quotes and access to your contact details in TLink automatically stop when this period ends. Details already received by a business cannot be recalled. Any work you have accepted can continue.</p>
  </fieldset>;
}
