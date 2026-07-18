"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { calculateJobPacketSummary, type PacketPriceItem } from "@/lib/trade-job-packet";
import { quantityToMilli } from "@/lib/trade-quote";
import styles from "./TradeJobPacketWorkspace.module.css";

type PacketLine = { id?: string; priceBookItemId: string; quantity: string; quantityMilli?: number };
type PacketForm = { templateKey: string; templateVersion: number };
type JobPacket = { id: string; packetCode: string; name: string; serviceCategory: string; jobTemplateId: string; recordStatus: string;
  revision: number; suggestedCrewSize: number; taskCount: number; formCount: number; activeCrewCount: number; crewReady: boolean;
  unavailableItemCount: number; canApply: boolean; lines: Array<{ id: string; priceBookItemId: string; quantityMilli: number }>;
  forms: PacketForm[]; summary: { costCentsExGst: number; sellCentsExGst: number; estimatedDurationMinutes: number; requiredCapabilities: string[]; marginBasisPoints: number } };
type JobTemplate = { id: string; name: string; serviceCategory: string; taskCount: number };
type FormOption = PacketForm & { name: string; description: string };
type Result = { ok?: boolean; packets?: JobPacket[]; priceBookItems?: PacketPriceItem[]; jobTemplates?: JobTemplate[]; formOptions?: FormOption[]; error?: string };
type Draft = { name: string; serviceCategory: string; jobTemplateId: string; suggestedCrewSize: string; recordStatus: string; lines: PacketLine[]; forms: PacketForm[] };

const SERVICE_LABELS: Record<string, string> = { assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries",
  "heating-cooling": "Heating and cooling", "hot-water": "Hot water", "insulation-draughts": "Insulation and draughts",
  "ev-charging": "EV charging", electrical: "Electrical", plumbing: "Plumbing", "mounting-hardware": "Mounting hardware", controls: "Controls", other: "Other" };
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;
const blankDraft = (): Draft => ({ name: "", serviceCategory: "assessment", jobTemplateId: "", suggestedCrewSize: "1", recordStatus: "active", lines: [], forms: [] });

export function TradeJobPacketWorkspace({ user, onOpenItems }: { user: User; onOpenItems: () => void }) {
  const [packets, setPackets] = useState<JobPacket[]>([]); const [priceItems, setPriceItems] = useState<PacketPriceItem[]>([]);
  const [jobTemplates, setJobTemplates] = useState<JobTemplate[]>([]); const [formOptions, setFormOptions] = useState<FormOption[]>([]);
  const [draft, setDraft] = useState<Draft>(blankDraft()); const [editing, setEditing] = useState<JobPacket | "new" | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");

  const request = useCallback(async (category: string, init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-job-packets?serviceCategory=${encodeURIComponent(category)}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || result.ok === false) throw new Error(result.error || "Your common jobs could not be loaded."); return result;
  }, [user]);
  const load = useCallback(async (category = draft.serviceCategory, signal?: AbortSignal) => {
    const result = await request(category, { signal }); if (signal?.aborted) return;
    setPackets(result.packets || []); setPriceItems(result.priceBookItems || []); setJobTemplates(result.jobTemplates || []); setFormOptions(result.formOptions || []);
  }, [draft.serviceCategory, request]);
  useEffect(() => { const controller = new AbortController(); const frame = window.requestAnimationFrame(() => void load(draft.serviceCategory, controller.signal)
    .catch((error) => { if (!controller.signal.aborted) setMessage(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }));
    return () => { controller.abort(); window.cancelAnimationFrame(frame); }; }, [draft.serviceCategory, load]);

  const itemMap = useMemo(() => new Map(priceItems.map((item) => [item.id, item])), [priceItems]);
  const summary = useMemo(() => { try { const lines = draft.lines.map((line) => ({ priceBookItemId: line.priceBookItemId, quantityMilli: quantityToMilli(line.quantity) })); return lines.length ? calculateJobPacketSummary(lines, itemMap) : null; } catch { return null; } }, [draft.lines, itemMap]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function startNew() { if (draft.serviceCategory !== "assessment") setLoading(true); setEditing("new"); setDraft(blankDraft()); setMessage(""); }
  function startEdit(packet: JobPacket) { if (draft.serviceCategory !== packet.serviceCategory) setLoading(true); setEditing(packet); setDraft({ name: packet.name, serviceCategory: packet.serviceCategory,
    jobTemplateId: packet.jobTemplateId, suggestedCrewSize: String(packet.suggestedCrewSize), recordStatus: packet.recordStatus === "archived" ? "draft" : packet.recordStatus,
    lines: packet.lines.map((line) => ({ id: line.id, priceBookItemId: line.priceBookItemId, quantity: (line.quantityMilli / 1000).toString() })), forms: packet.forms }); setMessage(""); }
  function addLine() { if (!priceItems.length) return; const unused = priceItems.find((item) => !draft.lines.some((line) => line.priceBookItemId === item.id));
    if (unused) change("lines", [...draft.lines, { priceBookItemId: unused.id, quantity: "1" }]); }
  function updateLine(index: number, field: "priceBookItemId" | "quantity", value: string) { change("lines", draft.lines.map((line, position) => position === index ? { ...line, [field]: value } : line)); }
  function chooseCategory(value: string) { setLoading(true); change("serviceCategory", value); change("jobTemplateId", ""); change("forms", []); }
  function toggleForm(form: FormOption) { const selected = draft.forms.some((item) => item.templateKey === form.templateKey && item.templateVersion === form.templateVersion);
    change("forms", selected ? draft.forms.filter((item) => item.templateKey !== form.templateKey || item.templateVersion !== form.templateVersion) : [...draft.forms, { templateKey: form.templateKey, templateVersion: form.templateVersion }]); }
  async function save(event: FormEvent) { event.preventDefault(); setBusy("save"); setMessage(""); try {
    const isNew = editing === "new"; const packetId = typeof editing === "object" && editing ? editing.id : "";
    await request(draft.serviceCategory, { method: isNew ? "POST" : "PATCH", body: JSON.stringify({ action: isNew ? "create" : "update", packetId, ...draft }) });
    await load(draft.serviceCategory); setEditing(null); setMessage(isNew ? "Packet saved. It is ready to apply to a direct-job quote." : "Packet updated. Future quotes use this revision.");
  } catch (error) { setMessage(error instanceof Error ? error.message : "The common job could not be saved."); } finally { setBusy(""); } }
  async function archive(packet: JobPacket) { if (!window.confirm(`Archive ${packet.name}? Existing quote snapshots stay unchanged.`)) return;
    setBusy(`archive:${packet.id}`); try { await request(packet.serviceCategory, { method: "PATCH", body: JSON.stringify({ action: "archive", packetId: packet.id }) }); await load(packet.serviceCategory); setEditing(null); setMessage("Common job archived. Existing quotes stay unchanged."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The common job could not be archived."); } finally { setBusy(""); } }

  return <section className={styles.workspace} aria-labelledby="job-packets-title">
    <header className={styles.hero}><div><span>Saved common work</span><h3 id="job-packets-title">Common jobs</h3><p>Save a common job once, then start the next quote without retyping labour, materials or checklists.</p></div><button type="button" onClick={startNew} disabled={!priceItems.length}>New common job</button></header>
    {!loading && !priceItems.length && <section className={styles.firstRun}><span>One small setup step</span><h4>Add a price-book item first</h4><p>A common job reuses your saved labour and materials, so prices stay accurate without entering them again.</p><button type="button" onClick={onOpenItems}>Open price-book items</button></section>}
    {!loading && priceItems.length > 0 && !packets.length && !editing && <section className={styles.firstRun}><span>Start in under a minute</span><h4>Save the job you quote most often</h4><p>Name it and choose its saved items. Tasks, forms and crew details remain optional.</p><button type="button" onClick={startNew}>Create first common job</button></section>}
    {editing && <form className={styles.editor} onSubmit={save}><header><div><span>{editing === "new" ? "Fast standard job" : editing.packetCode}</span><h4>{editing === "new" ? "New common job" : `Edit ${editing.name}`}</h4><p>The essential path is name, service and saved items. Everything else is optional.</p></div><button type="button" onClick={() => setEditing(null)}>Back to common jobs</button></header>
      {editing !== "new" && editing.recordStatus === "archived" && <p className={styles.warning}>Archived common jobs are read only.</p>}
      {editing !== "new" && editing.unavailableItemCount > 0 && <p className={styles.warning}>{editing.unavailableItemCount} saved item is unavailable. Choose its active replacement before marking this common job ready.</p>}
      <fieldset disabled={editing !== "new" && editing.recordStatus === "archived"}><div className={styles.core}>
        <label><span>Common job name</span><input required maxLength={140} value={draft.name} onChange={(event) => change("name", event.target.value)} placeholder="e.g. Standard heat pump install" /></label>
        <label><span>Service</span><select value={draft.serviceCategory} onChange={(event) => chooseCategory(event.target.value)}>{Object.entries(SERVICE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Status</span><select value={draft.recordStatus} onChange={(event) => change("recordStatus", event.target.value)}><option value="active">Ready to quote</option><option value="draft">Draft</option></select></label>
      </div><section className={styles.items}><header><div><span>Saved scope</span><strong>{draft.lines.length} item{draft.lines.length === 1 ? "" : "s"}</strong></div><button type="button" onClick={addLine} disabled={draft.lines.length >= priceItems.length}>Add item</button></header>
        {draft.lines.map((line, index) => <div className={styles.line} key={`${index}:${line.id || "new"}`}><select aria-label={`Common job item ${index + 1}`} value={line.priceBookItemId} onChange={(event) => updateLine(index, "priceBookItemId", event.target.value)}>{priceItems.filter((item) => item.id === line.priceBookItemId || !draft.lines.some((existing) => existing.priceBookItemId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} | {money(item.sellPriceCentsExGst)} / {item.unitLabel}</option>)}</select><label><span>Quantity</span><input aria-label={`Common job item ${index + 1} quantity`} required inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} /></label><button type="button" onClick={() => change("lines", draft.lines.filter((_, position) => position !== index))}>Remove</button></div>)}
        {!draft.lines.length && <p>Choose Add item to build this standard scope.</p>}
      </section>
      {summary && <div className={styles.summary}><div><span>Sell ex GST</span><strong>{money(summary.sellCentsExGst)}</strong></div><div><span>Cost ex GST</span><strong>{money(summary.costCentsExGst)}</strong></div><div><span>Margin</span><strong>{percent(summary.marginBasisPoints)}</strong></div><div><span>Estimated time</span><strong>{summary.estimatedDurationMinutes ? `${summary.estimatedDurationMinutes} min` : "Not set"}</strong></div></div>}
      <details className={styles.optional}><summary>Tasks, forms and crew, optional</summary><div>
        <label><span>Existing job template</span><select value={draft.jobTemplateId} onChange={(event) => change("jobTemplateId", event.target.value)}><option value="">No checklist template</option>{jobTemplates.filter((template) => template.serviceCategory === draft.serviceCategory || template.serviceCategory === "other").map((template) => <option value={template.id} key={template.id}>{template.name} | {template.taskCount} tasks</option>)}</select><small>References the existing job-template checklist.</small></label>
        <label><span>Suggested crew</span><input type="number" min="1" max="20" value={draft.suggestedCrewSize} onChange={(event) => change("suggestedCrewSize", event.target.value)} /><small>Compared with the owner and accepted team members. Assignments and licence checks still happen in scheduling.</small></label>
        {summary?.requiredCapabilities.length ? <p className={styles.capabilities}><strong>Required capabilities</strong><span>{summary.requiredCapabilities.join(", ")}</span></p> : null}
        {formOptions.length > 0 && <fieldset className={styles.forms}><legend>Published forms</legend>{formOptions.map((form) => <label key={`${form.templateKey}:${form.templateVersion}`}><input type="checkbox" checked={draft.forms.some((item) => item.templateKey === form.templateKey && item.templateVersion === form.templateVersion)} onChange={() => toggleForm(form)} /><span><strong>{form.name}</strong><small>{form.description}</small></span></label>)}</fieldset>}
      </div></details></fieldset>
      {(editing === "new" || editing.recordStatus !== "archived") && <div className={styles.actions}><button type="submit" disabled={Boolean(busy) || !draft.lines.length}>{busy === "save" ? "Saving..." : draft.recordStatus === "active" ? "Save common job" : "Save draft"}</button>{editing !== "new" && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => void archive(editing)}>Archive common job</button>}</div>}
    </form>}
    {!editing && packets.length > 0 && <div className={styles.list}>{packets.map((packet) => <article key={packet.id}><button type="button" onClick={() => startEdit(packet)}><div><span>{packet.packetCode} | {SERVICE_LABELS[packet.serviceCategory] || packet.serviceCategory}</span><strong>{packet.name}</strong><small>{packet.lines.length} items | {packet.taskCount} tasks | {packet.formCount} forms</small></div><div><span>Sell ex GST</span><strong>{money(packet.summary.sellCentsExGst)}</strong><small>{packet.summary.estimatedDurationMinutes ? `${packet.summary.estimatedDurationMinutes} min` : "Time not set"}</small></div><div><span>Crew readiness</span><strong>{packet.crewReady ? "Ready" : "Needs people"}</strong><small>{packet.suggestedCrewSize} suggested | {packet.activeCrewCount} available</small></div><em className={packet.canApply ? styles.ready : styles.attention}>{packet.recordStatus === "active" ? packet.canApply ? "Ready" : "Needs attention" : packet.recordStatus}</em></button></article>)}</div>}
    {loading && <p className={styles.loading}>Loading common jobs...</p>}{message && <p className={styles.message} role="status">{message}</p>}
  </section>;
}
