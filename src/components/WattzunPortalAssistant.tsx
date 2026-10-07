"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { createTradeBusinessFetch, readTradeBusinessSelection, TRADE_BUSINESS_SELECTION_CHANGED_EVENT } from "@/lib/trade-business-client";
import { notifyTradeQuoteDraftSaved } from "@/lib/trade-quote-client";
import { wattzunPortalForPath } from "@/lib/wattzun-portal-path";
import { parseWattzunRecordLookup } from "@/lib/wattzun-records";
import { parseWattzunActionProposal, type WattzunActionReceipt } from "@/lib/wattzun-actions";
import { isWattzunWorkflowProposal, isWattzunWorkflowResult, type WattzunWorkflowOperation, type WattzunWorkflowResult } from "@/lib/wattzun-workflow";
import { wattzunWorkflowReply } from "@/lib/wattzun-workflow-reply";
import { isWattzunNavigationAction, wattzunNavigationDestination } from "@/lib/wattzun-navigation";
import { dispatchWattzunFormSaved, prepareWattzunFormCapture, captureWattzunFormPhoto, readWattzunFormCaptureSaved, readWattzunFormRefreshed, WATTZUN_FORM_REFRESHED_EVENT, WATTZUN_FORM_CAPTURE_SAVED_EVENT, type WattzunFormCaptureTarget } from "@/lib/wattzun-form-client";
import { focusWattzunFormQuestion, WATTZUN_FORM_NATIVE_SAVED_EVENT } from "@/lib/wattzun-form-client";
import { readWattzunFormGuideProgress, readWattzunFormGuideControl, type WattzunFormGuideInput, type WattzunFormGuideControl, type WattzunFormGuideProgress } from "@/lib/wattzun-form-guide";
import { readWattzunFormProductSearchAction } from "@/lib/wattzun-form-step";
import {
  WATTZUN_REALTIME_VOICE_STREAM_TYPE, wattzunSpokenReply,
  type WattzunPortal, type WattzunReply, type WattzunScope, type WattzunTurn, type WattzunTurnInput, type WattzunVoiceResult,
} from "@/lib/wattzun-portal";
import { readWattzunWorkReference, readWattzunWorkContextInfo, wattzunWorkLabel, type WattzunWorkReference, type WattzunWorkContextInfo } from "@/lib/wattzun-work-context";
import { WATTZUN_OPEN_EVENT, WATTZUN_READY_EVENT, WATTZUN_USAGE_CHANGED_EVENT, readWattzunOpenRequest, useWattzunPresentation, type WattzunOpenRequest } from "@/lib/wattzun-appearance";
import { createWattzunBrowserVoiceEnvironment, WattzunVoiceCall, WattzunVoiceCallError, type WattzunCallStatus } from "@/lib/wattzun-voice-client";
import { readWattzunVoiceStream } from "@/lib/wattzun-voice-stream";
import { wattzunConversationHistory } from "@/lib/wattzun-conversation";
import { wattzunNativeSpokenReply } from "@/lib/wattzun-voice-narration";
import { EnergyAssistantLauncher } from "./EnergyAssistantLauncher";
import { WattzunMascot } from "./WattzunMascot";
import { WattzunRecordPicker } from "./WattzunRecordPicker";
import { WattzunActionReview } from "./WattzunActionReview";
import { WattzunWorkflowReview } from "./WattzunWorkflowReview";
import styles from "./WattzunPortalAssistant.module.css";

type Message = WattzunTurn & { id: string; reply?: WattzunReply; reviewDraft?: WattzunReply["action"]; requestSummary?: string; memoryOnly?: boolean; awaitingSpeech?: boolean };
type PendingWorkflow = { messageId: string; proposal: WattzunWorkflowOperation; result: WattzunWorkflowResult; reviewId?: string; executionRequestId?: string };
type FormGuideSession = { input: WattzunFormGuideInput; progress: WattzunFormGuideProgress | null; editorReference: Extract<WattzunWorkReference, { kind: "trade_form" }> };
const portalNames: Record<WattzunPortal, string> = { trade: "TLink", council: "Council", creditex: "Creditex" };
const callLabels: Record<WattzunCallStatus["state"], string> = {
  idle: "Ready to call", permission: "Microphone permission", connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Wattzun is speaking", muted: "Microphone muted", recovering: "Still connected", ended: "Call ended", error: "Call could not continue",
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isReply(value: unknown, portal?: WattzunPortal): value is WattzunReply {
  if (record(value) && value.workContext !== undefined && (!portal || !readWattzunWorkContextInfo(value.workContext, portal))) return false;
  if (record(value) && value.formGuide !== undefined && (portal !== "trade" || !readWattzunFormGuideProgress(value.formGuide))) return false;
  if (record(value) && value.formGuideRecovery !== undefined && (portal !== "trade" || !record(value.formGuideRecovery)
    || typeof value.formGuideRecovery.requestId !== "string" || !/^[A-Za-z0-9:_-]{16,180}$/.test(value.formGuideRecovery.requestId)
    || !["saved", "not_saved", "uncertain"].includes(String(value.formGuideRecovery.state)))) return false;
  if (record(value) && value.action !== undefined && value.action !== null) {
    if (portal && isWattzunNavigationAction(value.action, portal)) { /* Current portal destinations only. */ }
    else if (isWattzunWorkflowProposal(value.action)) { if (portal !== "trade") return false; }
    else if (readWattzunFormGuideControl(value.action)) { if (portal !== "trade" || !value.formGuide) return false; }
    else if (readWattzunFormProductSearchAction(value.action)) { if (portal !== "trade" || !value.formGuide) return false; }
    else { try { parseWattzunActionProposal(value.action); } catch { return false; } }
  }
  if (record(value) && value.workflow !== undefined && (portal !== "trade" || !isWattzunWorkflowResult(value.workflow))) return false;
  if (record(value) && value.lookup !== undefined && value.lookup !== null) {
    try { parseWattzunRecordLookup(value.lookup); } catch { return false; }
  }
  return record(value) && (value.kind === "answer" || value.kind === "clarification") && typeof value.message === "string"
    && Array.isArray(value.questions) && value.questions.every(question => typeof question === "string")
    && Array.isArray(value.links) && value.links.every(link => record(link) && typeof link.label === "string" && typeof link.href === "string" && /^\/(?!\/)/.test(link.href));
}
function workspaceHref(href: string, scope: WattzunScope, actorUid: string, pathname: string): string {
  if (scope.portal !== "trade" || !/^\/direct-trade\/(dashboard|team)(?=[?#]|$)/.test(href)) return href;
  const workspacePath = /^\/direct-trade\/(dashboard|team)\/?$/.test(pathname) ? pathname.replace(/\/$/, "") : actorUid === scope.scopeId ? "/direct-trade/dashboard" : "/direct-trade/team";
  return href.replace(/^\/direct-trade\/(dashboard|team)/, workspacePath);
}
async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !record(payload) || payload.ok !== true) {
    throw new Error(record(payload) && typeof payload.error === "string" ? payload.error : "Wattzun could not complete that request. Try again.");
  }
  return payload;
}
function sameWorkReference(first: WattzunWorkReference | null, second: WattzunWorkReference | null) {
  return JSON.stringify(first) === JSON.stringify(second);
}
function replyWorkContext(reply: WattzunReply, portal: WattzunPortal, reference: WattzunWorkReference | null): WattzunWorkContextInfo | null {
  if (!reference) {
    if (reply.workContext !== undefined) throw new Error("Wattzun returned information for an unselected work item. Select the work and ask again.");
    return null;
  }
  const info = readWattzunWorkContextInfo(reply.workContext, portal);
  const guide = readWattzunFormGuideProgress(reply.formGuide);
  const expected = guide && sameWorkReference(guide.requestedReference, reference) ? guide.reference : reference;
  if (!info || !sameWorkReference(info.reference, expected)) throw new Error("Wattzun returned information for different work. Ask again about your selected work.");
  return info;
}
class VoiceTurnFailure extends Error {
  constructor(message: string, readonly recoveredRequest?: { requestId: string; requestSummary: string; transcript?: string }) { super(message); }
}
async function readCallResponse(response: Response, signal: AbortSignal, portal?: WattzunPortal) {
  if (response.status === 401 || response.status === 403) {
    const payload: unknown = await response.json().catch(() => null);
    const message = record(payload) && typeof payload.error === "string" ? payload.error
      : response.status === 401 ? "Sign in again to call Wattzun." : "Your workspace access has changed. Reopen your workspace before calling.";
    throw new WattzunVoiceCallError(message, response.status === 401 ? "authentication" : "access");
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const recovery = record(payload) && record(payload.voiceTurnRecovery) ? payload.voiceTurnRecovery : null;
    const transcript = recovery?.transcript;
    const validTranscript = typeof transcript === "string" && transcript.trim() && transcript.length <= 4000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(transcript);
    const recoveredRequest = recovery && Object.keys(recovery).every(key => ["requestId", "requestSummary", "transcript"].includes(key))
      && (transcript === undefined || validTranscript) && typeof recovery.requestId === "string"
      && /^[A-Za-z0-9_-]{16,100}$/.test(recovery.requestId) && typeof recovery.requestSummary === "string"
      && (recovery.requestSummary.trim() || validTranscript) && recovery.requestSummary.length <= 1800 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(recovery.requestSummary)
      ? { requestId: recovery.requestId, requestSummary: recovery.requestSummary, ...(validTranscript ? { transcript } : {}) } : undefined;
    throw new VoiceTurnFailure(record(payload) && typeof payload.error === "string" ? payload.error : "Wattzun could not complete that request.", recoveredRequest);
  }
  return readWattzunVoiceStream(response, signal, value => isReply(value, portal));
}
export function WattzunPortalAssistant({ portal }: { portal: WattzunPortal }) {
  const [user, setUser] = useState<User | null>(null);
  const currentActor = useRef<User | null>(null);
  const selectedBusiness = useRef<string | null>(null);
  const [scopes, setScopes] = useState<WattzunScope[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [open, setOpen] = useState(false);
  const [openRequest, setOpenRequest] = useState<(WattzunOpenRequest & { id: string }) | null>(null);
  const scope = scopes.find(candidate => candidate.scopeId === scopeId);
  const appearance = useWattzunPresentation(user && scope ? { userUid: user.uid, portal, scopeId: scope.scopeId } : null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => { setOpen(false); setOpenRequest(null); }, []);
  const expand = useCallback(() => { setOpenRequest(null); setOpen(true); }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, authenticated => {
    currentActor.current = authenticated?.emailVerified ? authenticated : null;
    selectedBusiness.current = null;
    setUser(currentActor.current);
    setScopes([]); setScopeId(""); setOpen(false); setOpenRequest(null);
  }), []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await user.getIdToken();
        if (controller.signal.aborted) return;
        const payload = await responsePayload(await fetch(`/api/wattzun/portal?portal=${portal}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }));
        if (controller.signal.aborted || currentActor.current?.uid !== user.uid || !Array.isArray(payload.scopes)) return;
        const authorizedScopes = payload.scopes.filter((scope): scope is WattzunScope => record(scope) && scope.portal === portal && typeof scope.scopeId === "string" && typeof scope.label === "string"
          && (scope.personalName === undefined || typeof scope.personalName === "string"));
        setScopes(authorizedScopes);
        const saved = portal === "trade" ? selectedBusiness.current ?? readTradeBusinessSelection(user.uid) : "";
        setScopeId(authorizedScopes.find(scope => scope.scopeId === saved)?.scopeId || (selectedBusiness.current === null && authorizedScopes.length === 1 ? authorizedScopes[0].scopeId : ""));
      } catch { if (!controller.signal.aborted) setScopes([]); }
    })();
    return () => controller.abort();
  }, [user, portal]);

  useEffect(() => {
    if (!user || !scopes.length) return;
    const openAssistant = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const request = readWattzunOpenRequest(event.detail);
      if (!request || currentActor.current?.uid !== user.uid || request.userUid !== user.uid || request.portal !== portal || (request.scopeId && !scopes.some(candidate => candidate.scopeId === request.scopeId))) return;
      if (request.scopeId) setScopeId(request.scopeId);
      setOpenRequest({ ...request, id: crypto.randomUUID() }); setOpen(true);
      if (typeof event.detail.acknowledge === "function") event.detail.acknowledge();
    };
    window.addEventListener(WATTZUN_OPEN_EVENT, openAssistant);
    window.dispatchEvent(new CustomEvent(WATTZUN_READY_EVENT, { detail: { portal } }));
    return () => window.removeEventListener(WATTZUN_OPEN_EVENT, openAssistant);
  }, [user, scopes, portal]);

  useEffect(() => {
    if (!user || portal !== "trade") return;
    const changeBusiness = (event: Event) => {
      if (!(event instanceof CustomEvent) || !record(event.detail) || event.detail.uid !== currentActor.current?.uid || event.detail.uid !== user.uid || typeof event.detail.ownerUid !== "string") return;
      selectedBusiness.current = event.detail.ownerUid;
      const nextScopeId = scopes.find(candidate => candidate.scopeId === event.detail.ownerUid)?.scopeId || "";
      if (nextScopeId === scopeId) return;
      setScopeId(nextScopeId); setOpen(false); setOpenRequest(null);
    };
    window.addEventListener(TRADE_BUSINESS_SELECTION_CHANGED_EVENT, changeBusiness);
    return () => window.removeEventListener(TRADE_BUSINESS_SELECTION_CHANGED_EVENT, changeBusiness);
  }, [user, portal, scopes, scopeId]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, a[href]") || []).filter(control => control.getClientRects().length > 0);
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open, dismiss]);

  if (!user || !scopes.length) return null;
  return <>
    <EnergyAssistantLauncher hat={appearance.hat} onPreload={() => {}} onOpen={expand} />
    <div className={open ? styles.backdrop : undefined} onClick={event => { if (open && event.target === event.currentTarget) dismiss(); }}>
      <div className={open ? styles.dialog : styles.docked} role={open ? "dialog" : undefined} aria-modal={open ? "true" : undefined} aria-labelledby={open ? "wattzun-portal-title" : undefined} ref={dialog}>
        <header className={styles.header} hidden={!open}>
          <WattzunMascot hat={appearance.hat} />
          <div><h2 id="wattzun-portal-title">Wattzun</h2><p>Your {portalNames[portal]} assistant</p></div>
          <button className={styles.close} type="button" aria-label="Minimise Wattzun" title="Minimise and keep working" ref={closeButton} onClick={dismiss}>−</button>
        </header>
        {scopes.length > 1 && <label className={styles.workspace} hidden={!open}>Workspace<select aria-label="Workspace" value={scopeId} onChange={event => { setScopeId(event.target.value); if (scope) setOpenRequest(null); }}><option value="">Choose a workspace</option>{scopes.map(choice => <option key={choice.scopeId} value={choice.scopeId}>{choice.label}</option>)}</select></label>}
        {scope ? <WattzunConversation key={`${user.uid}:${portal}:${scope.scopeId}`} user={user} scope={scope} openRequest={openRequest} expanded={open} onExpand={expand} onMinimise={dismiss} /> : <p className={styles.empty} hidden={!open}>Choose the workspace you want Wattzun to help with.</p>}
      </div>
    </div>
  </>;
}

function WattzunConversation({ user, scope, openRequest, expanded = true, onExpand, onMinimise }: { user: User; scope: WattzunScope; openRequest?: (WattzunOpenRequest & { id: string }) | null; expanded?: boolean; onExpand?: () => void; onMinimise?: () => void }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef(messages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const presentation = useWattzunPresentation({ userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId });
  const preferencesRef = useRef({ speed: presentation.speed });
  const [callStatus, setCallStatus] = useState<WattzunCallStatus>({ state: "idle", message: "" });
  const [muted, setMuted] = useState(false);
  const [workReference, setWorkReference] = useState<WattzunWorkReference | null>(null);
  const [workContext, setWorkContext] = useState<WattzunWorkContextInfo | null>(null);
  const [selectionNotice, setSelectionNotice] = useState("");
  const workReferenceRef = useRef<WattzunWorkReference | null>(null);
  const pendingWorkflowRef = useRef<PendingWorkflow | null>(null);
  const guideSession = useRef<FormGuideSession | null>(null);
  const [formGuide, setFormGuide] = useState<WattzunFormGuideProgress | null>(null);
  const [captureTarget, setCaptureTargetState] = useState<WattzunFormCaptureTarget | null>(null);
  const preparedCapture = useRef<WattzunFormCaptureTarget | null>(null);
  const setCaptureTarget = useCallback((target: WattzunFormCaptureTarget | null) => { preparedCapture.current = target; setCaptureTargetState(target); }, []);
  const [captureNotice, setCaptureNotice] = useState("");
  const [editorRevision, setEditorRevision] = useState("");
  const guideRequest = useRef<((control?: WattzunFormGuideControl) => Promise<boolean>) | null>(null);
  const [guideQueued, setGuideQueued] = useState(false);
  const contextGeneration = useRef(0);
  const voiceContextRequest = useRef<AbortController | null>(null);
  const voiceCall = useRef<WattzunVoiceCall | null>(null);
  const textRequest = useRef<AbortController | null>(null);
  const active = useRef(true);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const handledRequest = useRef("");
  const callActive = !["idle", "ended", "error"].includes(callStatus.state);

  useEffect(() => { messagesRef.current = messages; scrollEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages]);
  useEffect(() => { preferencesRef.current = { speed: presentation.speed }; }, [presentation.speed]);
  useEffect(() => {
    active.current = true;
    const leave = () => voiceCall.current?.dispose();
    window.addEventListener("pagehide", leave);
    return () => {
      active.current = false;
      pendingWorkflowRef.current = null;
      guideSession.current = null; guideRequest.current = null;
      textRequest.current?.abort();
      voiceContextRequest.current?.abort();
      voiceCall.current?.dispose();
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  const append = useCallback((turns: Message[]) => {
    messagesRef.current = [...messagesRef.current, ...turns];
    setMessages(messagesRef.current);
  }, []);
  const selectWork = useCallback((value: WattzunWorkReference | null) => {
    const next = value ? readWattzunWorkReference(value, scope.portal) : null;
    if (value && !next) { setError("Choose a work item from your current workspace."); return; }
    if (sameWorkReference(workReferenceRef.current, next)) return;
    contextGeneration.current++;
    pendingWorkflowRef.current = null;
    guideSession.current = null; setFormGuide(null); setCaptureTarget(null); setCaptureNotice(""); setGuideQueued(false);
    workReferenceRef.current = next;
    textRequest.current?.abort(); textRequest.current = null;
    voiceContextRequest.current?.abort(); voiceContextRequest.current = null;
    voiceCall.current?.interrupt();
    messagesRef.current = [];
    setMessages([]); setBusy(false); setError(""); setWorkReference(next); setWorkContext(null);
    setSelectionNotice("Previous conversation cleared for the new work selection.");
  }, [scope.portal, setCaptureTarget]);
  const navigate = useCallback((href: string) => {
    const destination = workspaceHref(href, scope, user.uid, pathname);
    if (!/^\/(?!\/)/.test(destination)) return;
    const target = new URL(destination, window.location.origin);
    if (target.origin !== window.location.origin || wattzunPortalForPath(target.pathname) !== scope.portal) return;
    if (target.pathname === window.location.pathname) {
      window.history.pushState(window.history.state, "", `${target.pathname}${target.search}${target.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else router.push(destination, { scroll: false });
    onMinimise?.();
  }, [scope, user.uid, pathname, router, onMinimise]);
  const dismissAction = useCallback((messageId: string) => {
    if (!active.current || !messagesRef.current.some(message => message.id === messageId)) return;
    messagesRef.current = messagesRef.current.map(message => message.id === messageId && message.reply ? { ...message, reply: { ...message.reply, action: null } } : message);
    setMessages(messagesRef.current);
    if (pendingWorkflowRef.current?.messageId === messageId) pendingWorkflowRef.current = null;
  }, []);
  const actionCreated = useCallback((messageId: string, receipt: WattzunActionReceipt) => {
    if (!active.current || !messagesRef.current.some(message => message.id === messageId)) return;
    dismissAction(messageId);
    const message = receipt.kind === "quote_draft" ? "Your quote draft has been saved in TLink. Open it to review the details." : "The customer has been created in TLink. Open the saved record to review the details.";
    append([{ id: crypto.randomUUID(), role: "assistant", content: message, reply: { kind: "answer", message, questions: [], links: [{ label: receipt.label, href: receipt.href }] } }]);
  }, [append, dismissAction]);
  const workflowResult = useCallback((messageId: string, result: WattzunWorkflowResult) => {
    const pending = pendingWorkflowRef.current;
    if (!active.current || !pending || pending.messageId !== messageId) return;
    const workOrderId = pending.result.state === "review" ? pending.result.target?.jobId : null;
    const firstCompletion = pending.result.state !== "complete";
    pending.result = result;
    if (result.state === "review") pending.reviewId = result.reviewId;
    if (result.state === "review" && result.target && "jobId" in pending.proposal) pending.proposal = { ...pending.proposal, jobId: result.target.jobId };
    messagesRef.current = messagesRef.current.map(message => message.id === messageId && message.reply
      ? { ...message, reply: { ...message.reply, workflow: result }, ...(result.state === "complete" ? { reviewDraft: null } : {}) } : message);
    setMessages(messagesRef.current);
    if (scope.portal === "trade" && firstCompletion && workOrderId && result.state === "complete"
      && result.receipt.kind === "draft_job_quote" && result.receipt.status === "saved") {
      notifyTradeQuoteDraftSaved({ actorUid: user.uid, ownerUid: scope.scopeId, workOrderId });
    }
    if (scope.portal === "trade" && firstCompletion && pending.proposal.kind === "fill_form"
      && result.state === "complete" && result.receipt.kind === "fill_form" && result.receipt.status === "saved") {
      dispatchWattzunFormSaved({ portal: "trade", scopeId: scope.scopeId, formKind: pending.proposal.formKind,
        formId: pending.proposal.formId, jobId: pending.proposal.jobId });
    }
  }, [scope.portal, scope.scopeId, user.uid]);
  const workflowReviewResult = useCallback((messageId: string, result: WattzunWorkflowResult) => {
    const previous = pendingWorkflowRef.current;
    const completed = previous?.messageId === messageId && previous.result.state !== "complete" && result.state === "complete";
    workflowResult(messageId, result);
    if (completed && result.state === "complete") {
      const reply = wattzunWorkflowReply({ kind: "answer", message: "", questions: [], links: [] }, result);
      append([{ id: crypto.randomUUID(), role: "assistant", content: reply.message, reply }]);
    }
  }, [append, workflowResult]);
  const rememberWorkflow = useCallback((messageId: string, reply: WattzunReply, requestedReviewId?: string) => {
    if (reply.formGuide) return;
    const current = pendingWorkflowRef.current;
    if (current && requestedReviewId && requestedReviewId === current.reviewId && reply.workflow?.state === "complete"
      && reply.workflow.receipt.kind === current.proposal.kind) {
      workflowResult(current.messageId, reply.workflow);
      return;
    }
    const proposal = reply.action;
    if (!isWattzunWorkflowProposal(proposal) || proposal.kind === "confirm_workflow" || !reply.workflow) return;
    const prior = pendingWorkflowRef.current;
    if (prior && prior.messageId !== messageId) dismissAction(prior.messageId);
    pendingWorkflowRef.current = { messageId, proposal, result: reply.workflow,
      ...(reply.workflow.state === "review" ? { reviewId: reply.workflow.reviewId } : {}) };
  }, [dismissAction, workflowResult]);
  const requestInput = useCallback((message: string): WattzunTurnInput => {
    const pending = pendingWorkflowRef.current;
    const guide = guideSession.current;
    return { portal: scope.portal, scopeId: scope.scopeId, requestId: crypto.randomUUID(), message,
      history: wattzunConversationHistory(messagesRef.current), preferences: { ...preferencesRef.current },
      ...(workReferenceRef.current ? { workReference: { ...workReferenceRef.current } } : {}),
      ...(guide ? { formGuide: { ...guide.input } } : pending?.result.state === "review" ? { workflowReviewId: pending.result.reviewId }
        : pending && pending.result.state !== "complete" ? { workflowProposal: pending.proposal } : {}),
    };
  }, [scope]);
  const acceptFormGuide = useCallback((reply: WattzunReply, input: WattzunTurnInput) => {
    if (!input.formGuide) {
      if (reply.formGuide) throw new Error("Start guided completion from your selected form first.");
      return;
    }
    const current = guideSession.current;
    const progress = readWattzunFormGuideProgress(reply.formGuide);
    if (!current || !progress || progress.sessionId !== input.formGuide.sessionId || current.input.sessionId !== progress.sessionId
      || !sameWorkReference(progress.requestedReference, input.workReference ?? null)) throw new Error("The guided form changed. Resume your selected form.");
    const recovery = reply.formGuideRecovery;
    const pending = current.input.pendingRequestId;
    const unresolved = pending && (!recovery || recovery.requestId !== pending || recovery.state === "uncertain") ? pending : undefined;
    current.progress = progress;
    current.input = { sessionId: progress.sessionId, stage: progress.state === "paused" ? "resume" : "continue", authorization: "ordinary_form_answers", sourceSha256: progress.sourceSha256,
      ...(progress.state === "paused" ? { paused: true } : {}),
      ...(progress.productSearch ? { productSearch: progress.productSearch } : {}),
      questionKey: progress.next?.fieldKey || "", skippedFieldKeys: progress.skippedFieldKeys, ...(unresolved ? { pendingRequestId: unresolved } : {}) };
    workReferenceRef.current = progress.reference;
    setWorkReference(progress.reference); setFormGuide(progress); setSelectionNotice("");
    const receipt = reply.workflow?.state === "complete" ? reply.workflow.receipt : progress.receipt;
    if (receipt && receipt.id === progress.recordId && (receipt.kind === "fill_form" && receipt.status === "saved" || receipt.kind === "complete_form" && receipt.status === "submitted"
      || receipt.kind === "form_step" && (receipt.status === "saved" || receipt.status === "submitted"))) {
      // A remounted editor knows the revision selected for this request. Keep
      // the original cue too while an earlier editor refresh is still pending.
      const editorIds = new Set([current.editorReference.recordId]);
      if (input.workReference?.kind === "trade_form") editorIds.add(input.workReference.recordId);
      for (const formId of editorIds) dispatchWattzunFormSaved({ portal: "trade", scopeId: scope.scopeId, formKind: progress.reference.formKind,
        formId, jobId: progress.reference.jobId });
    }
    if (progress.state === "complete") guideSession.current = null;
  }, [scope.scopeId]);
  const executeWorkflow = useCallback(async (reply: WattzunReply, signal: AbortSignal, generation: number) => {
    const pending = pendingWorkflowRef.current;
    const confirmation = reply.action;
    if (!pending || !confirmation || confirmation.kind !== "confirm_workflow" || pending.result.state !== "review"
      || pending.result.reviewId !== confirmation.reviewId || generation !== contextGeneration.current) throw new Error("Review the current task before confirming.");
    pending.executionRequestId ||= crypto.randomUUID();
    const token = await user.getIdToken();
    if (!active.current || signal.aborted || pendingWorkflowRef.current !== pending || generation !== contextGeneration.current) throw new Error("The current task changed. Ask again.");
    const scopedFetch = createTradeBusinessFetch(scope.scopeId, window.location.origin, fetch);
    const payload = await responsePayload(await scopedFetch("/api/wattzun/workflows", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ stage: "execute", portal: "trade", scopeId: scope.scopeId, requestId: pending.executionRequestId, reviewId: confirmation.reviewId, reviewed: true }),
    }));
    if (!active.current || signal.aborted || pendingWorkflowRef.current !== pending || generation !== contextGeneration.current) throw new Error("The current task changed. Ask again.");
    if (!isWattzunWorkflowResult(payload.result) || payload.result.state !== "complete" || payload.result.receipt.kind !== pending.proposal.kind) throw new Error("The task result is not confirmed. Retry the same review to recover its status.");
    workflowResult(pending.messageId, payload.result);
    return { reply: wattzunWorkflowReply(reply, payload.result), reviewId: confirmation.reviewId };
  }, [user, scope.scopeId, workflowResult]);
  async function sendText() {
    const message = draft.trim();
    if (!message || busy || textRequest.current || callActive) return;
    const controller = new AbortController();
    const generation = contextGeneration.current;
    textRequest.current = controller;
    setBusy(true); setError("");
    try {
      const input = requestInput(message);
      // Typed chat keeps its existing reviewed workflow. Keep any uncertain voice save for call recovery.
      delete input.formGuide;
      const token = await user.getIdToken();
      if (!active.current || controller.signal.aborted) return;
      const payload = await responsePayload(await fetch("/api/wattzun/portal", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.signal,
      }));
      if (!active.current || controller.signal.aborted || generation !== contextGeneration.current) return;
      if (!isReply(payload.reply, scope.portal)) throw new Error("Wattzun returned an unreadable answer. Try again.");
      const info = replyWorkContext(payload.reply, scope.portal, input.workReference ?? null);
      let reply = { ...payload.reply, ...(info ? { workContext: info } : {}) };
      if (reply.action?.kind === "confirm_workflow") reply = (await executeWorkflow(reply, controller.signal, generation)).reply;
      if (info) setWorkContext(info);
      rememberWorkflow(`${input.requestId}:reply`, reply, input.workflowReviewId);
      append([{ id: input.requestId, role: "user", content: message }, { id: `${input.requestId}:reply`, role: "assistant", content: wattzunSpokenReply(reply), reply, ...(reply.action ? { reviewDraft: reply.action } : {}) }]);
      window.dispatchEvent(new CustomEvent(WATTZUN_USAGE_CHANGED_EVENT, { detail: { userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId } }));
      setDraft("");
      if (reply.action?.kind === "open_workspace") {
        const destination = wattzunNavigationDestination(reply.action, scope.portal);
        if (destination) navigate(destination.href);
      }
    } catch (requestError) {
      if (active.current && !controller.signal.aborted && generation === contextGeneration.current) setError(requestError instanceof Error ? requestError.message : "That question could not be sent. Try again.");
    } finally { if (textRequest.current === controller) { textRequest.current = null; if (active.current) setBusy(false); } }
  }
  const startCall = useCallback(() => {
    if (busy || callActive) return;
    voiceCall.current?.dispose();
    setMuted(false); setError("");
    const replyGenerations = new WeakMap<WattzunVoiceResult, { generation: number; input: WattzunTurnInput }>();
    const spokenMessages = new WeakMap<WattzunVoiceResult["audio"], { id: string; generation: number; content: string }>();
    const guidedReply = async (signal: AbortSignal, control?: WattzunFormGuideControl) => {
      const generation = contextGeneration.current;
      const input = requestInput("Continue guided form completion.");
      if (!input.formGuide) throw new Error("Select a form to complete by voice.");
      if (input.formGuide.stage !== "start") input.formGuide = { ...input.formGuide, stage: "resume" };
      if (control) input.formGuideControl = control;
      const controller = new AbortController();
      voiceContextRequest.current?.abort(); voiceContextRequest.current = controller;
      const combined = AbortSignal.any([signal, controller.signal]);
      const token = await user.getIdToken();
      if (combined.aborted || generation !== contextGeneration.current) throw new Error("The selected form changed.");
      const result = await readCallResponse(await fetch("/api/wattzun/form-guide", { method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: WATTZUN_REALTIME_VOICE_STREAM_TYPE },
        body: JSON.stringify(input), signal: combined }), combined, scope.portal);
      try {
        if (combined.aborted || generation !== contextGeneration.current) throw new Error("The selected form changed.");
        replyWorkContext(result.reply, scope.portal, input.workReference ?? null);
      } catch (failure) {
        if (result.audio.mimeType === "audio/pcm") await result.audio.stream.cancel().catch(() => {});
        throw failure;
      }
      replyGenerations.set(result, { generation, input });
      return result;
    };
    const consumeReply = (result: WattzunVoiceResult) => {
      const request = replyGenerations.get(result);
      if (!active.current || voiceCall.current !== call || request?.generation !== contextGeneration.current) {
        if (result.audio.mimeType === "audio/pcm") void result.audio.stream.cancel().catch(() => {});
        return;
      }
      acceptFormGuide(result.reply, request.input);
      if (result.reply.workContext) setWorkContext(result.reply.workContext);
      const id = crypto.randomUUID();
      rememberWorkflow(`${id}:reply`, result.reply, request.input.workflowReviewId);
      spokenMessages.set(result.audio, { id: `${id}:reply`, generation: request.generation, content: wattzunNativeSpokenReply(result.reply) });
      const turns: Message[] = [{ id: `${id}:reply`, role: "assistant", content: "", awaitingSpeech: true, reply: result.reply,
        ...(result.reply.action && !result.reply.formGuide ? { reviewDraft: result.reply.action } : {}),
        ...(!result.transcript.trim() && result.requestSummary ? { requestSummary: result.requestSummary } : {}) }];
      if (result.transcript.trim()) turns.unshift({ id, role: "user", content: result.transcript, memoryOnly: true });
      append(turns);
      // User input is independent of whether the assistant finishes speaking.
      // Keep late input even when playback is interrupted, but never cross a
      // changed call, selected record, actor or workspace generation.
      void result.inputTranscript?.then(transcript => {
        if (!transcript.trim() || !active.current || voiceCall.current !== call || request.generation !== contextGeneration.current) return;
        const hasUser = messagesRef.current.some(message => message.id === id);
        messagesRef.current = messagesRef.current.flatMap(message => {
          if (message.id !== `${id}:reply`) return [message];
          const answered = { ...message, requestSummary: undefined };
          return hasUser ? [answered] : [{ id, role: "user" as const, content: transcript, memoryOnly: true }, answered];
        });
        setMessages(messagesRef.current);
      });
      if (result.reply.action?.kind === "open_workspace") {
        const destination = wattzunNavigationDestination(result.reply.action, scope.portal);
        if (destination) navigate(destination.href);
      }
      if (!result.reply.formGuide && ((result.reply.action && result.reply.action.kind !== "open_workspace") || result.reply.lookup)) onExpand?.();
      window.dispatchEvent(new CustomEvent(WATTZUN_USAGE_CHANGED_EVENT, { detail: { userUid: user.uid, portal: scope.portal, scopeId: scope.scopeId } }));
    };
    const call = new WattzunVoiceCall(createWattzunBrowserVoiceEnvironment(), {
      status: status => { if (active.current && voiceCall.current === call) setCallStatus(status); },
      async greeting(signal) {
        if (guideSession.current) {
          const result = await guidedReply(signal);
          consumeReply(result);
          return result.audio;
        }
        const token = await user.getIdToken();
        if (signal.aborted) throw new Error("Call ended.");
        const result = await readCallResponse(await fetch("/api/wattzun/greeting", { method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ portal: scope.portal, scopeId: scope.scopeId, requestId: crypto.randomUUID(),
            name: scope.personalName || "", preferences: { ...preferencesRef.current } }), signal }), signal);
        return result.audio;
      },
      async submit(audio, signal) {
        const generation = contextGeneration.current;
        const input = requestInput("");
        const controller = new AbortController();
        voiceContextRequest.current?.abort(); voiceContextRequest.current = controller;
        const combined = AbortSignal.any([signal, controller.signal]);
        let result: WattzunVoiceResult | null = null;
        try {
          const token = await user.getIdToken();
          if (combined.aborted) throw new Error("Call ended.");
          const form = new FormData();
          if (input.formGuide && guideSession.current && !guideSession.current.input.pendingRequestId) guideSession.current.input.pendingRequestId = input.requestId;
          form.append("request", JSON.stringify(input));
          form.append("audio", audio, "question.wav");
          result = await readCallResponse(await fetch("/api/wattzun/voice", { method: "POST",
            headers: { Authorization: `Bearer ${token}`, Accept: WATTZUN_REALTIME_VOICE_STREAM_TYPE }, body: form, signal: combined }), combined, scope.portal);
          if (!active.current || combined.aborted || generation !== contextGeneration.current) throw new Error("The selected work changed. Ask again about the current work.");
          const info = replyWorkContext(result.reply, scope.portal, input.workReference ?? null);
          if (result.reply.action?.kind === "confirm_workflow") {
            const approvalSummary = result.requestSummary;
            const approvalTranscript = result.transcript;
            if (result.audio.mimeType === "audio/pcm") await result.audio.stream.cancel();
            const completed = await executeWorkflow(result.reply, combined, generation);
            const speechToken = await user.getIdToken();
            if (combined.aborted) throw new Error("Call ended.");
            const scopedFetch = createTradeBusinessFetch(scope.scopeId, window.location.origin, fetch);
            result = await readCallResponse(await scopedFetch("/api/wattzun/workflows/speech", { method: "POST",
              headers: { Authorization: `Bearer ${speechToken}`, "Content-Type": "application/json", Accept: WATTZUN_REALTIME_VOICE_STREAM_TYPE }, signal: combined,
              body: JSON.stringify({ portal: "trade", scopeId: scope.scopeId, requestId: crypto.randomUUID(), workflowReviewId: completed.reviewId, preferences: { ...preferencesRef.current } }),
            }), combined, scope.portal);
            result = { ...result, transcript: approvalTranscript, inputTranscript: Promise.resolve(approvalTranscript), ...(approvalSummary ? { requestSummary: approvalSummary } : {}) };
          }
          if (!active.current || combined.aborted || generation !== contextGeneration.current) throw new Error("The selected work changed. Ask again about the current work.");
          const voiceResult = result;
          const validated = { ...voiceResult, get transcript() { return voiceResult.transcript; }, reply: { ...voiceResult.reply, ...(info ? { workContext: info } : {}) } };
          replyGenerations.set(validated, { generation, input });
          return validated;
        } catch (failure) {
          if (result?.audio.mimeType === "audio/pcm") await result.audio.stream.cancel().catch(() => {});
          if (generation !== contextGeneration.current) throw new Error("The selected work changed. Ask again about the current work.");
          if (failure instanceof VoiceTurnFailure && failure.recoveredRequest?.requestId === input.requestId
            && active.current && voiceCall.current === call && !combined.aborted) {
            const id = `${input.requestId}:memory`;
            if (!messagesRef.current.some(message => message.id === id)) append([failure.recoveredRequest.transcript
              ? { id, role: "user", content: failure.recoveredRequest.transcript, memoryOnly: true }
              : { id, role: "assistant", content: "", memoryOnly: true, requestSummary: failure.recoveredRequest.requestSummary }]);
          }
          throw failure;
        }
      },
      reply: consumeReply,
      played: audio => {
        const spoken = spokenMessages.get(audio);
        if (!spoken || !active.current || voiceCall.current !== call || spoken.generation !== contextGeneration.current) return;
        spokenMessages.delete(audio);
        messagesRef.current = messagesRef.current.map(message => message.id === spoken.id ? { ...message, content: spoken.content, awaitingSpeech: false } : message);
        setMessages(messagesRef.current);
      },
    });
    voiceCall.current = call;
    guideRequest.current = control => call.requestReply(signal => guidedReply(signal, control));
    void call.start();
  }, [busy, callActive, requestInput, user, scope, append, onExpand, executeWorkflow, rememberWorkflow, navigate, acceptFormGuide]);

  const startGuide = useCallback(() => {
    if (scope.portal !== "trade" || workReferenceRef.current?.kind !== "trade_form") return;
    pendingWorkflowRef.current = null;
    guideSession.current = { input: { sessionId: crypto.randomUUID(), stage: "start", authorization: "ordinary_form_answers", skippedFieldKeys: [] }, progress: null, editorReference: workReferenceRef.current };
    setFormGuide(null); setError(""); setSelectionNotice("Wattzun will save your answers as you speak and ask before completing the form.");
    if (callActive) setGuideQueued(true);
    else startCall();
  }, [scope.portal, callActive, startCall]);

  useEffect(() => {
    if (!guideQueued || !["listening", "recovering"].includes(callStatus.state) || !guideRequest.current || !guideSession.current) return;
    const frame = window.requestAnimationFrame(() => {
      setGuideQueued(false);
      void guideRequest.current?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [guideQueued, callStatus.state]);

  useEffect(() => {
    const capture = formGuide?.next;
    if (formGuide?.state !== "capture" || capture?.type !== "photo" || formGuide.reference.formKind !== "work_pack") return;
    let cancelled = false;
    const target: WattzunFormCaptureTarget = { portal: "trade", scopeId: scope.scopeId, formKind: "work_pack", formId: formGuide.recordId,
      jobId: formGuide.reference.jobId, fieldKey: capture.fieldKey };
    void prepareWattzunFormCapture(target).then(result => {
      if (cancelled) return;
      setCaptureTarget(result.status === "ready" ? result.target : null);
      setCaptureNotice(result.status === "ready" ? "" : result.message);
    });
    return () => { cancelled = true; };
  }, [formGuide, scope.scopeId, setCaptureTarget, editorRevision]);

  useEffect(() => {
    const refreshed = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = readWattzunFormRefreshed(event.detail);
      const current = guideSession.current;
      const progress = current?.progress;
      if (!detail || !current || !progress || detail.scopeId !== scope.scopeId || detail.formKind !== progress.reference.formKind
        || detail.jobId !== progress.reference.jobId || detail.formId !== progress.recordId) return;
      setEditorRevision(`${detail.formId}:${progress.sourceSha256}`);
    };
    window.addEventListener(WATTZUN_FORM_REFRESHED_EVENT, refreshed);
    return () => window.removeEventListener(WATTZUN_FORM_REFRESHED_EVENT, refreshed);
  }, [scope.scopeId]);

  useEffect(() => {
    if (!callActive || formGuide?.state !== "manual" || formGuide.reference.formKind !== "work_pack" || !formGuide.next) return;
    const opened = focusWattzunFormQuestion({ portal: "trade", scopeId: scope.scopeId, formKind: "work_pack", formId: formGuide.recordId,
      jobId: formGuide.reference.jobId, fieldKey: formGuide.next.fieldKey });
    if (opened) onMinimise?.();
  }, [formGuide, callActive, scope.scopeId, editorRevision, onMinimise]);

  useEffect(() => {
    const saved = (event: Event) => {
      const detail = event instanceof CustomEvent ? readWattzunFormRefreshed(event.detail) : null;
      const current = guideSession.current, progress = current?.progress, selected = workReferenceRef.current;
      if (!detail || !current || !progress || !["manual", "review"].includes(progress.state) || selected?.kind !== "trade_form"
        || detail.scopeId !== scope.scopeId || detail.formKind !== selected.formKind || detail.jobId !== selected.jobId || detail.oldFormId !== selected.recordId) return;
      // A native save is only a cue to reload. The server decides whether the signature or declaration is complete.
      const reference = { ...selected, recordId: detail.formId };
      workReferenceRef.current = reference; setWorkReference(reference);
      current.input = { ...current.input, stage: "resume" };
      setGuideQueued(true);
    };
    window.addEventListener(WATTZUN_FORM_NATIVE_SAVED_EVENT, saved);
    return () => window.removeEventListener(WATTZUN_FORM_NATIVE_SAVED_EVENT, saved);
  }, [scope.scopeId]);

  useEffect(() => {
    const saved = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = readWattzunFormCaptureSaved(event.detail);
      const current = guideSession.current;
      const progress = current?.progress;
      const prepared = preparedCapture.current;
      if (!detail || !current || !progress || detail.scopeId !== scope.scopeId || progress.state !== "capture"
        || progress.reference.formKind !== "work_pack" || detail.jobId !== progress.reference.jobId
        || detail.fieldKey !== progress.next?.fieldKey
        || detail.oldFormId !== progress.recordId && (!prepared || prepared.scopeId !== detail.scopeId || prepared.jobId !== detail.jobId || prepared.fieldKey !== detail.fieldKey || prepared.formId !== detail.oldFormId)) return;
      // The event refreshes server context; it does not establish that the next question is complete.
      const reference = { ...progress.reference, recordId: detail.formId };
      workReferenceRef.current = reference; setWorkReference(reference);
      current.input = { ...current.input, stage: "resume" };
      setCaptureTarget(null); setCaptureNotice(""); setGuideQueued(true);
    };
    window.addEventListener(WATTZUN_FORM_CAPTURE_SAVED_EVENT, saved);
    return () => window.removeEventListener(WATTZUN_FORM_CAPTURE_SAVED_EVENT, saved);
  }, [scope.scopeId, setCaptureTarget]);

  const takePhoto = () => {
    if (!captureTarget || !captureWattzunFormPhoto(captureTarget)) {
      setCaptureTarget(null); setCaptureNotice("Open the form's photo question, then choose Prepare camera.");
    }
  };
  const prepareCamera = async () => {
    const progress = guideSession.current?.progress;
    if (progress?.state !== "capture" || progress.reference.formKind !== "work_pack" || !progress.next) return;
    const generation = contextGeneration.current;
    const target: WattzunFormCaptureTarget = { portal: "trade", scopeId: scope.scopeId, formKind: "work_pack", formId: progress.recordId,
      jobId: progress.reference.jobId, fieldKey: progress.next.fieldKey };
    const result = await prepareWattzunFormCapture(target);
    if (!active.current || generation !== contextGeneration.current || guideSession.current?.progress !== progress) return;
    setCaptureTarget(result.status === "ready" ? result.target : null);
    setCaptureNotice(result.status === "ready" ? "" : result.message);
    if (result.status === "unavailable" && workContext?.sources[0]) navigate(workContext.sources[0].href);
  };

  useEffect(() => {
    if (!openRequest || !presentation.ready || handledRequest.current === openRequest.id) return;
    const frame = window.requestAnimationFrame(() => {
      if (!active.current || handledRequest.current === openRequest.id) return;
      handledRequest.current = openRequest.id;
      if (openRequest.workReference) selectWork(openRequest.workReference);
      if (openRequest.guidedForm) startGuide();
      else if (openRequest.mode === "call") startCall();
      else {
        if (openRequest.initialMessage !== undefined) setDraft(openRequest.initialMessage);
        if (callActive && openRequest.workReference?.kind === "trade_form") setSelectionNotice('Form selected. Say "help me fill this form" to start with its next question.');
        composer.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openRequest, presentation.ready, startCall, startGuide, selectWork, callActive]);

  const hangUp = () => { voiceCall.current?.hangUp(); setMuted(false); };
  const toggleMute = () => { voiceCall.current?.toggleMute(); setMuted(current => !current); };
  return <>
    {!expanded && callActive && <div className={`${styles.dockedCall} ${styles.dialog}`} role="region" aria-label="Wattzun call">
      <span role="status"><span className={`${styles.activity} ${callStatus.state === "listening" ? styles.listening : ""}`} />{callLabels[callStatus.state]}</span>
      <button type="button" onClick={onExpand}>Open Wattzun</button>
      <button type="button" disabled={callStatus.state === "permission" || callStatus.state === "connecting"} aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
      <button className={styles.hangUp} type="button" onClick={hangUp}>Hang up</button>
      {workReference && <p className={styles.dockedContext}>Helping with: {workContext?.title || wattzunWorkLabel(workReference)}</p>}
      {formGuide?.state === "capture" && <button type="button" disabled={callStatus.state === "thinking"} onClick={captureTarget ? takePhoto : prepareCamera}>{captureTarget ? "Take photo" : "Prepare camera"}</button>}
      {callStatus.state === "recovering" && callStatus.message && <p className={styles.callHint} role="status">{callStatus.message}</p>}
    </div>}
    <div className={styles.conversation} hidden={!expanded}>
    {workReference && <section className={styles.workContext} aria-label="Selected work"><div><span>Helping with</span><strong>{workContext?.title || wattzunWorkLabel(workReference)}</strong></div><button type="button" onClick={() => selectWork(null)} aria-label="Clear selected work">Clear</button><p>Selecting work shares its current authorised details with our AI provider. File and photo contents are not read.</p></section>}
    {selectionNotice && <p className={styles.callHint} role="status">{selectionNotice}</p>}
    <div className={styles.tools}>
      {!callActive ? <button className={styles.callButton} type="button" disabled={busy} onClick={startCall}><PhoneIcon />Call Wattzun</button> : <span className={styles.callBadge} role="status"><span className={`${styles.activity} ${callStatus.state === "listening" ? styles.listening : ""}`} />{callLabels[callStatus.state]}</span>}
      <details className={styles.settings}>
        <summary>Speech speed</summary>
        <div className={styles.settingsPanel}>
          <label>Speaking speed<select aria-label="Speaking speed" value={presentation.speed} onChange={event => { const speed = Number(event.target.value); if (speed === 0.85 || speed === 1 || speed === 1.15) presentation.setSpeed(speed); }}><option value={0.85}>Slower</option><option value={1}>Normal</option><option value={1.15}>Quicker</option></select></label>
          <p>Speed changes apply from your next question.</p>
        </div>
      </details>
    </div>
    <p className={styles.disclosure}>Wattzun uses an AI-generated voice. Calling shares your spoken questions with our AI provider. Minimise to keep working while your call stays connected. Hang up to stop your microphone.</p>
    {callActive && <div className={styles.callControls}>
      <button type="button" disabled={callStatus.state === "permission" || callStatus.state === "connecting"} aria-pressed={muted} onClick={toggleMute}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
      {callStatus.state === "speaking" && <button type="button" onClick={() => voiceCall.current?.interrupt()}>Stop speaking</button>}
      <button className={styles.hangUp} type="button" onClick={hangUp}>Hang up</button>
    </div>}
    {callStatus.message && <p className={callStatus.state === "error" ? styles.error : styles.callHint} role={callStatus.state === "error" ? "alert" : "status"}>{callStatus.message}</p>}
    {callStatus.recovery === "reload" && <div className={styles.callControls}><button type="button" onClick={() => window.location.reload()}>Reload for calling</button></div>}
    {scope.portal === "trade" && workReference?.kind === "trade_form" && !formGuide && <div className={styles.callControls}><button type="button" disabled={busy || callStatus.state === "thinking" || guideQueued} onClick={startGuide}>Complete form by voice</button></div>}
    {formGuide && <section className={styles.formGuide} aria-label="Guided form completion">
      <div><strong>{formGuide.state === "complete" ? "Form completed" : "Completing your form"}</strong><span>{formGuide.counts.answered} of {formGuide.counts.visible} answered</span></div>
      {formGuide.next && <p>{formGuide.next.label}</p>}
      {formGuide.state === "ready_to_complete" && <p>All required items are ready. Tell Wattzun to complete the form.</p>}
      {formGuide.state === "manual" && <p>{formGuide.next?.reason || "This step needs the named person's input."}</p>}
      {formGuide.state === "review" && <p>{formGuide.completion.missing.join(" ")}</p>}
      {formGuide.state === "paused" && <p>Paused. Say “continue the form” when you are ready.</p>}
      {formGuide.state === "capture" && <><p>{formGuide.next?.reason || "Take the requested evidence photo. Wattzun will continue after it saves."}</p><button type="button" disabled={!callActive || callStatus.state === "thinking"} onClick={captureTarget ? takePhoto : prepareCamera}>{captureTarget ? "Take photo" : "Prepare camera"}</button>{captureNotice && <p role="status">{captureNotice}</p>}</>}
      {formGuide.state !== "complete" && callActive && <div className={styles.guideControls}>
        {formGuide.next && <><button type="button" disabled={!["listening", "speaking", "recovering"].includes(callStatus.state)} onClick={() => void guideRequest.current?.({ kind: "form_guide_control", command: "repeat", fieldKey: formGuide.next?.fieldKey || "" })}>Repeat question</button><button type="button" disabled={!["listening", "recovering"].includes(callStatus.state)} onClick={() => void guideRequest.current?.({ kind: "form_guide_control", command: "skip", fieldKey: formGuide.next?.fieldKey || "" })}>Skip for now</button></>}
        <button type="button" disabled={!["listening", "recovering"].includes(callStatus.state)} onClick={() => void guideRequest.current?.({ kind: "form_guide_control", command: formGuide.state === "paused" ? "resume" : "pause", fieldKey: formGuide.next?.fieldKey || "" })}>{formGuide.state === "paused" ? "Resume form" : "Pause form"}</button>
      </div>}
    </section>}
    <div className={styles.messages} role="log" aria-live={callActive ? "off" : "polite"} aria-label="Conversation with Wattzun">
      {!callActive && !messages.some(message => !message.memoryOnly) && <div className={styles.welcome}><h3>What can I help you with?</h3><p>Tell me what you want to get done. If I need more detail, I will ask.</p><div>{["What can you help me with?", "Help me find the next step"].map(example => <button key={example} type="button" disabled={callActive || busy} onClick={() => setDraft(example)}>{example}</button>)}</div></div>}
      {messages.filter(message => !message.memoryOnly).map(message => <article key={message.id} hidden={(callActive || message.awaitingSpeech) && !message.reply?.links.length && !message.reply?.workContext && !message.reply?.workflow && !message.reply?.action && !message.reply?.lookup} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}><strong hidden={callActive || message.awaitingSpeech}>{message.role === "user" ? "You" : "Wattzun"}</strong><p hidden={callActive || message.awaitingSpeech}>{message.reply ? message.reply.message : message.content}</p>{message.reply && message.reply.questions.length > 0 && <ol hidden={callActive || message.awaitingSpeech}>{message.reply.questions.map((question, index) => <li key={index}>{question}</li>)}</ol>}{message.reply && message.reply.links.length > 0 && <div className={styles.links}>{message.reply.links.map(link => wattzunPortalForPath(link.href.split(/[?#]/)[0]) === scope.portal
        ? <Link key={link.href} href={workspaceHref(link.href, scope, user.uid, pathname)} prefetch={false} onNavigate={event => { event.preventDefault(); navigate(link.href); }}>{link.label} <span aria-hidden="true">↗</span></Link>
        : <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label} <span aria-hidden="true">↗</span></a>)}</div>}
        {message.reply?.workContext && <details className={styles.contextSources}><summary>Sources and limits</summary><strong>{message.reply.workContext.title}</strong><div className={styles.links}>{message.reply.workContext.sources.map(source => <Link key={`${source.href}:${source.label}`} href={workspaceHref(source.href, scope, user.uid, pathname)} prefetch={false} onNavigate={event => { event.preventDefault(); navigate(source.href); }}>{source.label} <span aria-hidden="true">↗</span></Link>)}</div>{message.reply.workContext.limitations.length > 0 && <ul>{message.reply.workContext.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}</details>}
        {scope.portal === "trade" && message.reply?.lookup && <WattzunRecordPicker user={user} scope={scope} lookup={message.reply.lookup} onNavigate={navigate} onSelectWork={selectWork} />}
        {scope.portal === "trade" && !message.reply?.formGuide && message.reply?.action && message.reply.action.kind !== "open_workspace" && message.reply.action.kind !== "form_guide_control" && message.reply.action.kind !== "search_form_products" && (isWattzunWorkflowProposal(message.reply.action)
          ? message.reply.action.kind !== "confirm_workflow" && <WattzunWorkflowReview proposal={message.reply.action} initialResult={message.reply.workflow} user={user} scopeId={scope.scopeId} onResult={result => workflowReviewResult(message.id, result)} onCancel={() => dismissAction(message.id)} onNavigate={navigate} />
          : <WattzunActionReview proposal={message.reply.action} user={user} scopeId={scope.scopeId} onCreated={receipt => actionCreated(message.id, receipt)} onCancel={() => dismissAction(message.id)} onNavigate={navigate} />)}
      </article>)}
      {busy && <p className={styles.callHint} role="status">Wattzun is thinking...</p>}
      <div ref={scrollEnd} />
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <form hidden={callActive} className={styles.composer} onSubmit={event => { event.preventDefault(); void sendText(); }}>
      <label className={styles.srOnly} htmlFor="wattzun-portal-message">Message Wattzun</label>
      <textarea ref={composer} id="wattzun-portal-message" rows={2} maxLength={4000} value={draft} disabled={busy || callActive} placeholder={callActive ? "Hang up to continue in chat" : "Ask a question or describe your task..."} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendText(); } }} />
      <button type="submit" disabled={busy || callActive || !draft.trim()}>{busy ? "Sending..." : "Send"}</button>
    </form>
    <p className={styles.footer}>Workspace: {scope.label}. Check important details before acting.</p>
  </div></>;
}

function PhoneIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z" /></svg>; }
