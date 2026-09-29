"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { AustralianAddressLookup, type AustralianAddressSuggestion } from "./AustralianAddressLookup";
import styles from "./TradeMapNewQuote.module.css";

type CustomerMatch = {
  customerId: string; customerNumber: string; displayName: string; email: string; phone: string;
  serviceSiteId: string; siteLabel: string; addressLine1: string; addressLine2: string;
  suburb: string; addressState: string; postcode: string;
};
type NewCustomer = {
  firstName: string; lastName: string; email: string; phone: string;
  addressLine1: string; addressLine2: string; suburb: string; addressState: string; postcode: string;
};
type AddressProof = { addressProvider: string; addressProviderReference: string; addressFormatted: string; addressSelectionProof: string };
type CreateRequest = {
  action: "create_quick_quote_job"; clientRequestId: string; customerMode: "existing" | "new";
  serviceCategory: string; description: string; email: string;
  crmCustomerId?: string; serviceSiteId?: string;
} & Partial<NewCustomer & AddressProof> & { addressEntryMode?: "provider_selected" | "manual_pending_review" };

const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
const DEFAULT_DESCRIPTIONS = { solar: "Solar installation", area: "Insulation roof area", distance: "Measured work" };
const EMPTY_CUSTOMER: NewCustomer = { firstName: "", lastName: "", email: "", phone: "", addressLine1: "", addressLine2: "", suburb: "", addressState: "", postcode: "" };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isCustomerMatch(value: unknown): value is CustomerMatch {
  return isRecord(value) && ["customerId", "customerNumber", "displayName", "email", "phone", "serviceSiteId", "siteLabel", "addressLine1", "addressLine2", "suburb", "addressState", "postcode"].every((key) => typeof value[key] === "string") && Boolean(value.customerId && value.serviceSiteId);
}
function siteAddress(match: CustomerMatch) {
  return [match.addressLine1, match.addressLine2, match.suburb, match.addressState, match.postcode].filter(Boolean).join(", ");
}
function hasCustomerDetails(match: CustomerMatch) {
  return EMAIL_PATTERN.test(match.email.trim()) && match.phone.replace(/\D/g, "").length >= 8 && Boolean(match.addressLine1.trim() && match.suburb.trim()) && STATES.includes(match.addressState.trim().toUpperCase()) && /^\d{4}$/.test(match.postcode.trim());
}

export function TradeMapNewQuote({ user, canCreateCustomer, onCreated, onBusyChange, onDirtyChange, measurementKind }: {
  user: User;
  canCreateCustomer: boolean;
  onCreated: (workOrderId: string) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  measurementKind: "area" | "distance" | "solar";
}) {
  const fetch = useTradeBusinessFetch();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  const [lookup, setLookup] = useState<{ key: string; matches: CustomerMatch[]; error: string }>({ key: "", matches: [], error: "" });
  const [selected, setSelected] = useState<CustomerMatch | null>(null);
  const [customer, setCustomer] = useState<NewCustomer>(EMPTY_CUSTOMER);
  const [manualAddress, setManualAddress] = useState(false);
  const [addressProof, setAddressProof] = useState<AddressProof | null>(null);
  const [description, setDescription] = useState(DEFAULT_DESCRIPTIONS[measurementKind]);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<CreateRequest | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const getAuthorization = useCallback(() => user.getIdToken(), [user]);
  const searchTerm = search.trim();
  const lookupKey = JSON.stringify([user.uid, searchTerm, searchRetry]);
  const searching = mode === "existing" && !selected && searchTerm.length >= 2 && lookup.key !== lookupKey;
  const locked = submitting || uncertain;
  const dirty = Boolean(selected) || Object.values(customer).some(Boolean) || description !== DEFAULT_DESCRIPTIONS[measurementKind] || uncertain;

  useEffect(() => { onBusyChange(submitting); }, [submitting, onBusyChange]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { onBusyChange(false); onDirtyChange(false); }, [onBusyChange, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  useEffect(() => {
    if (mode !== "existing" || selected || searchTerm.length < 2 || locked) return;
    const controller = new AbortController();
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      timeout = setTimeout(() => {
        controller.abort();
        if (active) setLookup({ key: lookupKey, matches: [], error: "Customer search took too long. Try again." });
      }, 25000);
      void (async () => {
        try {
          const token = await getAuthorization();
          if (controller.signal.aborted) return;
          const response = await fetch("/api/trade-crm", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: "find_quick_quote_customers", search: searchTerm }),
            cache: "no-store", signal: controller.signal,
          });
          const data: unknown = await response.json();
          if (!response.ok || !isRecord(data) || data.ok !== true || !Array.isArray(data.matches)) {
            throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "Could not find customers. Try again.");
          }
          if (active && !controller.signal.aborted) setLookup({ key: lookupKey, matches: data.matches.filter(isCustomerMatch).slice(0, 10), error: "" });
        } catch (cause) {
          if (active && !controller.signal.aborted) setLookup({ key: lookupKey, matches: [], error: cause instanceof Error ? cause.message : "Could not find customers. Try again." });
        } finally { clearTimeout(timeout); }
      })();
    }, 280);
    return () => { active = false; controller.abort(); clearTimeout(debounce); clearTimeout(timeout); };
  }, [fetch, getAuthorization, locked, lookupKey, mode, searchTerm, selected]);

  function changeAddress(field: "addressLine1" | "addressLine2" | "suburb" | "addressState" | "postcode", value: string) {
    if (locked || request.current) return;
    setAddressProof(null);
    setCustomer((current) => ({ ...current, [field]: value }));
  }
  function selectAddress(selection: AustralianAddressSuggestion) {
    if (locked || request.current) return;
    setCustomer((current) => ({ ...current, addressLine1: selection.addressLine1, addressLine2: selection.addressLine2, suburb: selection.suburb, addressState: selection.addressState, postcode: selection.postcode }));
    setAddressProof(selection.provider && selection.providerReference && selection.formattedAddress && selection.selectionProof
      ? { addressProvider: selection.provider, addressProviderReference: selection.providerReference, addressFormatted: selection.formattedAddress, addressSelectionProof: selection.selectionProof }
      : null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    if (!attempt.current) {
      if (mode === "existing" && (!selected || !hasCustomerDetails(selected))) {
        setError("Choose a customer with an email, mobile number and complete property address.");
        return;
      }
      if (mode === "new" && !canCreateCustomer) { setError("Choose an existing customer to continue."); return; }
      if (mode === "new" && customer.phone.replace(/\D/g, "").length < 8) { setError("Add a valid customer mobile number."); return; }
      if (mode === "new" && !manualAddress && !addressProof) { setError("Choose a suggested address, or select Enter address manually to use these details."); return; }
      const base = { action: "create_quick_quote_job" as const, clientRequestId: crypto.randomUUID(), customerMode: mode, serviceCategory: measurementKind === "solar" ? "solar" : measurementKind === "area" ? "insulation" : "other", description: description.trim() };
      if (mode === "existing" && selected) {
        attempt.current = { ...base, crmCustomerId: selected.customerId, serviceSiteId: selected.serviceSiteId, email: selected.email };
      } else {
        attempt.current = { ...base, ...customer, email: customer.email.trim(), addressEntryMode: addressProof ? "provider_selected" : "manual_pending_review", ...addressProof };
      }
    }
    const controller = new AbortController();
    request.current = controller;
    setSubmitting(true);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 30000);
    // An earlier uncertain request may already exist even if a retry fails before sending.
    const wasUncertain = uncertain;
    let sent = wasUncertain;
    try {
      const token = await getAuthorization();
      if (controller.signal.aborted) throw new Error("The request took too long. Try again.");
      sent = true;
      const response = await fetch("/api/trade-crm", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(attempt.current), cache: "no-store", signal: controller.signal,
      });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || data.ok !== true) {
        if (!wasUncertain && response.status >= 400 && response.status < 500) { attempt.current = null; sent = false; }
        throw new Error(isRecord(data) && typeof data.error === "string" ? data.error : "Could not create the quote. Try again.");
      }
      if (typeof data.id !== "string" || !data.id.trim() || data.id.length > 180) throw new Error("The quote response was incomplete. Retry to open the same quote.");
      if (mounted.current) {
        onBusyChange(false);
        onDirtyChange(false);
        onCreated(data.id);
      }
    } catch (cause) {
      if (mounted.current) {
        if (!sent) attempt.current = null;
        setUncertain(sent);
        setError(sent ? "We could not confirm whether the quote was created. Retry below to safely recover the same quote." : cause instanceof Error ? cause.message : "Could not create the quote. Try again.");
      }
    } finally {
      clearTimeout(timeout);
      request.current = null;
      if (mounted.current) setSubmitting(false);
    }
  }

  return <form className={styles.form} onSubmit={submit}>
    <fieldset disabled={locked}>
      <legend className={styles.legend}>Customer and property</legend>
      <div className={styles.modes} role="group" aria-label="Customer type">
        <button type="button" aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setError(""); }}>Existing customer</button>
        {canCreateCustomer && <button type="button" aria-pressed={mode === "new"} onClick={() => { setMode("new"); setError(""); }}>New customer</button>}
      </div>
      {mode === "existing" ? <div className={styles.existing}>
        {selected ? <div className={styles.selected}>
          <strong>{selected.displayName}</strong><span>{siteAddress(selected)}</span><span>{selected.email} · {selected.phone}</span>
          <button type="button" onClick={() => { setSelected(null); setError(""); }}>Change customer or property</button>
          {!hasCustomerDetails(selected) && <p role="alert">This customer needs an email, mobile number and full property address. Update their customer record, then choose them again.</p>}
        </div> : <>
          <label>Find a customer<input type="search" autoFocus maxLength={100} placeholder="Name, email, phone or address" value={search} onChange={(event) => { setSearch(event.target.value); setError(""); }} /></label>
          {searchTerm.length < 2 ? <p className={styles.help}>Enter at least 2 characters, then choose the customer and property.</p> : searching ? <p role="status">Finding customers…</p> : lookup.key === lookupKey && <>
            {lookup.error ? <div role="alert"><p>{lookup.error}</p><button type="button" onClick={() => setSearchRetry((value) => value + 1)}>Try again</button></div> : <div className={styles.matches} aria-label="Customer search results">
              {lookup.matches.map((match) => <button key={`${match.customerId}:${match.serviceSiteId}`} type="button" onClick={() => { setSelected(match); setError(""); }}>
                <strong>{match.displayName}</strong><span>{siteAddress(match)}</span><small>{match.customerNumber}{match.siteLabel ? ` · ${match.siteLabel}` : ""}</small>
              </button>)}
              {!lookup.matches.length && <p>No matching customers. Try another search{canCreateCustomer ? " or choose New customer" : ""}.</p>}
              {lookup.matches.length === 10 && <p className={styles.help}>Showing the first 10 properties. Refine your search if needed.</p>}
            </div>}
          </>}
        </>}
      </div> : <div className={styles.grid}>
        <label>First name<input required autoComplete="given-name" maxLength={80} value={customer.firstName} onChange={(event) => setCustomer((current) => ({ ...current, firstName: event.target.value }))} /></label>
        <label>Last name (optional)<input autoComplete="family-name" maxLength={80} value={customer.lastName} onChange={(event) => setCustomer((current) => ({ ...current, lastName: event.target.value }))} /></label>
        <label>Email<input required type="email" autoComplete="email" maxLength={180} value={customer.email} onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))} /></label>
        <label>Mobile number<input required type="tel" autoComplete="tel" maxLength={40} value={customer.phone} onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))} /></label>
        <div className={styles.wide}>
          {manualAddress ? <label>Street address<input required autoComplete="address-line1" maxLength={140} value={customer.addressLine1} onChange={(event) => changeAddress("addressLine1", event.target.value)} /></label> : <AustralianAddressLookup value={customer.addressLine1} onChange={(value) => changeAddress("addressLine1", value)} onSelect={selectAddress} endpoint="/api/trade-address-suggestions" getAuthorization={getAuthorization} required hideHelp />}
          <label className={styles.manual}><input type="checkbox" checked={manualAddress} onChange={(event) => { setManualAddress(event.target.checked); setAddressProof(null); }} />Enter address manually</label>
          {!manualAddress && customer.addressLine1 && !addressProof && <p className={styles.help}>Choose a suggested address, or select Enter address manually.</p>}
        </div>
        <label>Unit / address line 2 (optional)<input autoComplete="address-line2" maxLength={140} value={customer.addressLine2} onChange={(event) => changeAddress("addressLine2", event.target.value)} /></label>
        <label>Suburb<input required autoComplete="address-level2" maxLength={100} value={customer.suburb} onChange={(event) => changeAddress("suburb", event.target.value)} /></label>
        <label>State<select required autoComplete="address-level1" value={customer.addressState} onChange={(event) => changeAddress("addressState", event.target.value)}><option value="">Choose state</option>{STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select></label>
        <label>Postcode<input required inputMode="numeric" pattern="[0-9]{4}" autoComplete="postal-code" maxLength={4} value={customer.postcode} onChange={(event) => changeAddress("postcode", event.target.value)} /></label>
      </div>}
      <label className={styles.description}>Work description<textarea required rows={2} maxLength={3000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    </fieldset>
    <p className={styles.help}>Creates a job{mode === "new" ? " and customer" : ""}, then opens your quote with the map quantity. Nothing is sent to the customer.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button className={styles.submit} type="submit" disabled={submitting || (!uncertain && mode === "existing" && (!selected || !hasCustomerDetails(selected)))}>{submitting ? "Creating quote…" : uncertain ? "Retry create quote" : "Create quote"}</button>
  </form>;
}
