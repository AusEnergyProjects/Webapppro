"use client";

import { useState } from "react";
import type { CreditexStatutorySourceForm } from "@/lib/creditex-statutory-form-library";
import provider from "@/data/creditex-declaration-provider.json";
import styles from "./CreditexActivityWorkPackGovernance.module.css";

export function CreditexStatutorySourceLibrary({ api, endpoint }: {
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>; endpoint: string;
}) {
  const [forms, setForms] = useState<CreditexStatutorySourceForm[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const current = forms.find((form) => form.id === selected);
  async function load() {
    setBusy(true); setError("");
    try {
      const result = await api(`${endpoint}?view=statutory_sources`);
      if (!Array.isArray(result.forms)) throw new Error("The statutory source library could not be read.");
      setForms(result.forms); setSelected(result.forms[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The statutory source library could not be read."); }
    finally { setBusy(false); }
  }
  return <section className={styles.builderSection}>
    <header><div><h4>Creditex statutory source library</h4><p>Regulator fields, signing requirements and exact Creditex declarations for master-form authoring. The published master versions below control availability to trades.</p></div>
      <button type="button" disabled={busy} onClick={() => void load()}>{busy ? "Loading sources..." : "Open regulator templates"}</button></header>
    {error ? <p role="alert">{error}</p> : null}
    {forms.length ? <label>Activity source<select value={selected} onChange={(event) => setSelected(event.target.value)}>{forms.map((form) => <option key={form.id} value={form.id}>{form.program} | {form.activity} | {form.title}</option>)}</select></label> : null}
    {current ? <div>
      <h4>{current.title}</h4><p>{provider.legalName} | ABN 76 105 513 040 | {provider.phone} | {provider.email}</p>
      <p>Sources checked {current.reviewedOn}. Provider accreditation and current activity eligibility are checked separately.</p>
      <details><summary>Creditex provider registrations</summary><ul>{provider.accreditations.map((item) => <li key={item.number}><a href={item.source} target="_blank" rel="noreferrer">{item.scheme}: {item.number}</a> | {item.observedStatus} on {provider.verifiedOn}{item.accreditedTo ? ` | Accredited to ${item.accreditedTo}` : ""} | {item.activities.join(", ")}</li>)}</ul><p>{provider.federal.note} REC registered-person record: {provider.federal.registeredPersonNumber}. Creditex website STC number: {provider.federal.websiteStcNumber}.</p></details>
      {current.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><small> | Source SHA-256: {source.sha256 || "Capture required"}</small></p>)}
      {current.groups.map((group, i) => <details key={`${current.id}:${i}`}><summary>{group.title} | {group.fields.length} fields{group.timing ? ` | ${group.timing.replaceAll("_", " ")}` : ""}</summary>
        <table><thead><tr><th>Question</th><th>Answer</th><th>Applies when</th></tr></thead><tbody>{group.fields.map((field) => <tr key={field.key}><td>{field.label}</td><td>{field.options.join(" / ") || field.type}</td><td>{field.condition}</td></tr>)}</tbody></table>
      </details>)}
      {current.authoringRequirements?.length ? <details><summary>Document layout, timing and unresolved requirements</summary><ul>{current.authoringRequirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></details> : null}
      {current.declarations.map((declaration) => <details key={declaration.key}><summary>{declaration.title} | {declaration.signer} | {declaration.timing.replaceAll("_", " ")}</summary>{declaration.condition ? <p>Use this alternative only when: {declaration.condition}</p> : null}<p style={{ whiteSpace: "pre-wrap" }}>{declaration.text}</p><small>Creditex declaration SHA-256: {declaration.creditexTextSha256}</small>{declaration.sourceUrl ? <p><a href={declaration.sourceUrl} target="_blank" rel="noreferrer">Official declaration source</a></p> : null}</details>)}
      {!current.declarations.length ? <p>Signing purposes are mapped below. Exact source declarations must be attached to the master before publication.</p> : null}
      <ul>{current.signatureRequirements.map((requirement, index) => <li key={index}>{requirement.replaceAll("_", " ")}</li>)}</ul>
    </div> : null}
  </section>;
}
