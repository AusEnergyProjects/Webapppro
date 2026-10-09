"use client";

import { Field } from "./ComparatorChrome";
import { parseInstalledQuote } from "@/lib/installed-quote";

export function InstalledQuoteField({ label, hint, value, estimated, onChange, onReset }: {
  label: string;
  hint: string;
  value: string;
  estimated: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return <div className="installed-quote-field">
    <Field label={label} hint={hint}>
      <input type="number" inputMode="decimal" min="0.01" step="0.01" value={value} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onChange(event.target.value)} />
    </Field>
    <div className="installed-quote-source"><span>{estimated ? "Planning estimate" : "Your quote"}</span>{!estimated && <button type="button" onClick={onReset}>Use estimate</button>}</div>
    {value && parseInstalledQuote(value) === null && <p className="error" role="alert">Enter a price above $0 with no more than two decimal places.</p>}
  </div>;
}
