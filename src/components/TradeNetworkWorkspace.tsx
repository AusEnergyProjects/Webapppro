"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { NETWORK_PAGE_SIZE, NETWORK_STATES, NETWORK_TRADES, networkText, normalizeNetworkContact, normalizeNetworkPost,
  type NetworkContact, type NetworkEnquiry, type NetworkKind, type NetworkPost, type NetworkPostInput,
  type NetworkWorkspace } from "@/lib/trade-network";
import styles from "./TradeNetworkWorkspace.module.css";

type View = NetworkKind | "mine" | "enquiries";
type Editor = { id: string; revision: number; post: NetworkPostInput; rate: string };
type ContactEditor = { id: string; post?: NetworkPost; enquiry?: NetworkEnquiry; message: string; contact: NetworkContact };
type ApiResult = Partial<NetworkWorkspace> & { ok?: boolean; error?: string };
const blankPost = (kind: NetworkKind): NetworkPostInput => ({ kind, title: "", trade: "", suburb: "", postcode: "", state: "", details: "", rateCents: null, rateUnit: "hour", startsOn: "", endsOn: "" });
const dateLabel = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const rateLabel = (post: NetworkPost) => post.rateCents === null ? "Rate to discuss" : `${post.kind === "available" ? "From " : ""}${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: post.rateCents % 100 ? 2 : 0 }).format(post.rateCents / 100)} / ${post.rateUnit} ex GST`;

function ContactDetails({ contact }: { contact: NetworkContact }) {
  return <address className={styles.contact}><strong>{contact.name}</strong>{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}{contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>{contact.phone}</a>}</address>;
}

export function TradeNetworkWorkspace({ user }: { user: User }) {
  const [view, setView] = useState<View>("work");
  const [filters, setFilters] = useState({ trade: "", state: "", search: "" });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0), [myOffset, setMyOffset] = useState(0), [enquiryOffset, setEnquiryOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: NetworkWorkspace } | null>(null);
  const [loadFailure, setLoadFailure] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [contactEditor, setContactEditor] = useState<ContactEditor | null>(null);
  const saving = useRef(false);
  const kind = view === "available" ? "available" : "work";
  const query = new URLSearchParams({ kind, ...applied, offset: String(offset), myOffset: String(myOffset), enquiryOffset: String(enquiryOffset) }).toString();
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
      if (typeof result.enabled !== "boolean" || typeof result.canManageMembership !== "boolean" || !Array.isArray(result.posts) || !Array.isArray(result.myPosts) || !Array.isArray(result.enquiries)) throw new Error("The trade network response was incomplete. Please try again.");
      setLoaded({ key, data: { enabled: result.enabled, canManageMembership: result.canManageMembership,
        posts: result.posts, myPosts: result.myPosts, enquiries: result.enquiries, hasMore: result.hasMore === true,
        myHasMore: result.myHasMore === true, enquiriesHasMore: result.enquiriesHasMore === true } });
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
    if (next === "work" || next === "available") setOffset(0);
    setReload(value => value + 1);
  }
  function editPost(post: NetworkPost | NetworkKind) {
    const existing = typeof post !== "string";
    setEditor({ id: existing ? post.id : crypto.randomUUID(), revision: existing ? post.revision : 0,
      post: existing ? { kind: post.kind, title: post.title, trade: post.trade, suburb: post.suburb, postcode: post.postcode, state: post.state, details: post.details, rateCents: post.rateCents, rateUnit: post.rateUnit, startsOn: post.startsOn, endsOn: post.endsOn } : blankPost(post),
      rate: existing && post.rateCents !== null ? (post.rateCents / 100).toFixed(2) : "" });
    setContactEditor(null); setError(""); setNotice("");
  }
  function field<K extends keyof NetworkPostInput>(name: K, value: NetworkPostInput[K]) { setEditor(current => current ? { ...current, post: { ...current.post, [name]: value } } : null); }
  function openContact(post?: NetworkPost, enquiry?: NetworkEnquiry) {
    setContactEditor({ id: enquiry?.id || crypto.randomUUID(), post, enquiry, message: "", contact: { name: user.displayName || "", email: user.email || "", phone: "" } });
    setEditor(null); setError(""); setNotice("");
  }
  function contactField(name: keyof NetworkContact, value: string) { setContactEditor(current => current ? { ...current, contact: { ...current.contact, [name]: value } } : null); }
  function savePost(event: FormEvent) {
    event.preventDefault(); if (!editor || !data?.enabled) return;
    try {
      if (editor.rate && !/^\d+(\.\d{1,2})?$/.test(editor.rate)) throw new Error("Enter a rate with up to two decimal places.");
      const post = normalizeNetworkPost({ ...editor.post, rateCents: editor.rate ? Math.round(Number(editor.rate) * 100) : null });
      void mutate({ action: "save_post", id: editor.id, expectedRevision: editor.revision, post }, "Your post is saved.", () => { setEditor(null); setView("mine"); setMyOffset(0); });
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
  const posts = view === "mine" ? data?.myPosts : data?.posts;
  const pageOffset = view === "mine" ? myOffset : view === "enquiries" ? enquiryOffset : offset;
  const hasMore = view === "mine" ? data?.myHasMore : view === "enquiries" ? data?.enquiriesHasMore : data?.hasMore;
  function changePage(next: number) { if (view === "mine") setMyOffset(next); else if (view === "enquiries") setEnquiryOffset(next); else setOffset(next); }

  return <section className={`dashboard-panel ${styles.workspace}`} aria-labelledby="trade-network-heading">
    <header className={styles.header}><div><h2 id="trade-network-heading">Trade network</h2><p>Find work and subcontractors within TLink.</p></div>
      {data?.enabled && <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => editPost("work")}>Need a subcontractor</button><button disabled={busy} onClick={() => editPost("available")}>Open to work</button></div>}
    </header>
    {loadError && <div className={styles.error} role="alert">{loadError} <button onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!data && !loadError && <p role="status" className={styles.empty}>Loading trade network…</p>}
    {data && <>
      {!data.enabled && <div className={styles.join}><div><h3>Join the trade network</h3><p>Post work you need covered or let other trades know you are available. Only verified TLink businesses can participate.</p><p>Contact details are shared only when you send an enquiry or connect.</p></div>
        {data.canManageMembership ? <button className={styles.primary} disabled={busy} onClick={() => void mutate({ action: "membership", enabled: true }, "Your business has joined the trade network.")}>{busy ? "Joining…" : "Join trade network"}</button> : <p>Ask your business owner to turn on the trade network.</p>}
      </div>}
      <nav className={styles.tabs} aria-label="Trade network views">{([ ["work", "Work available"], ["available", "Available trades"], ["mine", "My posts"], ["enquiries", "Enquiries"] ] as const).map(([value, label]) => <button key={value} aria-pressed={view === value} disabled={busy} onClick={() => selectView(value)}>{label}</button>)}</nav>
      {editor && data.enabled ? <form className={styles.editor} onSubmit={savePost}>
        <header><h3>{editor.revision ? "Edit post" : editor.post.kind === "work" ? "Find a subcontractor" : "Let trades know you are available"}</h3><p>Your post stays visible for 30 days. Close it whenever you are sorted.</p></header>
        <fieldset disabled={busy} className={styles.fields}>
          <label className={styles.wide}>Title<input autoFocus required maxLength={120} placeholder={editor.post.kind === "work" ? "e.g. Plumber needed for hot water installations" : "e.g. Electrical crew available next week"} value={editor.post.title} onChange={event => field("title", event.target.value)} /></label>
          <label>Trade<select required value={editor.post.trade} onChange={event => field("trade", event.target.value)}><option value="">Choose a trade</option>{NETWORK_TRADES.map(trade => <option key={trade}>{trade}</option>)}</select></label>
          <label>Suburb<input required maxLength={80} value={editor.post.suburb} onChange={event => field("suburb", event.target.value)} /></label>
          <label>Postcode<input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={editor.post.postcode} onChange={event => field("postcode", event.target.value)} /></label>
          <label>State<select required value={editor.post.state} onChange={event => field("state", event.target.value)}><option value="">Choose state</option>{NETWORK_STATES.map(state => <option key={state}>{state}</option>)}</select></label>
          <label className={styles.wide}>{editor.post.kind === "work" ? "What do you need?" : "What work can you help with?"}<textarea required rows={3} maxLength={2000} value={editor.post.details} onChange={event => field("details", event.target.value)} /><small>Use the suburb only. Keep customer names, site addresses and private documents out of your post.</small></label>
          <label>{editor.post.kind === "work" ? "Offered rate (ex GST)" : "Minimum rate (ex GST)"}<input inputMode="decimal" placeholder="Optional, discuss later" maxLength={10} value={editor.rate} onChange={event => setEditor({ ...editor, rate: event.target.value })} /></label>
          <label>Rate per<select value={editor.post.rateUnit} onChange={event => field("rateUnit", event.target.value === "day" ? "day" : event.target.value === "job" ? "job" : "hour")}><option value="hour">Hour</option><option value="day">Day</option><option value="job">Job</option></select></label>
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
          {posts?.length === 0 && (data.enabled || view === "mine") && <div className={styles.empty}><h3>{view === "mine" ? "No posts yet" : view === "work" ? "No work posted here yet" : "No available trades found"}</h3><p>{view === "mine" ? "Post work you need covered or advertise your availability." : "Try another area or trade, or add your own post."}</p></div>}
          {posts?.map(post => <article className={styles.card} key={post.id}>
            <div className={styles.meta}><span>{post.trade} · {post.suburb}, {post.state} {post.postcode}</span>{view === "mine" && <span className={styles.status}>{post.status}</span>}</div>
            <h3>{post.title}</h3><p className={styles.muted}>{post.businessName}{post.isOwn ? " · Your business" : ""}</p><strong className={styles.rate}>{rateLabel(post)}</strong>
            <p className={styles.description}>{post.details}</p>{(post.startsOn || post.endsOn) && <p className={styles.muted}>{post.startsOn ? `From ${dateLabel(post.startsOn)}` : ""}{post.endsOn ? ` Until ${dateLabel(post.endsOn)}` : ""}</p>}
            <div className={styles.cardFooter}><span className={styles.muted}>{post.status === "active" ? `Closes ${dateLabel(post.expiresAt)}` : post.kind === "work" ? "Work request" : "Availability"}</span><div className={styles.actions}>
              {post.isOwn ? <>{data.enabled && <button disabled={busy} onClick={() => editPost(post)}>Edit</button>}{post.status === "active" ? <button disabled={busy} onClick={() => void mutate({ action: "close_post", id: post.id, expectedRevision: post.revision }, "Post closed.")}>Close post</button> : data.enabled && <button disabled={busy} onClick={() => void mutate({ action: "renew_post", id: post.id, expectedRevision: post.revision }, "Post renewed for 30 days.")}>Renew post</button>}</> : post.enquiryId ? <button onClick={() => selectView("enquiries")}>View enquiry</button> : data.enabled && <button className={styles.primary} disabled={busy} onClick={() => openContact(post)}>Enquire</button>}
            </div></div>
          </article>)}
        </div>}
        {(pageOffset > 0 || hasMore) && <nav className={styles.pagination} aria-label="Network pages"><button disabled={busy || pageOffset === 0} onClick={() => changePage(Math.max(0, pageOffset - NETWORK_PAGE_SIZE))}>Previous</button><span>Page {Math.floor(pageOffset / NETWORK_PAGE_SIZE) + 1}</span><button disabled={busy || !hasMore} onClick={() => changePage(pageOffset + NETWORK_PAGE_SIZE)}>Next</button></nav>}
      </>}
      {data.enabled && data.canManageMembership && <details className={styles.settings}><summary>Network settings</summary><p>Leaving hides your posts and stops new enquiries. Your existing enquiry history stays available. Rejoining does not reopen old posts.</p><button disabled={busy} onClick={() => void mutate({ action: "membership", enabled: false }, "Your business has left the trade network. Your posts are hidden.", () => { setEditor(null); setContactEditor(null); })}>Leave trade network</button></details>}
    </>}
  </section>;
}
