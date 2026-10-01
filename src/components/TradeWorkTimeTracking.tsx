"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { parseStoredWorkTime, workTimePageKey, WorkTimeQueue, WorkTimeRecorder, WORK_TIME_HEARTBEAT_MS, type WorkTimeContext } from "@/lib/trade-work-time-client";

type FormContext = Omit<WorkTimeContext, "kind">;
type Tracking = { complete: (value: FormContext) => void; form: (value: FormContext | null, expected?: string) => void; job: (id: string, expected?: string) => void; status: string };
const Context = createContext<Tracking | null>(null);

export function TradeWorkTimeProvider({ ownerUid, request, children }: { ownerUid: string; request: typeof fetch; children: ReactNode }) {
  const [actorUid, setActorUid] = useState(firebaseAuth.currentUser?.uid || "");
  const [status, setStatus] = useState("");
  const recorder = useRef<WorkTimeRecorder | null>(null);
  const delivery = useRef<WorkTimeQueue | null>(null);
  const currentForm = useRef<FormContext | null>(null);
  const currentJob = useRef("");
  useEffect(() => onIdTokenChanged(firebaseAuth, user => setActorUid(user?.uid || "")), []);

  useEffect(() => {
    if (!actorUid || !ownerUid) return;
    let alive = true;
    const prefix = `tlink.work-time.v1:${encodeURIComponent(actorUid)}:${encodeURIComponent(ownerUid)}:`;
    const queue = new WorkTimeQueue({
      storage: {
        list: async () => Object.keys(localStorage).filter(key => key.startsWith(prefix))
          .map(key => parseStoredWorkTime(localStorage.getItem(key))).filter(item => item !== null),
        put: async session => { localStorage.setItem(prefix + session.id, JSON.stringify(session)); },
        remove: async id => { localStorage.removeItem(prefix + id); },
      },
      canSend: () => alive && navigator.onLine && firebaseAuth.currentUser?.uid === actorUid,
      send: async sessions => {
        const user = firebaseAuth.currentUser;
        if (!alive || user?.uid !== actorUid) throw new Error("ACCOUNT_CHANGED");
        const token = await user.getIdToken();
        if (!alive || firebaseAuth.currentUser?.uid !== actorUid) throw new Error("ACCOUNT_CHANGED");
        const response = await request("/api/trade-work-time", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sessions }) });
        if (!response.ok) throw new Error("WORK_TIME_SYNC_FAILED");
      },
      status: message => { if (alive) setStatus(message); },
    });
    const tracker = new WorkTimeRecorder({ source: "web", now: Date.now, uuid: () => crypto.randomUUID(), emit: session => queue.enqueue(session) });
    delivery.current = queue;
    recorder.current = tracker;
    tracker.setContext("app", { kind: "app", formKind: "", formId: "", pageKey: "", pageTitle: "", workOrderId: currentJob.current });
    if (currentForm.current) tracker.setContext("form", { kind: "form", ...currentForm.current });
    const foreground = () => { tracker.setForeground(document.visibilityState === "visible" && document.hasFocus()); void queue.flush(); };
    const activity = () => tracker.activity();
    const pause = () => { tracker.setForeground(false); void queue.flush(); };
    const flush = () => { tracker.checkpoint(); void queue.flush(); };
    foreground();
    const timer = window.setInterval(flush, WORK_TIME_HEARTBEAT_MS);
    const activityEvents = ["pointerdown", "pointermove", "keydown", "input", "scroll"] as const;
    activityEvents.forEach(name => document.addEventListener(name, activity, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("blur", pause);
    window.addEventListener("pagehide", pause);
    window.addEventListener("online", flush);
    void queue.flush();
    return () => {
      tracker.setForeground(false);
      alive = false;
      recorder.current = null;
      delivery.current = null;
      window.clearInterval(timer);
      activityEvents.forEach(name => document.removeEventListener(name, activity, true));
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("blur", pause);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("online", flush);
    };
  }, [actorUid, ownerUid, request]);

  const form = useCallback((value: FormContext | null, expected?: string) => {
    if (!value && expected && currentForm.current?.formId !== expected) return;
    currentForm.current = value;
    if (recorder.current?.setContext("form", value ? { kind: "form", ...value } : null)) void delivery.current?.flush();
  }, []);
  const complete = useCallback((value: FormContext) => {
    if (currentForm.current?.formId === value.formId && currentForm.current.formKind === value.formKind) currentForm.current = null;
    recorder.current?.completeForm({ kind: "form", ...value });
    void delivery.current?.flush();
  }, []);
  const job = useCallback((id: string, expected?: string) => {
    if (!id && expected && currentJob.current !== expected) return;
    currentJob.current = id;
    if (recorder.current?.setContext("app", { kind: "app", formKind: "", formId: "", pageKey: "", pageTitle: "", workOrderId: id })) void delivery.current?.flush();
  }, []);
  const value = useMemo(() => ({ form, complete, job, status }), [form, complete, job, status]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useFormTimeTracking({ enabled, activateOnOpen = true, ...context }: FormContext & { enabled: boolean; activateOnOpen?: boolean }) {
  const tracking = useContext(Context);
  const setForm = tracking?.form;
  const complete = tracking?.complete;
  const completed = useRef("");
  const { formId, formKind, workOrderId, pageKey, pageTitle } = context;
  const identity = formKind + ":" + formId;
  const activate = useCallback(() => { if (enabled && completed.current !== identity && formId && pageKey) setForm?.({ formId, formKind, workOrderId, pageKey: workTimePageKey(pageKey), pageTitle: pageTitle.slice(0, 160) }); }, [enabled, formId, formKind, setForm, workOrderId, pageKey, pageTitle, identity]);
  useEffect(() => {
    if (!enabled) completed.current = "";
    if (activateOnOpen) activate();
    return () => { setForm?.(null, formId); };
  }, [activate, activateOnOpen, enabled, formId, setForm]);
  const markCompleted = useCallback(() => {
    if (!formId || !pageKey || completed.current === identity) return;
    completed.current = identity;
    complete?.({ formId, formKind, workOrderId, pageKey: workTimePageKey(pageKey), pageTitle: pageTitle.slice(0, 160) });
  }, [complete, formId, formKind, workOrderId, pageKey, pageTitle, identity]);
  return { bind: { onPointerDownCapture: activate, onFocusCapture: activate }, markCompleted };
}

export function useJobTimeTracking(workOrderId: string) {
  const setJob = useContext(Context)?.job;
  useEffect(() => { setJob?.(workOrderId); return () => setJob?.("", workOrderId); }, [setJob, workOrderId]);
}

export function WorkTimeStatus() {
  const status = useContext(Context)?.status;
  return status ? <p className="crm-inline-status" role="status">{status}</p> : null;
}
