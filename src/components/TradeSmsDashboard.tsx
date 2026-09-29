"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { TradeLegacySmsConnectionPanel } from "./TradeLegacySmsConnectionPanel";
import type { TradeSmsConnection } from "./TradeSmsConnectionPanel";
import styles from "./TradeSmsDashboard.module.css";

type Registration = { businessName: string; contactName: string; email: string; phone: string; address: string; suburb: string; state: string; postcode: string; useCase: string };
type RentalNumber = { number: string; monthlyMicro: number; setupMicro: number; totalMicro: number; currency: "AUD" };
type RentalOrder = { id: string; status: string; number: string; monthlyMicro: number; setupMicro: number; initialReservedMicro: number; initialChargeMicro: number | null; initialChargeSettled: boolean; renewalAt: string; error: string };
type Account = {
  configured: boolean; billingConfigured: boolean; urlsEnabled: boolean;
  pricing: { partPriceMicro: number; taxLabel: string; minimumTopUpCents: number };
  wallet: { balanceMicro: number; reservedMicro: number };
  connection: TradeSmsConnection | null; order: RentalOrder | null;
  ledger: Array<{ id: string; kind: string; amountMicro: number; description: string; createdAt: string }>;
  setup: Omit<Registration, "useCase">;
};
type ApiResult = Partial<Account> & { ok?: boolean; error?: string; code?: string; checkoutUrl?: string; numbers?: RentalNumber[] };
class SmsAccountError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
type PendingRental = { action: "rent_number"; number: string; requestId: string; registration: Registration; acceptedMonthlyMicro: number; acceptedSetupMicro: number; acceptedInitialReservedMicro: number; termsAccepted: true };
const money = (micro: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 }).format(micro / 1_000_000);
const blankRegistration: Registration = { businessName: "", contactName: "", email: "", phone: "", address: "", suburb: "", state: "", postcode: "", useCase: "Appointment reminders and customer service conversations." };
const orderLabel: Record<string, string> = { reserved: "Setup in progress", pending: "Setup in progress", provisioning: "Setting up number", purchasing: "Setting up number", registering: "Registration in progress", active: "Number ready", connected: "Number ready", review: "Setup needs review", uncertain: "Setup needs review", reconciliation_required: "Setup needs review", price_review_required: "Rental price needs review", suspended: "Add credit to resume", cancel_requested: "Cancellation requested", cancel_pending: "Cancellation requested", cancellation_pending: "Cancellation requested", cancelled: "Rental ended", rejected: "Number request declined", failed: "Setup needs attention" };

export function TradeSmsDashboard({ user, getAuthHeaders, onOpenAutomations, canManage = true }: {
  user?: User; getAuthHeaders?: () => Promise<Record<string, string>>; onOpenAutomations?: () => void; canManage?: boolean;
}) {
  const fetch = useTradeBusinessFetch();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [numbers, setNumbers] = useState<RentalNumber[] | null>(null);
  const [selectedNumber, setSelectedNumber] = useState("");
  const [registration, setRegistration] = useState<Registration>(blankRegistration);
  const [reviewing, setReviewing] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);
  const [amountCents, setAmountCents] = useState(5000);
  const [pendingTopUp, setPendingTopUp] = useState<{ amountCents: number; requestId: string } | null>(null);
  const [pendingRental, setPendingRental] = useState<PendingRental | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const selected = numbers?.find(item => item.number === selectedNumber);
  const initialReservationMicro = selected ? Math.max(selected.totalMicro, selected.setupMicro + selected.monthlyMicro) : 0;
  const availableMicro = account ? account.wallet.balanceMicro : 0;
  const legacy = account?.connection?.provider === "twilio";
  const connected = account?.connection?.status === "connected";
  const orderOutstanding = Boolean(account?.order && !["rejected", "failed", "cancelled"].includes(account.order.status));
  const ready = Boolean(account?.configured);

  const request = useCallback(async (path: string, payload?: Record<string, unknown>, signal?: AbortSignal) => {
    const authHeaders = getAuthHeaders ? await getAuthHeaders() : user ? { Authorization: `Bearer ${await user.getIdToken()}` } : null;
    if (!authHeaders) throw new Error("Sign in to manage your business SMS.");
    const response = await fetch(path, { method: payload ? "POST" : "GET", headers: { ...authHeaders, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined, cache: "no-store", signal: signal || AbortSignal.timeout(25000) });
    const result: ApiResult = await response.json();
    if (!response.ok || !result.ok) throw new SmsAccountError(result.error || "SMS could not be updated. Refresh to check its status.", response.status, result.code || "");
    return result;
  }, [fetch, getAuthHeaders, user]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await request("/api/trade-sms/account", undefined, signal);
    if (!result.pricing || !result.wallet || !result.setup || !result.ledger) throw new Error("SMS account details are unavailable. Please refresh.");
    const next: Account = { configured: result.configured === true, billingConfigured: result.billingConfigured === true, urlsEnabled: result.urlsEnabled === true,
      pricing: result.pricing, wallet: result.wallet, setup: result.setup, ledger: result.ledger, connection: result.connection || null, order: result.order || null };
    return next;
  }, [request]);

  useEffect(() => {
    active.current = true;
    const epoch = ++generation.current;
    const controller = new AbortController();
    if (!canManage) return () => { controller.abort(); active.current = false; };
    void load(controller.signal).then(next => { if (active.current && generation.current === epoch) { setAccount(next); setRegistration({ ...blankRegistration, ...next.setup }); } })
      .catch(error => { if (!controller.signal.aborted && active.current && generation.current === epoch) setNotice(error instanceof Error ? error.message : "SMS could not be loaded."); })
      .finally(() => { if (active.current && generation.current === epoch) setLoading(false); });
    return () => { controller.abort(); active.current = false; generation.current = epoch + 1; };
  }, [load, canManage]);

  async function run(action: string, operation: (current: () => boolean) => Promise<void>) {
    if (inFlight.current) return;
    const epoch = generation.current;
    const current = () => active.current && generation.current === epoch;
    inFlight.current = true; setBusy(action); setNotice("");
    try { await operation(current); }
    catch (error) { if (current()) setNotice(error instanceof Error ? error.message : "SMS could not be updated. Refresh to check."); }
    finally { if (current()) { inFlight.current = false; setBusy(""); } }
  }

  function refresh() { void run("refresh", async current => { const next = await load(); if (current()) { setAccount(next); setLoading(false); } }); }
  function findNumbers() { void run("numbers", async current => {
    const result = await request("/api/trade-sms/numbers");
    const eligible = (result.numbers || []).filter(number => number.currency === "AUD" && /^\+614\d{8}$/.test(number.number)
      && [number.monthlyMicro, number.setupMicro, number.totalMicro].every(value => Number.isSafeInteger(value) && value >= 0));
    if (current()) { setNumbers(eligible); setSelectedNumber(eligible.length === 1 ? eligible[0].number : ""); setReviewing(false); setTermsAccepted(false); }
  }); }
  function topUp() { void run("topup", async current => {
    const submission = pendingTopUp || { amountCents, requestId: crypto.randomUUID() };
    setPendingTopUp(submission);
    let result: ApiResult;
    try { result = await request("/api/trade-sms/account", { action: "top_up", ...submission }); }
    catch (error) {
      if (current() && error instanceof SmsAccountError) {
        if (error.status === 422 || error.code === "SMS_TOPUP_ALREADY_PAID") setPendingTopUp(null);
        if (error.code === "SMS_TOPUP_ALREADY_PAID") { const next = await load(); if (current()) setAccount(next); }
      }
      throw error;
    }
    if (!current()) return;
    if (!result.checkoutUrl) throw new Error("Checkout is not confirmed. Check this top-up before starting another.");
    const url = new URL(result.checkoutUrl);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) throw new Error("The secure checkout address could not be verified.");
    window.location.assign(url.href);
  }); }
  function reviewRental(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected && !busy) { setReviewing(true); setTermsAccepted(false); setNotice(""); }
  }
  function rentNumber() { void run("rent", async current => {
    if ((!selected || !termsAccepted) && !pendingRental) return;
    const submission: PendingRental = pendingRental || { action: "rent_number", number: selected!.number, requestId: crypto.randomUUID(),
      registration: { ...registration }, acceptedMonthlyMicro: selected!.monthlyMicro, acceptedSetupMicro: selected!.setupMicro, acceptedInitialReservedMicro: initialReservationMicro, termsAccepted: true };
    setPendingRental(submission);
    let result: ApiResult;
    try { result = await request("/api/trade-sms/account", submission); }
    catch (error) {
      if (current() && error instanceof SmsAccountError && error.status === 422) {
        setPendingRental(null); setReviewing(false); setTermsAccepted(false);
        if (error.code === "SMS_NUMBER_PRICE_CHANGED") { setNumbers(null); setSelectedNumber(""); }
      }
      throw error;
    }
    if (!current()) return;
    if (!result.order) throw new Error("Number setup is not confirmed. Check this rental before selecting another number.");
    setAccount(previous => previous ? { ...previous, order: result.order || null } : previous);
    setPendingRental(null); setReviewing(false); setTermsAccepted(false); setNumbers(null); setSelectedNumber("");
    setNotice("Your rental request is recorded. We will show the number as ready once setup is confirmed.");
    const next = await load(); if (current()) setAccount(next);
  }); }
  function syncNumber() { void run("sync", async current => { await request("/api/trade-sms/account", { action: "sync" }); const next = await load(); if (current()) setAccount(next); }); }
  function cancelRental() { void run("cancel", async current => {
    const result = await request("/api/trade-sms/account", { action: "cancel_rental" });
    if (current()) { setAccount(previous => previous ? { ...previous, order: result.order || previous.order } : previous); setCancelConfirm(false); setNotice("Cancellation requested. The rental ends when the provider confirms release of your number."); }
  }); }
  function field(key: keyof Registration, label: string, options: { type?: string; maxLength?: number; pattern?: string; autoComplete?: string } = {}) {
    return <label key={key}><span>{label}</span><input name={key} required value={registration[key]} maxLength={options.maxLength || 160} {...options}
      disabled={Boolean(busy) || reviewing || Boolean(pendingRental)} onChange={event => setRegistration(previous => ({ ...previous, [key]: event.target.value }))} /></label>;
  }

  if (!canManage) return null;
  return <section className={styles.dashboard} aria-label="Business SMS dashboard">
    <header className={styles.header}><div><span className={styles.eyebrow}>TLINK SMS</span><h3>Your business. One number.</h3><p>Text customers, read their replies and keep every conversation together.</p></div><span className={styles.price}>{legacy ? "Your provider plan" : "9¢ + GST"}<span>{legacy ? "Billed directly by Twilio" : "per SMS part"}</span></span></header>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <p className={styles.notice} role="status">Loading your SMS account...</p> : !account ? <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={refresh}>Reload SMS account</button> : legacy ? <>
      <TradeLegacySmsConnectionPanel user={user} getAuthHeaders={getAuthHeaders} onDisconnected={refresh} />
      <p className={styles.hint}>Your existing number and history stay available. Disconnect it before setting up a TLink SMS number.</p>
    </> : <>
      {!ready && <p className={styles.notice}>TLink SMS setup is being completed. Number rental and sending will be available once the service is connected.</p>}
      <div className={styles.summary}>
        <div className={styles.stat}><span>Business SMS number</span><strong>{account.connection?.number || account.order?.number || "Your number starts here"}</strong><small>{connected ? "Ready for two-way conversations" : account.order ? orderLabel[account.order.status] || "Setup in progress" : "Australian numbers only"}</small></div>
        <div className={styles.stat}><span>Available SMS credit</span><strong>{money(availableMicro)}</strong><small>{account.wallet.reservedMicro > 0 ? `${money(account.wallet.reservedMicro)} reserved for processing` : "Prepaid. You control your spend."}</small></div>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || !account.billingConfigured} onClick={() => setShowTopUp(value => !value)}>Top up credit</button><button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={refresh}>{busy === "refresh" ? "Refreshing..." : "Refresh balance"}</button></div>
      </div>
      {!account.billingConfigured && <p className={styles.hint}>Secure top-ups are awaiting TLink account setup. No payment can be taken yet.</p>}
      {!account.urlsEnabled && <p className={styles.hint}>SMS links are awaiting provider approval. Prepare review requests now; use texts without links until approval is complete.</p>}
      {connected && availableMicro < account.pricing.partPriceMicro && <p className={styles.notice}>Add credit to keep sending. Incoming replies remain visible while your number is active.</p>}
      {showTopUp && <div className={styles.topUp}>
        <div><h4>Add SMS credit</h4><p>Choose an amount, then pay securely with Stripe. Credit appears after payment is confirmed.</p></div>
        <fieldset disabled={Boolean(busy) || Boolean(pendingTopUp)}><legend>Top-up amount</legend><div className={styles.amounts}>{[5000, 10000, 20000].map(amount => <label key={amount}><input type="radio" name="sms-topup" checked={amountCents === amount} onChange={() => setAmountCents(amount)} /><span>${amount / 100}</span></label>)}</div></fieldset>
        <p className={styles.hint}>Minimum top-up $50. SMS costs 9¢ + GST (9.9¢ including GST) per part. Longer messages and emoji can use more parts. Number rental is paid from this credit. No automatic card charges.</p>
        {pendingTopUp && <p className={styles.hint}>This top-up request is saved. Continue the same checkout to avoid creating another payment request.</p>}
        <div className={styles.buttonRow}><button type="button" className={styles.primary} disabled={Boolean(busy) || !account.billingConfigured} onClick={topUp}>{busy === "topup" ? "Opening checkout..." : pendingTopUp ? `Continue $${pendingTopUp.amountCents / 100} checkout` : `Continue with $${amountCents / 100}`}</button><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => setShowTopUp(false)}>Close</button></div>
      </div>}
      {!connected && !orderOutstanding && <ol className={styles.steps} aria-label="SMS setup steps"><li><span>1</span><div><strong>Choose your number</strong><small>One Australian number for your business.</small></div></li><li><span>2</span><div><strong>Add credit</strong><small>Cover your rental, then pay as you text.</small></div></li><li><span>3</span><div><strong>Start a conversation</strong><small>Your customers can reply to you.</small></div></li></ol>}
      {account.order && <div className={styles.rentalStatus}><div><h4>{orderLabel[account.order.status] || "Number setup"}</h4><p>{account.order.number} · {money(account.order.monthlyMicro)} per month including GST</p>{account.order.renewalAt && <small>Next rental renewal (AEST): {new Date(account.order.renewalAt).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane" })}</small>}
        {typeof account.order.initialChargeMicro === "number" ? <p className={styles.hint}>Confirmed initial charge: {money(account.order.initialChargeMicro)} including GST.{account.order.initialReservedMicro > account.order.initialChargeMicro ? account.order.initialChargeSettled ? ` ${money(account.order.initialReservedMicro - account.order.initialChargeMicro)} of unused reservation returned to your SMS credit.` : ` ${money(account.order.initialReservedMicro - account.order.initialChargeMicro)} of unused reservation will return to your SMS credit once number setup is confirmed.` : ""}</p>
          : account.order.initialReservedMicro > 0 && !["cancelled", "rejected"].includes(account.order.status) && <p className={styles.hint}>Initial rental reservation: up to {money(account.order.initialReservedMicro)}. Unused credit is returned once the provider confirms the initial prorated charge.</p>}
        {account.order.error && <p className={styles.notice}>{account.order.error}</p>}</div><div className={styles.buttonRow}><button type="button" className={styles.secondary} disabled={Boolean(busy) || !ready} onClick={syncNumber}>{busy === "sync" ? "Checking..." : "Check number status"}</button>{!["cancelled", "cancel_requested", "cancel_pending", "cancellation_pending", "rejected", "failed"].includes(account.order.status) && <button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => setCancelConfirm(true)}>Cancel rental</button>}</div>
        {cancelConfirm && <div className={styles.confirm}><p>Request cancellation of {account.order.number}? Sending and future rental renewals will stop according to the confirmed cancellation. Your message history stays available. Release requires confirmation from the provider.</p><div className={styles.buttonRow}><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={cancelRental}>{busy === "cancel" ? "Requesting..." : "Request cancellation"}</button><button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => setCancelConfirm(false)}>Keep number</button></div></div>}
      </div>}
      {!account.connection && !orderOutstanding && <div className={styles.onboarding}>
        <div className={styles.sectionTitle}><div><h4>Make it your number</h4><p>Choose an Australian number to send from and receive replies.</p></div><button type="button" className={styles.secondary} disabled={Boolean(busy) || !ready || Boolean(pendingRental)} onClick={findNumbers}>{busy === "numbers" ? "Finding numbers..." : numbers ? "Refresh numbers" : "Find an Australian number"}</button></div>
        {numbers && numbers.length === 0 && <p className={styles.notice}>No Australian numbers are available right now. Refresh later to check again.</p>}
        {numbers && numbers.length > 0 && <form className={styles.rentalForm} onSubmit={reviewRental}>
          <label><span>Your Australian number</span><select required value={selectedNumber} disabled={Boolean(busy) || reviewing || Boolean(pendingRental)} onChange={event => { setSelectedNumber(event.target.value); setTermsAccepted(false); }}><option value="">Choose a number</option>{numbers.map(number => <option value={number.number} key={number.number}>{number.number} · {money(number.monthlyMicro)}/month</option>)}</select></label>
          {selected && <>
            <div className={styles.costStrip}><span>Monthly rental <strong>{money(selected.monthlyMicro)}</strong></span><span>One-time setup <strong>{money(selected.setupMicro)}</strong></span><span>Maximum initial reservation <strong>{money(initialReservationMicro)}</strong></span><small>Includes GST. No TLink markup on number rental.</small></div>
            <div><h4>Register your business</h4><p className={styles.hint}>These details are used to register your number with the carrier.</p></div>
            <div className={styles.fields}>{field("businessName", "Business name", { maxLength: 100, autoComplete: "organization" })}{field("contactName", "Contact name", { maxLength: 100, autoComplete: "name" })}{field("email", "Business email", { type: "email", maxLength: 254, autoComplete: "email" })}{field("phone", "Australian contact mobile", { type: "tel", maxLength: 24, autoComplete: "tel" })}{field("address", "Street address", { maxLength: 150, autoComplete: "street-address" })}{field("suburb", "Suburb", { maxLength: 50, autoComplete: "address-level2" })}<label><span>State or territory</span><select required name="state" value={registration.state} disabled={Boolean(busy) || reviewing || Boolean(pendingRental)} onChange={event => setRegistration(previous => ({ ...previous, state: event.target.value }))}><option value="">Choose state</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map(state => <option key={state}>{state}</option>)}</select></label>{field("postcode", "Postcode", { pattern: "[0-9]{4}", maxLength: 4, autoComplete: "postal-code" })}</div>
            <label><span>How will your business use SMS?</span><input name="useCase" required minLength={20} maxLength={400} value={registration.useCase} disabled={Boolean(busy) || reviewing || Boolean(pendingRental)} onChange={event => setRegistration(previous => ({ ...previous, useCase: event.target.value }))} /></label>
            {availableMicro < initialReservationMicro && <div className={styles.notice}><p>Add {money(initialReservationMicro - availableMicro)} or more to cover the maximum initial rental reservation. Top-ups start at $50.</p><button type="button" className={styles.primary} disabled={Boolean(busy) || !account.billingConfigured} onClick={() => setShowTopUp(true)}>Add credit for this number</button></div>}
            {!reviewing && !pendingRental && <button type="submit" className={styles.primary} disabled={Boolean(busy) || availableMicro < initialReservationMicro}>Review number rental</button>}
            {(reviewing || pendingRental) && <div className={styles.confirm}><h4>Confirm your number rental</h4><p><strong>{selected.number}</strong> for {registration.businessName}. Up to {money(initialReservationMicro)} will be reserved from your SMS credit for setup and the initial rental period. Setup is {money(selected.setupMicro)} and ongoing rental is {money(selected.monthlyMicro)} per month, including GST.</p><p>The initial rental is prorated to the first day of next month (AEST). Unused reservation is returned to your SMS credit after the provider confirms the initial charge.</p><p>Rental renews monthly on the first day of each month (AEST), from your credit at {money(selected.monthlyMicro)} with no TLink markup. Keep enough credit available to retain your number and send texts. Low credit can suspend the service. Your card is never charged automatically.</p><label className={styles.check}><input type="checkbox" checked={termsAccepted} disabled={Boolean(busy) || Boolean(pendingRental)} onChange={event => setTermsAccepted(event.target.checked)} /><span>I authorise this maximum reservation and monthly rental, and confirm that the business details are correct.</span></label><div className={styles.buttonRow}><button type="button" className={styles.primary} disabled={Boolean(busy) || (!pendingRental && (!termsAccepted || availableMicro < initialReservationMicro))} onClick={rentNumber}>{busy === "rent" ? "Setting up number..." : pendingRental ? "Check this rental request" : `Confirm ${money(initialReservationMicro)} reservation`}</button>{!pendingRental && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => { setReviewing(false); setTermsAccepted(false); }}>Edit details</button>}</div>{pendingRental && <p className={styles.hint}>The result is not confirmed. Check this same request before choosing another number.</p>}</div>}
          </>}
        </form>}
      </div>}
      {onOpenAutomations && <div className={styles.automation}><div><h4>A little follow-up goes a long way</h4><p>Set appointment reminders, after-visit check-ins and review requests. You choose the timing and recipients with permission.</p></div><button type="button" className={styles.secondary} onClick={onOpenAutomations}>Set up auto texts</button></div>}
      {account.ledger.length > 0 && <details className={styles.activity}><summary>Recent credit activity</summary><ul>{account.ledger.map(entry => <li key={entry.id}><div><strong>{entry.description}</strong><small>{new Date(entry.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</small></div><span>{entry.amountMicro > 0 ? "+" : ""}{money(entry.amountMicro)}</span></li>)}</ul></details>}
    </>}
  </section>;
}
