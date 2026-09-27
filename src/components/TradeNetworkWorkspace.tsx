"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { NETWORK_PAGE_SIZE, NETWORK_STATES, NETWORK_TRADES, networkText, normalizeNetworkContact, normalizeNetworkPost,
  type NetworkContact, type NetworkEnquiry, type NetworkKind, type NetworkMinimumRates, type NetworkPost, type NetworkPostInput,
  type NetworkWorkspace } from "@/lib/trade-network";
import styles from "./TradeNetworkWorkspace.module.css";

type View = NetworkKind | "leads" | "mine" | "enquiries";
type Editor = { id: string; revision: number; post: NetworkPostInput; rate: string };
type RateInputs = { hour: string; day: string; job: string };
type AvailabilityEditor = { trades: string[]; openToWork: boolean; minimumRates: RateInputs };
type ContactEditor = { id: string; post?: NetworkPost; enquiry?: NetworkEnquiry; message: string; contact: NetworkContact };
type ApiResult = Partial<NetworkWorkspace> & { ok?: boolean; error?: string };
const blankPost = (kind: NetworkKind): NetworkPostInput => ({ kind, title: "", trade: "", suburb: "", postcode: "", state: "", details: "", rateCents: null, rateUnit: "hour", startsOn: "", endsOn: "" });
const dateLabel = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const rateLabel = (post: NetworkPost) => post.rateCents === null ? "Rate to discuss" : `${post.kind === "available" ? "From " : ""}${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: post.rateCents % 100 ? 2 : 0 }).format(post.rateCents / 100)} / ${post.rateUnit} ex GST`;
const rateInputs = (rates: NetworkMinimumRates): RateInputs => ({ hour: rates.hour === null ? "" : (rates.hour / 100).toFixed(2), day: rates.day === null ? "" : (rates.day / 100).toFixed(2), job: rates.job === null ? "" : (rates.job / 100).toFixed(2) });
const rateUnits = [["hour", "Per hour"], ["day", "Per day"], ["job", "Per job"]] as const;
function minimumCents(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter minimum rates with up to two decimal places, or leave them blank.");
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) throw new Error("Enter a minimum greater than $0 and no more than $1,000,000, or leave it blank.");
  return cents;
}

function ContactDetails({ contact }: { contact: NetworkContact }) {
  return <address className={styles.contact}><strong>{contact.name}</strong>{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}{contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a>}</address>;
}

export function TradeNetworkWorkspace({ user, initialPostId = "", onClearPost, onOpenServiceAreas }: {
  user: User; initialPostId?: string; onClearPost?: () => void; onOpenServiceAreas: () => void;
}) {
  const [view, setView] = useState<View>("leads");
  const [filters, setFilters] = useState({ trade: "", state: "", search: "" });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0), [myOffset, setMyOffset] = useState(0), [enquiryOffset, setEnquiryOffset] = useState(0);
  const [leadsOffset, setLeadsOffset] = useState(0);
  const [availabilityEditor, setAvailabilityEditor] = useState<AvailabilityEditor | null>(null);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: NetworkWorkspace } | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [contactEditor, setContactEditor] = useState<ContactEditor | null>(null);
  const saving = useRef(false);
  const kind = view === "available" ? "available" : "work";
  const query = new URLSearchParams({ kind, ...applied, offset: String(offset), myOffset: String(myOffset), enquiryOffset: String(enquiryOffset), leadsOffset: String(leadsOffset), ...(initialPostId && view === "leads" ? { leadPostId: initialPostId } : {}) }).toString();
  const key = `${user.uid}:${query}:${reload}`;
  const data = loaded?.key === key ? loaded.data : null;
  const loadError = loadFailure?.key === key ? loadFailure.message : "";

  const request = useCallback(async (init: RequestInit = {}, queryString = "") => {
    const token = await user.getIdToken();
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-network${queryString ? `?${queryString}` : ""}`, { ...init, headers, cache: "no-store" });
    const result: ApiResult = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(result.error || "The trade network could not be loaded. Please try again.");
    return result;
  }, [user]);

  useEffect(() => {
    const controller = new AbortController();
    request({ signal: controller.signal }, query).then(result => {
      if (controller.signal.aborted) return;
      if (typeof result.enabled !== "boolean" || typeof result.canManageMembership !== "boolean" || !Array.isArray(result.posts) || !Array.isArray(result.myPosts) || !Array.isArray(result.enquiries) || !Array.isArray(result.leads) || !result.availability || !Array.isArray(result.availability.workTrades) || !Array.isArray(result.availability.serviceAreas) || !Array.isArray(result.availability.serviceStates) || typeof result.availability.openToWork !== "boolean" || typeof result.availability.paused !== "boolean" || typeof result.leadCount !== "number" || !result.workPostAllowance || !Number.isInteger(result.workPostAllowance.remaining) || !result.availability.minimumRates || !rateUnits.every(([unit]) => result.availability?.minimumRates[unit] === null || (Number.isSafeInteger(result.availability?.minimumRates[unit]) && Number(result.availability?.minimumRates[unit]) > 0))) throw new Error("The trade network response was incomplete. Please try again.");
      setLoaded({ key, data: { enabled: result.enabled, canManageMembership: result.canManageMembership,
        posts: result.posts, myPosts: result.myPosts, enquiries: result.enquiries, hasMore: result.hasMore === true,
        myHasMore: result.myHasMore === true, enquiriesHasMore: result.enquiriesHasMore === true,
        availability: result.availability, leads: result.leads, leadCount: result.leadCount, leadsHasMore: result.leadsHasMore === true, workPostAllowance: result.workPostAllowance } });
    }).catch(reason => { if (!controller.signal.aborted) setLoadFailure({ key, message: reason instanceof Error ? reason.message : "The trade network could not be loaded." }); });
    return () => controller.abort();
  }, [request, query, key]);

  async function mutate(body: object, success: string, after?: () => void) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await request({ method: "POST", body: JSON.stringify(body) });
      after?.(); setNotice(success); setReload(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That could not be saved. Please try again."); }
    finally { saving.current = false; setBusy(false); }
  }
  function selectView(next: View) {
    setView(next); setEditor(null); setContactEditor(null); setError(""); setNotice("");
    setAvailabilityEditor(null); onClearPost?.();
    if (next === "work" || next === "available") setOffset(0);
    if (next === "leads") setLeadsOffset(0);
    setReload(value => value + 1);
  }
  function editPost(post: NetworkPost | NetworkKind) {
    const existing = typeof post !== "string";
    setEditor({ id: existing ? post.id : crypto.randomUUID(), revision: existing ? post.revision : 0,
      post: existing ? { kind: post.kind, title: post.title, trade: post.trade, suburb: post.suburb, postcode: post.postcode, state: post.state, details: post.details, rateCents: post.rateCents, rateUnit: post.rateUnit, startsOn: post.startsOn, endsOn: post.endsOn } : blankPost(post),
      rate: existing && post.rateCents !== null ? (post.rateCents / 100).toFixed(2) : "" });
    setContactEditor(null); setAvailabilityEditor(null); setError(""); setNotice("");
  }
  function field<K extends keyof NetworkPostInput>(name: K, value: NetworkPostInput[K]) { setEditor(current => current ? { ...current, post: { ...current.post, [name]: value } } : null); }
  function openContact(post?: NetworkPost, enquiry?: NetworkEnquiry) {
    setContactEditor({ id: enquiry?.id || crypto.randomUUID(), post, enquiry, message: "", contact: { name: user.displayName || "", email: user.email || "", phone: "" } });
    setEditor(null); setError(""); setNotice("");
  }
  function toggleAvailability() {
    if (!data) return;
    if (!data.availability.openToWork && !data.availability.workTrades.length) {
      setAvailabilityEditor({ trades: [], openToWork: true, minimumRates: rateInputs(data.availability.minimumRates) });
      return;
    }
    void mutate({ action: "availability", openToWork: !data.availability.openToWork, workTrades: data.availability.workTrades }, data.availability.openToWork ? "New trade leads are switched off." : "You are open to work. Matching jobs will arrive here automatically.");
  }
  function saveAvailability(event: FormEvent) {
    event.preventDefault(); if (!availabilityEditor) return;
    if (!availabilityEditor.trades.length) { setError("Choose at least one trade so we can match the right work."); return; }
    try {
      const inputs = availabilityEditor.minimumRates;
      const minimumRates = { hour: minimumCents(inputs.hour), day: minimumCents(inputs.day), job: minimumCents(inputs.job) };
      void mutate({ action: "availability", openToWork: availabilityEditor.openToWork, workTrades: availabilityEditor.trades, minimumRates }, "Your work preferences are saved.", () => setAvailabilityEditor(null));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your minimum rates."); }
  }
  function contactField(name: keyof NetworkContact, value: string) { setContactEditor(current => current ? { ...current, contact: { ...current.contact, [name]: value } } : null); }
  function savePost(event: FormEvent) {
    event.preventDefault(); if (!editor || !data?.enabled) return;
    try {
      if (!editor.rate.trim()) throw new Error("Enter a price before posting.");
      if (!/^\d+(\.\d{1,2})?$/.test(editor.rate)) throw new Error("Enter a rate with up to two decimal places.");
      const post = normalizeNetworkPost({ ...editor.post, rateCents: editor.rate ? Math.round(Number(editor.rate) * 100) : null });
      void mutate({ action: "save_post", id: editor.id, expectedRevision: editor.revision, post }, post.kind === "work" ? "Work posted. Matching businesses open to work receive it as a lead." : "Your availability is posted.", () => { setEditor(null); setView("mine"); setMyOffset(0); });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check the post details."); }
  }
  function sendContact(event: FormEvent) {
    event.preventDefault(); if (!contactEditor || !data?.enabled) return;
    try {
      const contact = normalizeNetworkContact(contactEditor.contact, true);
      if (contactEditor.enquiry) void mutate({ action: "connect", id: contactEditor.id, expectedRevision: contactEditor.enquiry.revision, contact, confirmSharing: true }, "Connected. You can now contact each other directly.", () => { setContactEditor(null); setView("enquiries"); setEnquiryOffset(0); });
      else if (contactEditor.post) void mutate({ action: "enquire", id: contactEditor.id, postId: contactEditor.post.id, message: networkText(contactEditor.message, 1200, true, true), contact, confirmSharing: true }, "Enquiry sent. It is now in your enquiries.", () => { setContactEditor(null); setView("enquiries"); setEnquiryOffset(0); });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your contact details."); }
  }
  const posts = view === "leads" ? data?.leads : view === "mine" ? data?.myPosts : data?.posts;
  const pageOffset = view === "leads" ? leadsOffset : view === "mine" ? myOffset : view === "enquiries" ? enquiryOffset : offset;
  const hasMore = view === "leads" ? data?.leadsHasMore : view === "mine" ? data?.myHasMore : view === "enquiries" ? data?.enquiriesHasMore : data?.hasMore;
  function changePage(next: number) { if (view === "leads") setLeadsOffset(next); else if (view === "mine") setMyOffset(next); else if (view === "enquiries") setEnquiryOffset(next); else setOffset(next); }
  const available = data?.availability;
  const receiving = data?.enabled && available?.openToWork && !available.paused && available.workTrades.length > 0 && available.serviceAreas.length > 0 && available.serviceStates.length > 0;

  return <section className={`dashboard-panel ${styles.workspace}`} aria-labelledby="trade-network-heading">
    <header className={styles.header}><div><span className={styles.eyebrow}>Local trades. More opportunities.</span><h2 id="trade-network-heading">Trade network</h2><p>Work from other trades, matched to your area.</p></div>
      {data?.enabled && <button className={styles.primary} disabled={busy || data.workPostAllowance.remaining === 0} onClick={() => editPost("work")}><span aria-hidden="true">+</span> Need a subcontractor</button>}
    </header>
    {data?.enabled && <p className={styles.postAllowance}>{data.workPostAllowance.remaining} of {data.workPostAllowance.limit} job posts left today · Resets at midnight Sydney time. New posts and renewals count.</p>}
    {loadError && <div className={styles.error} role="alert">{loadError} <button onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!data && !loadError && <p role="status" className={styles.empty}>Loading trade network…</p>}
    {data && <>
      {!data.enabled && <div className={styles.join}><div><h3>Good work starts with the right connection.</h3><p>Need a hand? Post a job and we send it to matching local trades. Looking for work? Switch on your availability and receive leads automatically.</p><p>For verified TLink businesses. You choose when to share your contact details.</p></div>
        {data.canManageMembership ? <button className={styles.primary} disabled={busy} onClick={() => void mutate({ action: "membership", enabled: true }, "Your business has joined the trade network.")}>{busy ? "Joining…" : "Join trade network"}</button> : <p>Ask your business owner to turn on the trade network.</p>}
      </div>}
      {data.enabled && available && <section className={styles.availability} aria-label="Work availability" data-receiving={Boolean(receiving)}>
        <div className={styles.availabilityTop}><div><h3><span className={styles.liveDot} aria-hidden="true" />{available.paused ? "Business availability is paused" : receiving ? "You're open to work" : "Receive work from local trades"}</h3><p>{available.paused ? "Update availability in Business settings to receive matching leads." : receiving ? `${available.workTrades.join(" · ")} jobs arrive here automatically.` : "Switch on to receive jobs that match your trades and service area."}</p></div>
          <button type="button" role="switch" aria-checked={available.openToWork} aria-label="Open to work" className={styles.toggle} disabled={busy} onClick={toggleAvailability}><span aria-hidden="true" />{available.openToWork ? "On" : "Off"}</button>
        </div>
        <div className={styles.coverage}><span>{available.serviceAreas.length ? available.serviceAreas.map(area => `${area.postcode} + ${area.radiusKm} km`).join(" · ") : "Set your service area to receive matching work"}{available.serviceStates.length ? ` · ${available.serviceStates.join(", ")}` : ""}</span><div className={styles.actions}><button className={styles.textButton} disabled={busy} onClick={onOpenServiceAreas}>Edit service area</button><button className={styles.textButton} disabled={busy} onClick={() => { setAvailabilityEditor({ trades: available.workTrades, openToWork: available.openToWork, minimumRates: rateInputs(available.minimumRates) }); setError(""); }}>Trades & rates</button></div></div>
        {!availabilityEditor && rateUnits.some(([unit]) => available.minimumRates[unit] !== null) && <p className={styles.rateSummary}>Minimums: {rateUnits.filter(([unit]) => available.minimumRates[unit] !== null).map(([unit]) => `$${Number(available.minimumRates[unit]) / 100} / ${unit}`).join(" · ")} ex GST</p>}
        {availabilityEditor && <form className={styles.tradeChooser} onSubmit={saveAvailability}>
          <h3>What work do you want?</h3><p>Choose your trades. We use the service areas already in your business settings.</p>
          <div className={styles.tradeChips}>{NETWORK_TRADES.map(trade => <button type="button" key={trade} disabled={busy} aria-pressed={availabilityEditor.trades.includes(trade)} onClick={() => setAvailabilityEditor(current => current ? { ...current, trades: current.trades.includes(trade) ? current.trades.filter(value => value !== trade) : [...current.trades, trade] } : null)}>{trade}</button>)}</div>
          <h3>Your minimum rates</h3><p id="network-minimum-help">Optional, excluding GST. Leave a field blank to accept any price for that rate type.</p>
          <fieldset className={styles.minimumRates} disabled={busy} aria-label="Minimum rates" aria-describedby="network-minimum-help">{rateUnits.map(([unit, label]) => <label key={unit}>{label}<input inputMode="decimal" maxLength={10} placeholder="Any price" value={availabilityEditor.minimumRates[unit]} onChange={event => { const value = event.target.value; setAvailabilityEditor(current => current ? { ...current, minimumRates: { ...current.minimumRates, [unit]: value } } : null); }} /></label>)}</fieldset>
          <p className={styles.minimumHelp}>Only jobs meeting the matching minimum arrive as leads. You can still browse all posts.</p>
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : availabilityEditor.openToWork && !available.openToWork ? "Save and switch on" : "Save preferences"}</button><button type="button" disabled={busy} onClick={() => { setAvailabilityEditor(null); setError(""); }}>Cancel</button></div>
        </form>}
      </section>}
      <nav className={styles.tabs} aria-label="Trade network views">{([ ["leads", "Your leads"], ["enquiries", "Enquiries"], ["work", "Work available"], ["available", "Available trades"], ["mine", "My posts"] ] as const).map(([value, label]) => <button key={value} aria-pressed={view === value} disabled={busy} onClick={() => selectView(value)}>{label}{value === "leads" && data.leadCount > 0 && <span className={styles.count}>{data.leadCount}</span>}</button>)}</nav>
      {editor && data.enabled ? <form className={styles.editor} onSubmit={savePost}>
        <header><h3>{editor.revision ? "Edit post" : editor.post.kind === "work" ? "Find a subcontractor" : "Let trades know you are available"}</h3><p>{editor.post.kind === "work" ? "We send this to businesses open to work who cover this area and trade." : "Advertise your availability in the trade directory."} Your post closes after 30 days.</p></header>
        <fieldset disabled={busy} className={styles.fields}>
          <label className={styles.wide}>Title<input autoFocus required maxLength={120} placeholder={editor.post.kind === "work" ? "e.g. Plumber needed for hot water installations" : "e.g. Electrical crew available next week"} value={editor.post.title} onChange={event => field("title", event.target.value)} /></label>
          <label>Trade<select required value={editor.post.trade} onChange={event => field("trade", event.target.value)}><option value="">Choose a trade</option>{NETWORK_TRADES.map(trade => <option key={trade}>{trade}</option>)}</select></label>
          <label>Suburb<input required maxLength={80} value={editor.post.suburb} onChange={event => field("suburb", event.target.value)} /></label>
          <label>Postcode<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={editor.post.postcode} onChange={event => field("postcode", event.target.value)} /></label>
          <label>State<select required value={editor.post.state} onChange={event => field("state", event.target.value)}><option value="">Choose state</option>{NETWORK_STATES.map(state => <option key={state}>{state}</option>)}</select></label>
          <label className={styles.wide}>{editor.post.kind === "work" ? "What do you need?" : "What work can you help with?"}<textarea required rows={3} maxLength={2000} value={editor.post.details} onChange={event => field("details", event.target.value)} /><small>Use the suburb only. Keep customer names, site addresses and private documents out of your post.</small></label>
          <label>{editor.post.kind === "work" ? "Offered rate (ex GST)" : "Minimum rate (ex GST)"}<input required inputMode="decimal" placeholder="Required, e.g. 90.00" maxLength={10} value={editor.rate} onChange={event => setEditor({ ...editor, rate: event.target.value })} /></label>
          <label>Rate per<select required value={editor.post.rateUnit} onChange={event => field("rateUnit", event.target.value === "day" ? "day" : event.target.value === "job" ? "job" : "hour")}><option value="hour">Hour</option><option value="day">Day</option><option value="job">Job</option></select></label>
          <details className={styles.wide}><summary>Add dates (optional)</summary><div className={styles.dateFields}><label>From<input type="date" data-date-range-group="trade-network-post" data-date-range-role="start" value={editor.post.startsOn} onChange={event => field("startsOn", event.target.value)} /></label><label>Until<input type="date" data-date-range-group="trade-network-post" data-date-range-role="end" min={editor.post.startsOn || undefined} value={editor.post.endsOn} onChange={event => field("endsOn", event.target.value)} /></label></div></details>
        </fieldset>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : editor.revision ? "Save changes" : editor.post.kind === "work" ? "Post work" : "Post availability"}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setError(""); }}>Cancel</button></div>
      </form> : contactEditor && data.enabled ? <form className={styles.editor} onSubmit={sendContact}>
        <header><h3>{contactEditor.enquiry ? "Connect with" : "Enquire with"} {contactEditor.enquiry?.businessName || contactEditor.post?.businessName}</h3><p>{contactEditor.enquiry?.postTitle || contactEditor.post?.title}</p></header>
        <fieldset disabled={busy} className={styles.fields}>
          {!contactEditor.enquiry && <label className={styles.wide}>Your message<textarea autoFocus required rows={3} maxLength={1200} placeholder="Introduce yourself and let them know how you can help." value={contactEditor.message} onChange={event => setContactEditor({ ...contactEditor, message: event.target.value })} /></label>}
          <label className={styles.wide}>Contact name<input required maxLength={100} autoComplete="name" value={contactEditor.contact.name} onChange={event => contactField("name", event.target.value)} /></label>
          <label>Business email<input type="email" maxLength={180} autoComplete="email" value={contactEditor.contact.email} onChange={event => contactField("email", event.target.value)} /></label>
          <label>Phone<input type="tel" maxLength={40} autoComplete="tel" value={contactEditor.contact.phone} onChange={event => contactField("phone", event.target.value)} /></label>
        </fieldset>
        <p className={styles.sharing}>By selecting {contactEditor.enquiry ? "Connect" : "Send enquiry"}, you share these contact details with {contactEditor.enquiry?.businessName || contactEditor.post?.businessName}. Add an email or phone number so they can reply.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : contactEditor.enquiry ? "Connect" : "Send enquiry"}</button><button type="button" disabled={busy} onClick={() => { setContactEditor(null); setError(""); }}>Cancel</button></div>
      </form> : <>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {view === "leads" && data.enabled && <div className={styles.sectionHeading}><div><h3>{initialPostId ? "Your trade lead" : "Matched to your business"}</h3><p>Jobs that match your trades, service area and minimum rates land here.</p></div>{initialPostId && <button onClick={() => selectView("leads")}>All your leads</button>}</div>}
        {view === "work" && data.enabled && <p className={styles.muted}>Browse all posted work. Your minimum rates only filter automatic leads.</p>}
        {view === "available" && data.enabled && <div className={styles.sectionHeading}><p>Find a business to contact, or add your own availability listing.</p><button disabled={busy} onClick={() => editPost("available")}>List my business</button></div>}
        {data.enabled && (view === "work" || view === "available") && <form className={styles.filters} onSubmit={event => { event.preventDefault(); setApplied(filters); setOffset(0); }}>
          <label>Trade<select value={filters.trade} onChange={event => setFilters({ ...filters, trade: event.target.value })}><option value="">All trades</option>{NETWORK_TRADES.map(trade => <option key={trade}>{trade}</option>)}</select></label>
          <label>State<select value={filters.state} onChange={event => setFilters({ ...filters, state: event.target.value })}><option value="">All states</option>{NETWORK_STATES.map(state => <option key={state}>{state}</option>)}</select></label>
          <label>Search<input type="search" maxLength={100} placeholder="Suburb, postcode or keyword" value={filters.search} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label><button type="submit">Search</button>
        </form>}
        {view === "enquiries" ? <div className={styles.cards}>
          {data.enquiries.length === 0 && <p className={styles.empty}>No enquiries yet. Your conversations with other businesses will appear here.</p>}
          {data.enquiries.map(enquiry => <article key={enquiry.id} className={styles.card}>
            <div className={styles.meta}><span>{enquiry.direction === "incoming" ? "Received" : "Sent"} · {dateLabel(enquiry.createdAt)}</span><span className={styles.status}>{enquiry.status}</span></div>
            <h3>{enquiry.businessName}</h3><p className={styles.muted}>{enquiry.postTitle}</p><p className={styles.description}>{enquiry.message}</p>
            {enquiry.direction === "incoming" ? <ContactDetails contact={enquiry.senderContact} /> : enquiry.recipientContact ? <ContactDetails contact={enquiry.recipientContact} /> : <p className={styles.muted}>{enquiry.status === "pending" ? "Waiting for this business to connect." : "This enquiry is closed."}</p>}
            <div className={styles.actions}>{enquiry.direction === "incoming" && enquiry.status === "pending" && data.enabled && <button className={styles.primary} disabled={busy} onClick={() => openContact(undefined, enquiry)}>Connect</button>}{enquiry.status !== "closed" && <button disabled={busy} onClick={() => void mutate({ action: "close_enquiry", id: enquiry.id, expectedRevision: enquiry.revision }, "Enquiry closed.")}>Close enquiry</button>}</div>
          </article>)}
        </div> : <div className={styles.cards}>
          {posts?.length === 0 && (data.enabled || view === "mine") && <div className={styles.empty}><h3>{view === "leads" ? initialPostId ? "This lead is no longer available" : "Your next opportunity will appear here" : view === "mine" ? "No posts yet" : view === "work" ? "No work posted here yet" : "No available trades found"}</h3><p>{view === "leads" ? initialPostId ? "It may have closed, been dismissed or no longer match your work preferences." : receiving ? "We'll notify you when another trade posts matching work." : "Switch on Open to work and choose your trades to get started." : view === "mine" ? "Post work you need covered or advertise your availability." : "Try another area or trade, or add your own post."}</p></div>}
          {posts?.map(post => <article className={styles.card} key={post.id} data-new={"leadStatus" in post && post.leadStatus === "new"}>
            <div className={styles.meta}><span className={styles.tradeBadge}>{post.trade}</span>{view === "mine" ? <span className={styles.status}>{post.status}</span> : "leadStatus" in post && post.leadStatus === "new" && <span className={styles.newBadge}>New lead</span>}</div>
            <p className={styles.location}>{post.suburb}, {post.state} {post.postcode}</p>
            <h3>{post.title}</h3><p className={styles.muted}>{post.businessName}{post.isOwn ? " · Your business" : ""}</p><strong className={styles.rate}>{rateLabel(post)}</strong>
            <p className={styles.description}>{post.details}</p>{(post.startsOn || post.endsOn) && <p className={styles.muted}>{post.startsOn ? `From ${dateLabel(post.startsOn)}` : ""}{post.endsOn ? ` Until ${dateLabel(post.endsOn)}` : ""}</p>}
            <div className={styles.cardFooter}><span className={styles.muted}>{post.status === "active" ? `Closes ${dateLabel(post.expiresAt)}` : post.kind === "work" ? "Work request" : "Availability"}</span><div className={styles.actions}>
              {post.isOwn ? <>{data.enabled && <button disabled={busy} onClick={() => editPost(post)}>Edit</button>}{post.status === "active" ? <button disabled={busy} onClick={() => void mutate({ action: "close_post", id: post.id, expectedRevision: post.revision }, "Post closed.")}>Close post</button> : data.enabled && <button disabled={busy || (post.kind === "work" && data.workPostAllowance.remaining === 0 && post.rateCents !== null && post.rateCents > 0)} onClick={() => post.rateCents === null || post.rateCents <= 0 ? editPost(post) : void mutate({ action: "renew_post", id: post.id, expectedRevision: post.revision }, "Post renewed for 30 days.")}>{post.rateCents === null || post.rateCents <= 0 ? "Add price to renew" : "Renew post"}</button>}</> : post.enquiryId ? <button onClick={() => selectView("enquiries")}>View enquiry</button> : data.enabled && <button className={styles.primary} disabled={busy} onClick={() => openContact(post)}>Enquire</button>}
              {view === "leads" && data.enabled && <button className={styles.textButton} disabled={busy} onClick={() => void mutate({ action: "lead_status", id: post.id, status: "dismissed" }, "Lead dismissed.")}>Dismiss</button>}
            </div></div>
          </article>)}
        </div>}
        {(pageOffset > 0 || hasMore) && <nav className={styles.pagination} aria-label="Network pages"><button disabled={busy || pageOffset === 0} onClick={() => changePage(Math.max(0, pageOffset - NETWORK_PAGE_SIZE))}>Previous</button><span>Page {Math.floor(pageOffset / NETWORK_PAGE_SIZE) + 1}</span><button disabled={busy || !hasMore} onClick={() => changePage(pageOffset + NETWORK_PAGE_SIZE)}>Next</button></nav>}
      </>}
      {data.enabled && data.canManageMembership && <details className={styles.settings}><summary>Network settings</summary><p>Leaving hides your posts and stops new leads and enquiries. Your existing enquiry history stays available. Rejoining does not reopen old posts.</p><button disabled={busy} onClick={() => void mutate({ action: "membership", enabled: false }, "Your business has left the trade network. Your posts are hidden.", () => { setEditor(null); setContactEditor(null); setAvailabilityEditor(null); })}>Leave trade network</button></details>}
    </>}
  </section>;
}
