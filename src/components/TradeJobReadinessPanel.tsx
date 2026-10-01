"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { JobStockRequirement, JobStockSummary } from "@/lib/trade-stock";
import { TradeStockJobPanel } from "./TradeStockJobPanel";
import stockStyles from "./TradeStockJobPanel.module.css";

type Requirement = { id: string; phaseId: string; type: string; description: string; status: string; quantityMilli: number; expectedDurationMinutes: number; requiredCapability: string; totalCostCents: number; actualQuantityMilli: number; actualDurationMinutes: number; actualCostCents: number; actualNote: string; actualRecorded: boolean };
type Data = {
  handoff: boolean;
  plan: null | { status: string; commercialReference: string; acceptedTotalCents: number; budgetCostCents: number; budgetMarginCents: number; depositRequirement: string; expectedDurationMinutes: number; suggestedCrewSize: number; completedAt: string };
  phases: Array<{ id: string; title: string; customerDescription: string; status: string; progressPercent: number }>;
  requirements: Requirement[];
  stock: JobStockSummary | null;
  readiness: null | { scope: boolean; forms: boolean; people: boolean; materials: boolean; deposit: boolean; ready: boolean; assignedTo: string };
  execution: null | { actualCostCents: number; forecastCostCents: number; forecastMarginCents: number; varianceCents: number; varianceStatus: string };
  completion: null | { scope: boolean; forms: boolean; materials: boolean; proof: boolean; proofRequired: boolean; ready: boolean; completed: boolean; invoiceReady: boolean; handoverReady: boolean };
};
type ActualDraft = { quantity: string; minutes: string; cost: string; note: string };
type StockUseDraft = { mode: "single" | "split"; locationId: string; quantities: Record<string, string> };
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const label = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function TradeJobReadinessPanel({ user, workOrderId, onOpenTeam, onChanged }: { user: User; workOrderId: string; onOpenTeam: () => void; onChanged: () => Promise<void> }) {
  const fetch = useTradeBusinessFetch();
  const [data, setData] = useState<Data | null>(null); const [busy, setBusy] = useState(""); const [status, setStatus] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ActualDraft>>({});
  const [stockUseDrafts, setStockUseDrafts] = useState<Record<string, StockUseDraft>>({});
  const actionRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    const token = await user.getIdToken(); if (signal.aborted) return;
    const response = await fetch(`/api/trade-job-readiness?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
    const result = await response.json().catch(() => ({})); if (signal.aborted) return;
    if (!response.ok) throw new Error(result.error || "Job readiness could not be loaded."); setData(result as Data);
  }, [fetch, user, workOrderId]);
  useEffect(() => {
    const request = new AbortController();
    const frame = requestAnimationFrame(() => void load(request.signal).catch((error) => { if (!request.signal.aborted) setStatus(error instanceof Error ? error.message : "Job readiness could not be loaded."); }));
    return () => { cancelAnimationFrame(frame); request.abort(); actionRequest.current?.abort(); };
  }, [load]);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (actionRequest.current) return;
    const request = new AbortController(); actionRequest.current = request;
    setBusy(action); setStatus("Updating job...");
    try {
      const token = await user.getIdToken(); if (request.signal.aborted) return;
      const response = await fetch("/api/trade-job-readiness", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, workOrderId, ...extra }), signal: request.signal });
      const result = await response.json().catch(() => ({})); if (request.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || "Job could not be updated."); setData(result as Data);
      setStatus(result.jobProgress?.pending ? "Saved. Job status is waiting to sync." : action === "ready" ? "Job is ready to schedule and dispatch." : action === "actual" ? "Actual work saved." : "Job plan updated.");
      if (["ready", "actual", "requirement"].includes(action)) await onChanged();
    } catch (error) { if (!request.signal.aborted) setStatus(error instanceof Error ? error.message : "Job could not be updated."); }
    finally { actionRequest.current = null; if (!request.signal.aborted) setBusy(""); }
  }
  function draftFor(item: Requirement): ActualDraft { const recorded = item.actualRecorded; return drafts[item.id] || { quantity: String((recorded ? item.actualQuantityMilli : item.quantityMilli) / 1000), minutes: String(recorded ? item.actualDurationMinutes : item.expectedDurationMinutes), cost: String((recorded ? item.actualCostCents : item.totalCostCents) / 100), note: item.actualNote }; }
  function updateDraft(item: Requirement, field: keyof ActualDraft, value: string) { setDrafts((current) => ({ ...current, [item.id]: { ...draftFor(item), [field]: value } })); }
  function stockFor(item: Requirement) { return data?.stock?.requirements.find((row) => row.requirementId === item.id); }
  function stockDraftFor(stock: JobStockRequirement): StockUseDraft {
    const saved = stockUseDrafts[stock.requirementId]; if (saved) return saved;
    const used = stock.stockLocations.filter((location) => location.usedMilli > 0);
    return { mode: used.length > 1 ? "split" : "single", locationId: used.length === 1 ? used[0].locationId : stock.stockLocations.find((location) => location.isDefault)?.locationId || "",
      quantities: Object.fromEntries(stock.stockLocations.map((location) => [location.locationId, String(location.usedMilli / 1000)])) };
  }
  function updateStockDraft(stock: JobStockRequirement, patch: Partial<StockUseDraft>) {
    setStockUseDrafts((current) => ({ ...current, [stock.requirementId]: { ...stockDraftFor(stock), ...patch } }));
  }
  function stockUsage(item: Requirement, actualQuantityMilli: number) {
    const stock = stockFor(item); if (!stock || stock.stockLocations.length <= 1) return {};
    const required = Math.max(0, actualQuantityMilli - stock.stockBaselineMilli);
    if (!Number.isSafeInteger(required)) throw new Error("Enter a valid material quantity.");
    if (required === 0) return { stockLocations: [] };
    const draft = stockDraftFor(stock);
    if (draft.mode === "single") {
      if (!stock.stockLocations.some((location) => location.locationId === draft.locationId)) throw new Error(`Choose where ${item.description} was taken from.`);
      return { stockLocations: [{ locationId: draft.locationId, quantityMilli: required }] };
    }
    const stockLocations = stock.stockLocations.map((location) => {
      const value = (draft.quantities[location.locationId] || "0").trim();
      if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error("Enter each location quantity with up to 3 decimal places.");
      return { locationId: location.locationId, quantityMilli: Math.round(Number(value) * 1000) };
    }).filter((location) => location.quantityMilli > 0);
    if (stockLocations.reduce((total, location) => total + location.quantityMilli, 0) !== required) throw new Error(`Location quantities must total ${required / 1000} ${stock.unitLabel}.`);
    return { stockLocations };
  }
  function savePlanned(item: Requirement) {
    try { void act("actual", { requirementId: item.id, usePlanned: true, ...stockUsage(item, item.quantityMilli) }); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Check the stock locations."); }
  }
  function saveDifferent(item: Requirement) {
    const draft = draftFor(item); const quantityMilli = Math.round(Number(draft.quantity) * 1000);
    try { void act("actual", { requirementId: item.id, quantityMilli, durationMinutes: Math.round(Number(draft.minutes)), totalCostCents: Math.round(Number(draft.cost) * 100), note: draft.note, ...stockUsage(item, quantityMilli) }); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Check the stock locations."); }
  }
  function stockLocationFields(item: Requirement) {
    const stock = stockFor(item); if (!stock || !stock.stockLocations.length) return null;
    const format = (milli: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 3 }).format(milli / 1000);
    if (stock.stockLocations.length === 1) return <p className={stockStyles.useHint}>Use from <strong>{stock.stockLocations[0].name}</strong></p>;
    const draft = stockDraftFor(stock); const actualQuantity = Math.round(Number(draftFor(item).quantity) * 1000);
    const required = Math.max(0, actualQuantity - stock.stockBaselineMilli);
    const entered = stock.stockLocations.reduce((total, location) => total + Math.round(Number(draft.quantities[location.locationId] || 0) * 1000), 0);
    return <div className={stockStyles.useLocations}>
      <label><span>Use from</span><select aria-label={`Use stock from for ${item.description}`} value={draft.mode === "split" ? "split" : draft.locationId} disabled={Boolean(busy)} onChange={(event) => updateStockDraft(stock, event.target.value === "split" ? { mode: "split" } : { mode: "single", locationId: event.target.value })}>
        <option value="">Choose a location</option>{stock.stockLocations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name} ({format(location.onHandMilli)} {stock.unitLabel} on hand)</option>)}<option value="split">Split between locations</option>
      </select></label>
      {draft.mode === "split" && <fieldset className={stockStyles.splitLocations} disabled={Boolean(busy)}><legend>Quantity from each location</legend>
        {stock.stockLocations.map((location) => <label key={location.locationId}><span>{location.name}</span><input type="number" min="0" step="0.001" inputMode="decimal" aria-label={`Quantity from ${location.name} for ${item.description}`} value={draft.quantities[location.locationId] || "0"} onChange={(event) => updateStockDraft(stock, { quantities: { ...draft.quantities, [location.locationId]: event.target.value } })} /><small>{format(location.onHandMilli)} {stock.unitLabel} on hand</small></label>)}
        <p aria-live="polite">{format(Number.isFinite(entered) ? entered : 0)} of {format(Number.isFinite(required) ? required : 0)} {stock.unitLabel} entered</p>
      </fieldset>}
    </div>;
  }
  if (!data) return <section className="crm-job-readiness empty"><span>Ready-to-run job</span><p>{status || "Checking the accepted scope..."}</p></section>;
  if (!data.handoff) return <section className="crm-job-readiness empty"><span>Next step</span><h4>Accept the quote first</h4><p>The accepted scope becomes the job plan automatically, with no retyping.</p></section>;
  if (!data.plan) return <section className="crm-job-readiness empty"><span>Accepted scope</span><h4>Prepare the job in one click</h4><p>TLink will carry the issued packet tasks, forms, crew, time and known costs into a practical job checklist.</p><button type="button" disabled={Boolean(busy)} onClick={() => void act("prepare")}>{busy ? "Preparing..." : "Prepare ready-to-run job"}</button>{status && <p role="status">{status}</p>}</section>;
  const checks = [["scope", "Scope", "Accepted work is grouped into clear phases."], ["forms", "Forms", "Required paperwork is attached and confirmed."], ["people", "Technician", data.readiness?.assignedTo ? `Assigned to ${data.readiness.assignedTo}.` : "Assign yourself or an active technician."], ["materials", "Materials", "Confirm required products before dispatch."], ["deposit", "Deposit", "Manage any required payment through your approved process outside TLink."]] as const;
  const working = ["ready", "in_progress", "completed"].includes(data.plan.status);
  const completionChecks = data.completion ? [["scope", "Scope complete", data.completion.scope], ["forms", "Forms complete", data.completion.forms], ["materials", "Materials recorded", data.completion.materials], ["proof", data.completion.proofRequired ? "Proof accepted" : "No proof requested", data.completion.proof]] as const : [];
  return <section className="crm-job-readiness"><header><div><span>{working ? "Job execution" : "Ready-to-run job"}</span><h4>{data.plan.commercialReference}</h4><p>{working ? "Record work once. TLink keeps budget, progress, invoice and handover preparation aligned." : "The accepted scope is the source of truth. Confirm only what still needs a human decision."}</p></div><strong>{label(data.plan.status)}</strong></header>
    <div className="crm-readiness-summary"><article><span>Accepted value</span><strong>{money(data.plan.acceptedTotalCents)}</strong></article><article><span>{working ? "Actual cost" : "Known cost"}</span><strong>{money(working ? data.execution?.actualCostCents || 0 : data.plan.budgetCostCents)}</strong></article><article><span>{working ? "Forecast margin" : "Budget margin"}</span><strong>{money(working ? data.execution?.forecastMarginCents || 0 : data.plan.budgetMarginCents)}</strong></article>{working && <article className={`variance ${data.execution?.varianceStatus || "on_budget"}`}><span>Budget variance</span><strong>{money(data.execution?.varianceCents || 0)}</strong><small>{label(data.execution?.varianceStatus || "on_budget")}</small></article>}</div>
    {!working && <><div className="crm-readiness-checks">{checks.map(([key, itemLabel, description]) => { const complete = Boolean(data.readiness?.[key]); return <article key={key} className={complete ? "complete" : "attention"}><i aria-hidden="true">{complete ? "OK" : "!"}</i><div><strong>{itemLabel}</strong><span>{description}</span></div>{key === "people" && !complete && <button type="button" onClick={onOpenTeam}>Assign</button>}</article>; })}</div>
      <label className="crm-readiness-deposit"><span>Deposit rule for this job</span><select value={data.plan.depositRequirement} disabled={Boolean(busy)} onChange={(event) => void act("deposit", { requirement: event.target.value })}><option value="optional">Optional, do not block work</option><option value="required">Required before work starts</option><option value="waived">Waived for this job</option></select></label></>}
    {working && <div className="crm-phase-progress">{data.phases.map((phase) => <article key={phase.id}><div><strong>{phase.title}</strong><span>{phase.progressPercent}%</span></div><progress max="100" value={phase.progressPercent}>{phase.progressPercent}%</progress><small>{label(phase.status)}</small></article>)}</div>}
    <TradeStockJobPanel key={workOrderId} user={user} workOrderId={workOrderId} job={data.stock} onChanged={(stock) => setData((current) => current ? { ...current, stock } : current)} disabled={Boolean(busy)} />
    <details className="crm-commercial-scope" open={working}><summary>{working ? "Work checklist and actuals" : "Review phases and requirements"}</summary>{data.phases.map((phase) => <section key={phase.id}><h5>{phase.title}</h5><p>{phase.customerDescription}</p>{data.requirements.filter((item) => item.phaseId === phase.id).map((item) => <div className={`crm-readiness-requirement ${item.status}`} key={item.id}><span><strong>{item.description}</strong><small>{label(item.type)}{item.requiredCapability ? ` | ${item.requiredCapability}` : ""}{item.totalCostCents ? ` | ${money(item.totalCostCents)} planned` : ""}</small>{item.status === "completed" && <small>{item.actualDurationMinutes ? `${item.actualDurationMinutes} min | ` : ""}{money(item.actualCostCents)} actual</small>}</span>{!working && ["material", "form"].includes(item.type) ? <select value={item.status} disabled={Boolean(busy)} onChange={(event) => void act("requirement", { requirementId: item.id, status: event.target.value })}><option value="required">Needs confirmation</option><option value="confirmed">Confirmed</option><option value="not_needed">Not needed</option></select> : working && item.status !== "not_needed" && (!data.completion?.completed || item.type !== "form") ? <div className="crm-actual-actions">{stockLocationFields(item)}{!item.actualRecorded && <button type="button" disabled={Boolean(busy)} onClick={() => savePlanned(item)}>{item.type === "material" ? "Used as planned" : item.type === "form" ? "Complete" : "Done as planned"}</button>}<details><summary>{item.actualRecorded ? "Edit recorded cost and time" : "Actual differs"}</summary><div><label><span>Quantity</span><input type="number" min="0" step="0.001" value={draftFor(item).quantity} onChange={(event) => updateDraft(item, "quantity", event.target.value)} /></label><label><span>Minutes</span><input type="number" min="0" step="1" value={draftFor(item).minutes} onChange={(event) => updateDraft(item, "minutes", event.target.value)} /></label><label><span>Actual cost, excluding GST</span><input type="number" min="0" step="0.01" value={draftFor(item).cost} onChange={(event) => updateDraft(item, "cost", event.target.value)} /></label><label><span>Note, optional</span><input value={draftFor(item).note} maxLength={300} onChange={(event) => updateDraft(item, "note", event.target.value)} /></label><button type="button" disabled={Boolean(busy)} onClick={() => saveDifferent(item)}>Save actual</button></div></details></div> : <b>{label(item.status === "confirmed" ? "Included" : item.status)}</b>}</div>)}</section>)}</details>
    {!working && <button className="btn" type="button" disabled={Boolean(busy) || !data.readiness?.ready} onClick={() => void act("ready")}>{data.readiness?.ready ? "Mark ready to schedule" : "Clear remaining items"}</button>}
    {working && !data.completion?.completed && <section className="crm-completion-gate"><header><div><span>Completion gate</span><strong>Finish cleanly without office re-entry</strong></div></header><div>{completionChecks.map(([key, itemLabel, complete]) => <span key={key} className={complete ? "complete" : "attention"}><i>{complete ? "OK" : "!"}</i>{itemLabel}</span>)}</div><p>The job advances automatically when all required forms, evidence and assigned visits are complete.</p></section>}
    {data.completion?.completed && <section className="crm-completion-ready"><strong>Job complete</strong><span>Invoice and handover preparation are ready from the authoritative accepted scope and recorded actuals.</span></section>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </section>;
}
