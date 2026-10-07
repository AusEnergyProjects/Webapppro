"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { readTradeBusinessSelection } from "@/lib/trade-business-client";
import type { WattzunPortal, WattzunScope } from "@/lib/wattzun-portal";
import { WATTZUN_HATS, WATTZUN_USAGE_CHANGED_EVENT, requestWattzunAssistant, useWattzunPresentation } from "@/lib/wattzun-appearance";
import type { WattzunUsage } from "@/lib/wattzun-usage";
import { WattzunMascot } from "./WattzunMascot";
import styles from "./WattzunToolsWorkspace.module.css";

const portalNames: Record<WattzunPortal, string> = { trade: "TLink", council: "Council", creditex: "Creditex" };
const suggestions: Record<WattzunPortal, { title: string; message: string }[]> = {
  trade: [
    { title: "A brief from your actual job", message: "Show me how to select a job with Ask Wattzun, then summarise its saved scope, checklist and next steps." },
    { title: "Update an existing quote", message: "Help me draft changes to the quote for an existing job and save them into its real quote editor. Ask me which job and what work to include." },
    { title: "Text or email a customer", message: "Help me send a customer message for an existing job. Ask me which customer, text or email, and what to say." },
    { title: "Remind an unpaid invoice", message: "Help me send an invoice reminder for an existing job. Ask me which job and whether to use text or email, then check its actual unpaid invoice." },
    { title: "Add a price-book item", message: "Help me add an item to my price book. Ask for the item, unit price excluding GST and any missing details." },
    { title: "Fill a job form together", message: "Help me fill an actual job form, one question at a time. Help me find the job and choose Fill with Wattzun in its form." },
    { title: "Create a reusable form", message: "Help me create a business form for a site visit. What should I tell you first?" },
    { title: "Find a feature", message: "What can you help me do in TLink, and where do I find those features?" },
  ],
  council: [
    { title: "Explain this Council report", message: "Show me where to open Reports & insights and select Ask Wattzun to explain the figures, coverage and next steps." },
    { title: "Campaigns and events", message: "Help me plan a council campaign. What information do you need?" },
    { title: "Demographics and upgrade planning", message: "Open the Council map so I can compare postcode demographics and energy upgrades. Help me choose useful comparisons for our outreach." },
    { title: "Team handover", message: "Help me draft a clear handover to a Council colleague, then show me Connect to send it." },
    { title: "Reports and community progress", message: "Help me understand the council reports and where to find community progress." },
    { title: "Find a feature", message: "What can you help me do in the Council workspace?" },
  ],
  creditex: [
    { title: "Help with the selected audit", message: "Show me how to open a job audit and choose Ask Wattzun to review saved answers, evidence metadata and supported gaps." },
    { title: "Correction wording", message: "Help me draft neutral correction wording for the audit I select. Separate recorded evidence, possible gaps and questions for the reviewer." },
    { title: "Audit preparation", message: "Help me prepare for an audit review. What details do you need?" },
    { title: "Forms and evidence", message: "Where can I find the forms and evidence tools in Creditex?" },
    { title: "Find a feature", message: "What can you help me do in the Creditex workspace?" },
  ],
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
async function payload(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!response.ok || !record(value) || value.ok !== true) throw new Error(record(value) && typeof value.error === "string" ? value.error : "Wattzun could not load this workspace. Try again.");
  return value;
}
function isUsage(value: unknown, scope: WattzunScope): value is WattzunUsage {
  return record(value) && value.portal === scope.portal && value.scopeId === scope.scopeId
    && typeof value.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
    && value.monthBasis === "UTC" && value.audience === "personal"
    && Number.isSafeInteger(value.textMessages) && Number(value.textMessages) >= 0
    && Number.isSafeInteger(value.voiceExchanges) && Number(value.voiceExchanges) >= 0;
}

export function WattzunToolsWorkspace({ user, portal, scopeId }: { user: User; portal: WattzunPortal; scopeId?: string }) {
  return <WattzunToolsSession key={`${user.uid}:${portal}:${scopeId || "selected"}`} user={user} portal={portal} requestedScopeId={scopeId} />;
}

function WattzunToolsSession({ user, portal, requestedScopeId }: { user: User; portal: WattzunPortal; requestedScopeId?: string }) {
  const [scopes, setScopes] = useState<WattzunScope[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        if (!user.emailVerified) throw new Error("Verify your email before opening Wattzun.");
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const result = await payload(await fetch(`/api/wattzun/portal?portal=${portal}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }));
        if (controller.signal.aborted) return;
        if (!Array.isArray(result.scopes)) throw new Error("Your Wattzun workspaces could not be read. Try again.");
        const choices = result.scopes.filter((value): value is WattzunScope => record(value) && value.portal === portal && typeof value.scopeId === "string" && typeof value.label === "string");
        if (!choices.length || requestedScopeId && !choices.some(value => value.scopeId === requestedScopeId)) throw new Error("Current access to this workspace is required to use Wattzun.");
        const saved = requestedScopeId || (portal === "trade" ? readTradeBusinessSelection(user.uid) : "");
        setScopes(choices);
        setScopeId(choices.find(value => value.scopeId === saved)?.scopeId || (choices.length === 1 ? choices[0].scopeId : ""));
        setError("");
      } catch (failure) {
        if (!controller.signal.aborted) { setScopes([]); setScopeId(""); setError(failure instanceof Error ? failure.message : "Wattzun could not load. Try again."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [user, portal, requestedScopeId, retry]);
  const scope = scopes.find(value => value.scopeId === scopeId);
  return <section className={styles.workspace} aria-label="Wattzun tools">
    {loading && <p role="status">Loading Wattzun...</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" onClick={() => { setLoading(true); setError(""); setRetry(value => value + 1); }}>Try again</button></div>}
    {!loading && !error && <>
      {!requestedScopeId && scopes.length > 1 && <label className={styles.scope}>Workspace<select aria-label="Wattzun workspace" value={scopeId} onChange={event => setScopeId(event.target.value)}><option value="">Choose a workspace</option>{scopes.map(value => <option key={value.scopeId} value={value.scopeId}>{value.label}</option>)}</select></label>}
      {scope ? <WattzunToolsControls key={`${user.uid}:${scope.portal}:${scope.scopeId}`} user={user} scope={scope} /> : <p>Choose the workspace you want Wattzun to help with.</p>}
    </>}
  </section>;
}

function WattzunToolsControls({ user, scope }: { user: User; scope: WattzunScope }) {
  const { hat, speed, setHat, setSpeed } = useWattzunPresentation({ userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId });
  const [usage, setUsage] = useState<WattzunUsage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [usageLoading, setUsageLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const query = new URLSearchParams({ portal: scope.portal, scopeId: scope.scopeId });
        const result = await payload(await fetch(`/api/wattzun/usage?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal }));
        if (controller.signal.aborted) return;
        if (!isUsage(result.usage, scope)) throw new Error("Your usage figures could not be read. Try again.");
        setUsage(result.usage); setUsageError("");
      } catch (failure) {
        if (!controller.signal.aborted) { setUsage(null); setUsageError(failure instanceof Error ? failure.message : "Your usage could not be loaded. Try again."); }
      } finally { if (!controller.signal.aborted) setUsageLoading(false); }
    })();
    const changed = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : null;
      if (record(detail) && detail.userUid === user.uid && detail.portal === scope.portal && detail.scopeId === scope.scopeId) {
        setUsageLoading(true); setRefresh(value => value + 1);
      }
    };
    window.addEventListener(WATTZUN_USAGE_CHANGED_EVENT, changed);
    return () => { controller.abort(); window.removeEventListener(WATTZUN_USAGE_CHANGED_EVENT, changed); };
  }, [user, scope, refresh]);
  async function open(mode: "call" | "message", initialMessage?: string) {
    if (opening) return;
    setOpening(true); setOpenError("");
    const opened = await requestWattzunAssistant({ userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId, mode, initialMessage });
    if (!active.current) return;
    setOpening(false);
    if (!opened) setOpenError("Wattzun could not open. Refresh this page and try again.");
  }
  const monthLabel = usage ? new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${usage.month}-01T00:00:00Z`)) : "This month";
  return <>
    <header className={styles.hero}>
      <div className={styles.heroCopy}><span className={styles.eyebrow}>Your {portalNames[scope.portal]} companion</span><h1>Wattzun</h1><p>Office questions, onsite tasks and a hand finding your next step. Tell him what you need, and he will ask when something is unclear.</p><div className={styles.actions}><button className={styles.primary} type="button" disabled={opening} onClick={() => void open("call")}><ToolIcon kind="call" />Call Wattzun</button><button type="button" disabled={opening} onClick={() => void open("message")}><ToolIcon kind="message" />Message Wattzun</button></div><p className={styles.caption}>Working in {scope.label}</p></div>
      <div className={styles.heroMascot}><WattzunMascot hat={hat} className={styles.mascot} /><span>Ready when you are.</span></div>
    </header>
    {openError && <p className={styles.error} role="alert">{openError}</p>}
    <div className={styles.grid}>
      <section className={styles.card} aria-label="Your Wattzun usage"><div className={styles.cardHeading}><div><h2>Your usage</h2><p>{monthLabel}{usage ? " · UTC" : ""}</p></div><button className={styles.refresh} type="button" disabled={usageLoading} onClick={() => { setUsageLoading(true); setRefresh(value => value + 1); }} aria-label="Refresh Wattzun usage"><ToolIcon kind="refresh" /></button></div>
        {usageLoading ? <p role="status">Loading your usage...</p> : usageError ? <p className={styles.error} role="alert">{usageError}</p> : usage && <div className={styles.metrics}><div><strong>{usage.textMessages.toLocaleString("en-AU")}</strong><span>Messages answered</span></div><div><strong>{usage.voiceExchanges.toLocaleString("en-AU")}</strong><span>Voice replies</span></div></div>}
        <p className={styles.caption}>Your message and voice replies in this workspace, recorded since usage tracking began. Each voice reply counts as one exchange. Form drafts and record-specific assistants are separate.</p>
      </section>
      <section className={styles.card} aria-label="Wattzun preferences"><h2>Make yourself comfortable</h2><label className={styles.speed}>Speaking speed<select aria-label="Speaking speed" value={speed} onChange={event => { const value = Number(event.target.value); if (value === 0.85 || value === 1 || value === 1.15) setSpeed(value); }}><option value={0.85}>Slower</option><option value={1}>Normal</option><option value={1.15}>Quicker</option></select></label><p className={styles.caption}>Speed changes apply to his next reply.</p><fieldset className={styles.hats}><legend>Pick his hat or costume</legend><div>{WATTZUN_HATS.map(choice => <button type="button" key={choice.id} aria-pressed={hat === choice.id} onClick={() => setHat(choice.id)}><WattzunMascot hat={choice.id} className={styles.hatPreview} /><span>{choice.label}</span></button>)}</div></fieldset><p className={styles.caption}>Your hat or costume and speed choices are remembered on this device for this workspace when browser settings allow.</p></section>
    </div>
    <section className={styles.card} aria-label="Ways Wattzun can help"><h2>A useful place to start</h2><p>Choose a prompt to open it in chat. You can edit it before sending.</p><p>{scope.portal === "trade" ? "Open a job and choose Ask Wattzun to use its recorded scope and checklist. You can also select Use with Wattzun after finding a job in chat." : scope.portal === "creditex" ? "Open the exact job audit and choose Ask Wattzun to use its saved answers, requirements, evidence metadata and open findings." : "Open Reports & insights, choose the period and select Ask Wattzun to explain the protected figures, coverage and methodology."} Sources and limits appear with the answer. He asks for missing details and prepares tasks for your review.</p><div className={styles.suggestions}>{suggestions[scope.portal].map(suggestion => <button type="button" key={suggestion.title} disabled={opening} onClick={() => void open("message", suggestion.message)}><strong>{suggestion.title}</strong><span>{suggestion.message}</span><span aria-hidden="true">↗</span></button>)}</div></section>
    <details className={styles.help}><summary>Calling and getting useful answers</summary><p>Calling uses an AI-generated voice and shares your spoken questions with our AI provider. Your microphone is used while the call is open. Minimise to keep working, or choose Hang up to end the call.</p><p>Pauses do not end your call. If a reply does not come through, you can repeat that last part in the same call. Your conversation and review details stay open while you work.</p><p>Give him the task, the details you know and what a finished result should look like. Selecting Ask Wattzun shares the authorised details of that work item with our AI provider for your conversation. File contents and photos are not read. Messages, form answers, schedules and audit decisions still need your review in their workspace. Check important details before saving, sending or acting.</p></details>
  </>;
}

function ToolIcon({ kind }: { kind: "call" | "message" | "refresh" }) {
  const paths = { call: "M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z", message: "M21 11a8 8 0 0 1-8 8H7l-5 3V5a3 3 0 0 1 3-3h8a8 8 0 0 1 8 9ZM7 8h9M7 12h6", refresh: "M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
