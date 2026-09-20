"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { requestWithCreditexTokenRecovery } from "@/lib/creditex-auth-token";
import type { CreditexVoiceNumber, CreditexVoiceWorkspace } from "@/lib/creditex-voice-connection";
import styles from "./CreditexVoiceSetupPanel.module.css";

type Result = Partial<CreditexVoiceWorkspace> & { ok?: boolean; error?: string };
const empty: CreditexVoiceWorkspace = { connection: null, numbers: [], staff: [], assignments: [] };

type Props = { user: User; organisationId?: string; onChanged?: () => void };
export default function CreditexVoiceSetupPanel(props: Props) {
  return <VoiceSetup key={`${props.user.uid}:${props.organisationId || "active"}`} {...props} />;
}

function VoiceSetup({ user, organisationId, onChanged }: Props) {
  const [workspace, setWorkspace] = useState<CreditexVoiceWorkspace>(empty);
  const [numbers, setNumbers] = useState<CreditexVoiceNumber[] | null>(null);
  const [defaultNumberId, setDefaultNumberId] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [ownsAccount, setOwnsAccount] = useState(false);
  const credentials = useRef({ apiKey: "", publicKey: "" });
  const formRef = useRef<HTMLFormElement>(null);
  const currentUser = useRef<User | null>(user);

  const request = useCallback(async (action?: string, payload: Record<string, unknown> = {}): Promise<Result> => {
    const response = await requestWithCreditexTokenRecovery({ user, currentUid: () => currentUser.current?.uid,
      request: (token) => fetch(`/api/creditex/voice-connection${!action && organisationId ? `?organisationId=${encodeURIComponent(organisationId)}` : ""}`, { method: action ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(action ? { "Content-Type": "application/json" } : {}) }, cache: "no-store", ...(action ? { body: JSON.stringify({ action, organisationId, ...payload }) } : {}) }),
      isUnauthorized: (response) => response.status === 401,
    });
    const result = await response.json() as Result;
    if (!response.ok || !result.ok) throw new Error(result.error || "Calling setup could not be checked.");
    return result;
  }, [user, organisationId]);

  const applyWorkspace = useCallback((result: Result) => {
    const next = { connection: result.connection || null, numbers: result.numbers || [], staff: result.staff || [], assignments: result.assignments || [] };
    setWorkspace(next); setNumbers(null); setDefaultNumberId(next.connection?.defaultNumberId || "");
    setAssignments(Object.fromEntries(next.assignments.map((item) => [item.memberId, item.numberId])));
  }, []);

  useEffect(() => {
    let active = true;
    currentUser.current = user;
    credentials.current = { apiKey: "", publicKey: "" };
    void request().then((result) => { if (active) applyWorkspace(result); })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "Calling setup could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    const form = formRef.current;
    return () => { active = false; currentUser.current = null; credentials.current = { apiKey: "", publicKey: "" }; form?.reset(); };
  }, [request, applyWorkspace, user]);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const fields = new FormData(event.currentTarget);
    const keys = { apiKey: String(fields.get("apiKey") || "").trim(), publicKey: String(fields.get("publicKey") || "").trim() };
    setBusy("inspect"); setNotice(""); setNumbers(null);
    try {
      const result = await request("inspect", keys);
      credentials.current = keys; setNumbers(result.numbers || []);
      setDefaultNumberId(result.numbers?.length === 1 ? result.numbers[0].id : "");
      if (!result.numbers?.length) setNotice("No eligible Australian number was found. Add or port a voice number in Creditex's Telnyx account, then check again.");
    } catch (error) { credentials.current = { apiKey: "", publicKey: "" }; setNotice(error instanceof Error ? error.message : "The account could not be checked."); }
    finally { setBusy(""); }
  }

  async function refresh() {
    setBusy("refresh"); setNotice("");
    try { applyWorkspace(await request()); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The connection could not refresh."); }
    finally { setBusy(""); }
  }

  async function save(action: "connect" | "saveNumbers") {
    if (busy || !defaultNumberId) return;
    setBusy(action); setNotice("");
    try {
      const result = await request(action, { ...credentials.current, ownsAccount, defaultNumberId, assignments: Object.entries(assignments).filter(([, numberId]) => numberId).map(([memberId, numberId]) => ({ memberId, numberId })) });
      applyWorkspace(result); onChanged?.();
      setNotice(result.connection?.status === "connected" ? "Creditex calling is connected. Carrier charges go to Creditex's Telnyx account." : "Setup is saved. Check setup again to confirm it.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Setup did not return a confirmed result. Refresh the connection before trying again.");
      try { applyWorkspace(await request()); } catch { /* The status remains unconfirmed and the refresh control stays available. */ }
    } finally {
      if (action === "connect") { credentials.current = { apiKey: "", publicKey: "" }; formRef.current?.reset(); setOwnsAccount(false); setNumbers(null); }
      setBusy("");
    }
  }

  async function refreshNumbers() {
    setBusy("numbers"); setNotice("");
    try { const result = await request("refreshNumbers"); setNumbers(result.numbers || []); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Numbers could not refresh."); }
    finally { setBusy(""); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Creditex calling? Saved audit recordings remain private in Creditex. Telnyx numbers, resources and carrier charges remain in Creditex's Telnyx account.")) return;
    setBusy("disconnect"); setNotice("");
    try { applyWorkspace(await request("disconnect")); onChanged?.(); setNotice("Calling disconnected. Saved audit recordings are retained. Manage ongoing number charges in Telnyx."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Calling could not be disconnected."); }
    finally { setBusy(""); }
  }

  const available = numbers || workspace.numbers;
  const connected = workspace.connection?.status === "connected";
  return <details className={styles.panel}>
    <summary>Calling setup <span>{loading ? "Loading" : connected ? "Connected" : workspace.connection ? "Setup pending" : "Administrator setup"}</span></summary>
    <div className={styles.content}>
      <p>Creditex uses its own Telnyx account for browser calls. Creditex pays Telnyx for numbers, calls and recording. TLink has no software or staff fee.</p>
      <p><a href="https://portal.telnyx.com/" target="_blank" rel="noreferrer">Open Creditex&apos;s Telnyx account</a> to fund the account and acquire or port Australian voice numbers. Multiple staff can share the default number or use assigned numbers. Existing numbers remain with their current provider until a supported port completes.</p>
      <p className={styles.muted}>Trial accounts and unverified accounts may have calling restrictions. Finish Telnyx&apos;s account, identity and number verification in its portal. TLink does not buy numbers or upgrade plans.</p>
      {workspace.connection ? <>
        <p><strong>{workspace.connection.accountLabel}</strong>{connected ? ` · ${workspace.connection.defaultNumber || "Check default number"}` : " · Setup is not yet confirmed"}</p>
        {!connected && <p role="status">No calls can start until setup is confirmed. Check setup again to reconcile any pending Telnyx resource.</p>}
      </> : !loading && <form ref={formRef} onSubmit={(event) => void inspect(event)} className={styles.form}>
        <label>Telnyx API key<input name="apiKey" type="password" autoComplete="off" required maxLength={512} onChange={() => { credentials.current = { apiKey: "", publicKey: "" }; setNumbers(null); }} /></label>
        <label>Account Ed25519 public key<input name="publicKey" autoComplete="off" required maxLength={100} onChange={() => { credentials.current = { apiKey: "", publicKey: "" }; setNumbers(null); }} /></label>
        <p className={styles.muted}>Copy these from <a href="https://portal.telnyx.com/#/app/api-keys" target="_blank" rel="noreferrer">API Keys in Telnyx</a>. The API key is encrypted on the server and never saved in this browser. The public key verifies Telnyx callbacks.</p>
        <button disabled={Boolean(busy)} type="submit">{busy === "inspect" ? "Checking account…" : "Check account and numbers"}</button>
      </form>}
      {((workspace.connection || numbers) && available.length > 0) && <div className={styles.form}>
        <label>Default caller number<select value={defaultNumberId} onChange={(event) => setDefaultNumberId(event.target.value)} disabled={Boolean(busy)}><option value="">Choose a number</option>{available.map((number) => <option key={number.id} value={number.id}>{number.number}{number.label !== number.number ? ` · ${number.label}` : ""}</option>)}</select></label>
        <details className={styles.assignments}><summary>Optional staff numbers</summary>{workspace.staff.map((member) => <label key={member.id}>{member.displayName || member.role}<select value={assignments[member.id] || ""} disabled={Boolean(busy)} onChange={(event) => setAssignments((current) => ({ ...current, [member.id]: event.target.value }))}><option value="">Use default number</option>{available.map((number) => <option key={number.id} value={number.id}>{number.number}</option>)}</select></label>)}</details>
      </div>}
      {!workspace.connection && numbers && <label className={styles.check}><input type="checkbox" checked={ownsAccount} onChange={(event) => setOwnsAccount(event.target.checked)} />I am authorised to connect Creditex&apos;s own Telnyx account. Creditex owns this account and accepts its Telnyx charges. I authorise dedicated calling resources to be created in this account.</label>}
      <div className={styles.actions}>
        {workspace.connection ? <>
          <button disabled={Boolean(busy) || !defaultNumberId} onClick={() => void save(connected ? "saveNumbers" : "connect")}>{busy === "connect" || busy === "saveNumbers" ? "Saving…" : connected ? "Save number assignments" : "Check setup again"}</button>
          <button disabled={Boolean(busy)} onClick={() => void refreshNumbers()}>Refresh owned numbers</button>
          <button disabled={Boolean(busy)} onClick={() => void disconnect()}>Disconnect</button>
        </> : numbers && <button disabled={Boolean(busy) || !ownsAccount || !defaultNumberId} onClick={() => void save("connect")}>{busy === "connect" ? "Connecting…" : "Connect Creditex calling"}</button>}
        <button disabled={Boolean(busy)} onClick={() => void refresh()}>Refresh connection</button>
      </div>
      {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
    </div>
  </details>;
}
