"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { ENERGY_SERVICE_OPTIONS } from "@/lib/energy-service-catalogue.mjs";
import { createTradeBusinessFetch } from "@/lib/trade-business-client";
import { normaliseTradeQuoteLines } from "@/lib/trade-quote";
import { wattzunActionName, type WattzunActionAddress, type WattzunActionProposal, type WattzunActionReceipt, type WattzunConfirmedAction } from "@/lib/wattzun-actions";
import { AustralianAddressLookup, type AustralianAddressSuggestion } from "./AustralianAddressLookup";
import styles from "./WattzunActionReview.module.css";

type Customer = {
  customerId: string; serviceSiteId: string; displayName: string; firstName: string; lastName: string;
  email: string; phone: string; addressLine1: string; addressLine2: string; suburb: string; addressState: string; postcode: string;
};
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function customerMatch(value: unknown): value is Customer {
  return record(value) && ["customerId", "serviceSiteId", "displayName", "firstName", "lastName", "email", "phone", "addressLine1", "addressLine2", "suburb", "addressState", "postcode"].every(key => typeof value[key] === "string")
    && Boolean(value.customerId && value.serviceSiteId && value.displayName);
}
function addressSummary(customer: Customer) {
  return [customer.addressLine1, customer.addressLine2, customer.suburb, customer.addressState, customer.postcode].filter(Boolean).join(", ");
}
function actionReceipt(value: unknown): value is WattzunActionReceipt {
  return record(value) && (value.kind === "customer" || value.kind === "quote_draft") && typeof value.id === "string"
    && /^[A-Za-z0-9:_-]{1,180}$/.test(value.id) && typeof value.href === "string"
    && /^\/direct-trade\/(?:dashboard|team)\?workspace=work&(?:customerId|jobId)=/.test(value.href)
    && typeof value.label === "string" && (value.kind === "customer" || (typeof value.workOrderId === "string" && typeof value.versionId === "string"));
}
export function WattzunActionReview({ proposal, user, scopeId, onCreated, onCancel, onNavigate }: {
  proposal: WattzunActionProposal; user: User; scopeId: string;
  onCreated: (receipt: WattzunActionReceipt) => void; onCancel: () => void; onNavigate?: (href: string) => void;
}) {
  const [draft, setDraft] = useState(proposal);
  const [mode, setMode] = useState<"existing" | "new">(proposal.kind === "create_customer" ? "new" : "existing");
  const [search, setSearch] = useState(wattzunActionName(proposal));
  const [matches, setMatches] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [addressQuery, setAddressQuery] = useState(proposal.addressQuery);
  const [address, setAddress] = useState<WattzunActionAddress | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [partial, setPartial] = useState<{ href: string } | null>(null);
  const [refreshQuery, setRefreshQuery] = useState("");
  const attempt = useRef<WattzunConfirmedAction | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentIdentity = useRef(`${user.uid}:${scopeId}`);
  useLayoutEffect(() => { currentIdentity.current = `${user.uid}:${scopeId}`; }, [scopeId, user.uid]);
  const locked = busy || uncertain;
  const customerName = mode === "existing" ? selected?.displayName || "" : wattzunActionName(draft);
  const totals = (() => { try { return proposal.kind === "prepare_quote" ? normaliseTradeQuoteLines(draft.lines, value => String(value || "").trim()) : null; } catch { return null; } })();
  const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
  const getAuthorization = useCallback(() => user.getIdToken(), [user]);
  const scopedFetch = useCallback<typeof fetch>((input, init) => createTradeBusinessFetch(scopeId, window.location.origin, fetch)(input, init), [scopeId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    if (mode !== "existing" || selected || search.trim().length < 2 || locked) return;
    const controller = new AbortController(); let active = true;
    const timer = setTimeout(() => {
      setSearching(true); setSearchError("");
      void (async () => {
        const token = await getAuthorization();
        if (!active) return;
        const response = await scopedFetch("/api/trade-crm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "find_quick_quote_customers", search: search.trim() }), cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok || !record(body) || body.ok !== true || !Array.isArray(body.matches)) throw new Error(record(body) && typeof body.error === "string" ? body.error : "Customer search could not be completed.");
        if (active) setMatches(body.matches.filter(customerMatch).slice(0, 10));
      })().catch(cause => { if (active && !controller.signal.aborted) setSearchError(cause instanceof Error ? cause.message : "Customer search could not be completed."); })
        .finally(() => { if (active) setSearching(false); });
    }, 280);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [getAuthorization, locked, mode, scopedFetch, search, selected]);

  function update(field: keyof Pick<WattzunActionProposal, "firstName" | "lastName" | "email" | "phone" | "serviceCategory" | "description">, value: string) {
    setDraft(current => ({ ...current, [field]: value })); setConfirmed(false); setError("");
  }
  function selectAddress(value: AustralianAddressSuggestion) {
    if (!(value.provider === "google-places" || value.provider === "google-geocoding") || !value.providerReference || !value.formattedAddress || !value.selectionProof) {
      setAddress(null); setConfirmed(false); setError("Choose a verified Google address result before saving."); return;
    }
    setAddress({ addressLine1: value.addressLine1, addressLine2: value.addressLine2, suburb: value.suburb, addressState: value.addressState, postcode: value.postcode,
      addressProvider: value.provider, addressProviderReference: value.providerReference, addressFormatted: value.formattedAddress, addressSelectionProof: value.selectionProof });
    setAddressQuery(value.addressLine1); setConfirmed(false); setError("");
  }
  function refreshAddress(value: AustralianAddressSuggestion) {
    const submitted = attempt.current;
    if (!submitted || busy) return;
    const original = submitted.action.address;
    const matches = value.addressLine1 === original.addressLine1 && value.addressLine2 === original.addressLine2
      && value.suburb === original.suburb && value.addressState === original.addressState && value.postcode === original.postcode
      && value.provider === original.addressProvider && value.providerReference === original.addressProviderReference
      && value.formattedAddress === original.addressFormatted && Boolean(value.selectionProof);
    if (!matches || !value.selectionProof) { setError("Choose the same Google property as this submitted review. Its details cannot change during recovery."); return; }
    attempt.current = { ...submitted, action: { ...submitted.action, address: { ...original, addressSelectionProof: value.selectionProof } } };
    setRefreshQuery(value.addressLine1); setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (activeRequest.current) return;
    if (!attempt.current) {
      if (!customerName || (mode === "existing" && !selected) || !address || !confirmed) {
        setError("Choose the customer and Google address, then confirm the exact name spelling and reviewed details."); return;
      }
      attempt.current = { portal: "trade", scopeId, requestId: crypto.randomUUID(),
        action: { ...draft, customerMode: mode, customerId: selected?.customerId || "", serviceSiteId: selected?.serviceSiteId || "", customerName,
          address, addressQuery, ...(mode === "existing" && selected ? { firstName: selected.firstName, lastName: selected.lastName, email: selected.email, phone: selected.phone } : {}) },
        confirmation: { reviewed: true, name: customerName, address: address.addressFormatted } };
    }
    const controller = new AbortController(); activeRequest.current = controller;
    const identity = currentIdentity.current; setBusy(true); setError("");
    const timeout = setTimeout(() => controller.abort(), 45_000); let sent = uncertain;
    try {
      const token = await getAuthorization();
      if (controller.signal.aborted || identity !== currentIdentity.current) throw new Error("This workspace changed before saving.");
      sent = true;
      const response = await scopedFetch("/api/wattzun/actions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(attempt.current), cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (!mounted.current || identity !== currentIdentity.current) return;
      if (!response.ok || !record(body) || body.ok !== true || !actionReceipt(body.receipt)) {
        if (record(body) && record(body.partial) && typeof body.partial.href === "string" && /^\/direct-trade\/(?:dashboard|team)\?workspace=work&jobId=/.test(body.partial.href)) {
          setPartial({ href: body.partial.href });
        } else if (response.status >= 400 && response.status < 500 && !uncertain) { attempt.current = null; sent = false; }
        throw new Error(record(body) && typeof body.error === "string" ? body.error : "TLink did not return a saved record receipt.");
      }
      setUncertain(false); setPartial(null); onCreated(body.receipt);
    } catch (cause) {
      if (mounted.current && identity === currentIdentity.current) {
        if (!sent) attempt.current = null;
        setUncertain(sent); setError(sent ? `${cause instanceof Error ? cause.message : "The result could not be confirmed."} Retry the same review to recover it safely.`
          : cause instanceof Error ? cause.message : "The action could not be completed.");
      }
    } finally { clearTimeout(timeout); activeRequest.current = null; if (mounted.current && identity === currentIdentity.current) setBusy(false); }
  }

  return <form className={styles.review} aria-label={proposal.kind === "prepare_quote" ? "Review quote creation" : "Review customer creation"} onSubmit={submit}>
    <h3>{proposal.kind === "prepare_quote" ? "Prepare a saved quote draft" : "Create a saved customer"}</h3>
    <p>Review the exact name spelling and select the real Google property address. {proposal.kind === "prepare_quote" ? "Add your quantities, prices and GST treatment. This creates a new quote job and saves a draft for your review." : "These details will be saved to your business customer register."}</p>
    <fieldset disabled={locked}>
      <legend>Customer and property</legend>
      {proposal.kind === "prepare_quote" && <div className={styles.modes}>
        <button type="button" aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setSelected(null); setAddress(null); setConfirmed(false); }}>Existing customer</button>
        <button type="button" aria-pressed={mode === "new"} onClick={() => { setMode("new"); setSelected(null); setAddress(null); setConfirmed(false); }}>New customer</button>
      </div>}
      {mode === "existing" ? <div>
        {selected ? <div className={styles.selected}><strong>{selected.displayName}</strong><span>{addressSummary(selected)}</span><span>{selected.email} · {selected.phone}</span>
          <button type="button" onClick={() => { setSelected(null); setAddress(null); setConfirmed(false); }}>Change customer or property</button></div>
          : <><label>Find the existing customer<input type="search" value={search} maxLength={100} onChange={event => { setSearch(event.target.value); setMatches([]); setConfirmed(false); }} /></label>
            {searching && <p role="status">Finding customers...</p>}{searchError && <p role="alert">{searchError}</p>}
            <div className={styles.matches}>{matches.map(match => <button type="button" key={`${match.customerId}:${match.serviceSiteId}`} onClick={() => {
              setSelected(match); setAddress(null); setAddressQuery(match.addressLine1); setConfirmed(false); setError("");
            }}><strong>{match.displayName}</strong><span>{addressSummary(match)}</span></button>)}</div>
            {search.trim().length >= 2 && !searching && !searchError && !matches.length && <p>Choose a matching property, refine the search, or choose New customer.</p>}</>}
      </div> : <div className={styles.grid}>
        <label>First name<input required autoComplete="given-name" maxLength={80} value={draft.firstName} onChange={event => update("firstName", event.target.value)} /></label>
        <label>Last name<input autoComplete="family-name" maxLength={80} value={draft.lastName} onChange={event => update("lastName", event.target.value)} /></label>
        <label>Email<input required type="email" autoComplete="email" maxLength={180} value={draft.email} onChange={event => update("email", event.target.value)} /></label>
        <label>Mobile<input required type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={event => update("phone", event.target.value)} /></label>
      </div>}
      <AustralianAddressLookup label="Match street address with Google" value={addressQuery} required endpoint="/api/trade-address-suggestions" getAuthorization={getAuthorization} request={scopedFetch}
        onChange={value => { setAddressQuery(value); setAddress(null); setConfirmed(false); }} onSelect={selectAddress} hideHelp />
      {address ? <p className={styles.address}>Selected Google address: <strong>{address.addressFormatted}</strong></p> : <p>Select a Google suggestion. A typed address alone cannot be saved through Wattzun.</p>}
      {proposal.kind === "prepare_quote" && <>
        <label>Work category<select aria-label="Work category" required value={draft.serviceCategory} onChange={event => update("serviceCategory", event.target.value)}><option value="">Choose the work</option>{ENERGY_SERVICE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Work scope<textarea required maxLength={3000} rows={3} value={draft.description} onChange={event => update("description", event.target.value)} /></label>
        <h4>Quote lines</h4><p>Unit prices are before GST. Choose GST or No GST for every line.</p>
        {draft.lines.map((line, index) => <div className={styles.line} key={index}>
          <label>Line {index + 1} description<input required maxLength={500} value={line.description} onChange={event => { setDraft(current => ({ ...current, lines: current.lines.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })); setConfirmed(false); }} /></label>
          <div className={styles.lineNumbers}>
            <label>Quantity<input required inputMode="decimal" value={line.quantity ?? ""} onChange={event => { setDraft(current => ({ ...current, lines: current.lines.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item) })); setConfirmed(false); }} /></label>
            <label>Unit price ex GST ($)<input required inputMode="decimal" value={line.unitPrice ?? ""} onChange={event => { setDraft(current => ({ ...current, lines: current.lines.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item) })); setConfirmed(false); }} /></label>
            <label>Tax<select aria-label={`Tax for line ${index + 1}`} required value={line.taxCode ?? ""} onChange={event => { const taxCode = event.target.value === "gst" ? "gst" : event.target.value === "none" ? "none" : null; setDraft(current => ({ ...current, lines: current.lines.map((item, i) => i === index ? { ...item, taxCode } : item) })); setConfirmed(false); }}><option value="">Choose</option><option value="gst">GST</option><option value="none">No GST</option></select></label>
          </div><button type="button" onClick={() => { setDraft(current => ({ ...current, lines: current.lines.filter((_, i) => i !== index) })); setConfirmed(false); }}>Remove line {index + 1}</button>
        </div>)}
        <button type="button" disabled={draft.lines.length >= 30} onClick={() => { setDraft(current => ({ ...current, lines: [...current.lines, { lineType: "product", description: "", quantity: null, unitPrice: null, taxCode: null }] })); setConfirmed(false); }}>Add quote line</button>
        {totals && <p aria-label="Reviewed quote total">Subtotal ex GST: {money(totals.subtotalCents)}. GST: {money(totals.taxCents)}. <strong>Total: {money(totals.totalCents)}</strong>.</p>}
      </>}
      <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I confirm the spelling <strong>{customerName || "(choose a customer)"}</strong>, the selected Google address and all details above.</span></label>
    </fieldset>
    {uncertain && !busy && <div>
      <p>If the Google verification has expired, select the same property again before retrying. Your submitted details stay fixed.</p>
      <AustralianAddressLookup label="Refresh the same Google address" value={refreshQuery} endpoint="/api/trade-address-suggestions" getAuthorization={getAuthorization} request={scopedFetch}
        onChange={setRefreshQuery} onSelect={refreshAddress} hideHelp />
    </div>}
    {error && <p role="alert">{error}</p>}
    {partial && <button type="button" onClick={() => onNavigate?.(partial.href)}>Open the saved quote job</button>}
    <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "Saving reviewed details..." : uncertain ? "Retry the same review" : proposal.kind === "prepare_quote" ? "Confirm and save quote draft" : "Confirm and create customer"}</button>
      <button type="button" disabled={locked} onClick={onCancel}>Cancel review</button></div>
    <p className={styles.note}>Your call can continue while you review. {proposal.kind === "prepare_quote" ? "Sending or issuing the quote stays in the saved job's quote workflow." : "No customer message is sent."}</p>
  </form>;
}
