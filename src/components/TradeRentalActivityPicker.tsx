"use client";
import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { TradeRentalInspectionPanel } from "./TradeRentalInspectionPanel";

type Choice = { id: string; title: string; added: boolean; unavailableReason: string };
type Catalogue = { ok?: boolean; revision: number; canAdd: boolean; unavailableReason: string;
  rentalModules: Choice[]; rentalVisits?: Choice[]; message?: string; error?: string };
export function TradeRentalActivityPicker({ user, workOrderId, refreshKey, readOnly, active, initiallyAttached,
  onChanged, onAttachmentChanged }: { user: User; workOrderId: string; refreshKey: number; readOnly: boolean;
  active: boolean; initiallyAttached: boolean; onChanged: () => Promise<void>; onAttachmentChanged: (attached: boolean) => void }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selection, setSelection] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useCallback(async (body?: Record<string, unknown>, signal?: AbortSignal) => {
    const token = await user.getIdToken();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetch(body ? "/api/field/job-activities" : `/api/field/job-activities?workOrderId=${encodeURIComponent(workOrderId)}`, {
      method: body ? "POST" : "GET", signal, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, workOrderId }) : undefined,
    });
    const result: Catalogue = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "The assessment library could not be loaded.");
    return result;
  }, [user, workOrderId]);
  useEffect(() => {
    const controller = new AbortController();
    void request(undefined, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setCatalogue(next); onAttachmentChanged(next.rentalModules.some((item) => item.added));
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "The assessment library could not be loaded."); });
    return () => controller.abort();
  }, [request, refreshKey, attempt, onAttachmentChanged]);
  const choices = [...(catalogue?.rentalVisits || []).map((entry) => ({ ...entry, kind: "rental_visit" })),
    ...(catalogue?.rentalModules || []).map((entry) => ({ ...entry, kind: "rental" }))];
  const selected = choices.find((entry) => `${entry.kind}:${entry.id}` === selection);
  const attached = initiallyAttached || Boolean(catalogue?.rentalModules.some((entry) => entry.added));
  async function add() {
    if (!catalogue || !selected || readOnly || busy || selected.added || selected.unavailableReason) return;
    setBusy(true); setMessage("");
    try {
      const next = await request({ kind: selected.kind, expectedRevision: catalogue.revision,
        ...(selected.kind === "rental_visit" ? { presetKey: selected.id } : { moduleKey: selected.id }) });
      setCatalogue(next); setSelection(""); setMessage(next.message || "The visit forms are attached.");
      onAttachmentChanged(next.rentalModules.some((entry) => entry.added));
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The form could not be attached. Refresh and try again."); }
    finally { setBusy(false); }
  }
  return <section hidden={!active} aria-label="Rental assessments and safety visits">
    {!readOnly && <details className="crm-field-secondary" open={!attached}>
      <summary>Add activity</summary><p>Choose individual checks or a visit bundle. One report covers the work performed on this visit.</p>
      <label><span>Assessment or safety visit</span><select value={selection} disabled={busy || !catalogue?.canAdd} onChange={(event) => setSelection(event.target.value)}>
        <option value="">Choose services</option>{choices.map((entry) => <option key={`${entry.kind}:${entry.id}`} value={`${entry.kind}:${entry.id}`}>{entry.title}{entry.added ? " (attached)" : ""}</option>)}
      </select></label>
      {selected?.unavailableReason && <p role="status">{selected.unavailableReason}</p>}
      {catalogue?.unavailableReason && <p>{catalogue.unavailableReason}</p>}
      <button type="button" className="btn" disabled={busy || !selected || selected.added || Boolean(selected.unavailableReason)} onClick={() => void add()}>{busy ? "Adding..." : "Add to this job"}</button>
      <button type="button" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Refresh available forms</button>
    </details>}
    {message && <p role="status">{message}</p>}
    {active && attached && <TradeRentalInspectionPanel key={workOrderId + ":" + (catalogue?.rentalModules.filter((entry) => entry.added).length || 0)} user={user} workOrderId={workOrderId} readOnly={readOnly} onChanged={onChanged} />}
  </section>;
}
