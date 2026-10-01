import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { parseStoredWorkTime, workTimePageKey, WorkTimeQueue, WorkTimeRecorder, WORK_TIME_HEARTBEAT_MS, type WorkTimeContext } from '../../../src/lib/trade-work-time-client';
import { useBusinessApi } from '@/lib/use-business-api';
import { useApp } from '@/providers/app-provider';

type FormContext = Omit<WorkTimeContext, 'kind'>;
type Tracking = { complete: (value: FormContext) => void; form: (value: FormContext | null, expected?: string) => void; job: (id: string, expected?: string) => void; activity: () => void; status: string };
const Context = createContext<Tracking | null>(null);

export function NativeWorkTimeProvider({ children }: { children: ReactNode }) {
  const { user, access } = useApp();
  const scope = access.status === 'approved' ? user?.localOwnerKey || '' : '';
  return <NativeWorkTimeScope key={scope} ownerKey={scope}>{children}</NativeWorkTimeScope>;
}

function NativeWorkTimeScope({ ownerKey, children }: { ownerKey: string; children: ReactNode }) {
  const { sync } = useApp();
  const apiRequest = useBusinessApi();
  const online = useRef(sync.online);
  const [status, setStatus] = useState('');
  const recorder = useRef<WorkTimeRecorder | null>(null);
  const delivery = useRef<WorkTimeQueue | null>(null);
  const currentForm = useRef<FormContext | null>(null);
  const currentJob = useRef('');

  useEffect(() => {
    online.current = sync.online;
    if (sync.online) void delivery.current?.flush();
  }, [sync.online]);

  useEffect(() => {
    if (!ownerKey) return;
    let alive = true;
    const prefix = `tlink.work-time.v1:${encodeURIComponent(ownerKey)}:`;
    const queue = new WorkTimeQueue({
      storage: {
        list: async () => {
          const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
          const values = await AsyncStorage.multiGet(keys);
          return values.map(([, raw]) => parseStoredWorkTime(raw)).filter(item => item !== null);
        },
        put: session => AsyncStorage.setItem(prefix + session.id, JSON.stringify(session)),
        remove: id => AsyncStorage.removeItem(prefix + id),
      },
      canSend: () => alive && online.current,
      send: async sessions => {
        if (!alive) throw new Error('ACCOUNT_CHANGED');
        await apiRequest('/api/trade-work-time', { method: 'POST', body: JSON.stringify({ sessions }) });
      },
      status: message => { if (alive) setStatus(message); },
    });
    const tracker = new WorkTimeRecorder({ source: 'native', now: Date.now, uuid: Crypto.randomUUID, emit: session => queue.enqueue(session) });
    delivery.current = queue;
    recorder.current = tracker;
    tracker.setContext('app', { kind: 'app', formKind: '', formId: '', pageKey: '', pageTitle: '', workOrderId: currentJob.current });
    if (currentForm.current) tracker.setContext('form', { kind: 'form', ...currentForm.current });
    tracker.setForeground(AppState.currentState === 'active');
    const flush = () => { tracker.checkpoint(); void queue.flush(); };
    const timer = setInterval(flush, WORK_TIME_HEARTBEAT_MS);
    const state = AppState.addEventListener('change', value => { tracker.setForeground(value === 'active'); void queue.flush(); });
    const blur = AppState.addEventListener('blur', () => { tracker.setForeground(false); void queue.flush(); });
    const focus = AppState.addEventListener('focus', () => { tracker.setForeground(AppState.currentState === 'active'); void queue.flush(); });
    void queue.flush();
    return () => {
      tracker.setForeground(false);
      alive = false;
      recorder.current = null;
      delivery.current = null;
      clearInterval(timer);
      state.remove(); blur.remove(); focus.remove();
    };
  }, [apiRequest, ownerKey]);

  const form = useCallback((value: FormContext | null, expected?: string) => {
    if (!value && expected && currentForm.current?.formId !== expected) return;
    currentForm.current = value;
    if (recorder.current?.setContext('form', value ? { kind: 'form', ...value } : null)) void delivery.current?.flush();
  }, []);
  const complete = useCallback((value: FormContext) => {
    if (currentForm.current?.formId === value.formId && currentForm.current.formKind === value.formKind) currentForm.current = null;
    recorder.current?.completeForm({ kind: 'form', ...value });
    void delivery.current?.flush();
  }, []);
  const job = useCallback((id: string, expected?: string) => {
    if (!id && expected && currentJob.current !== expected) return;
    currentJob.current = id;
    if (recorder.current?.setContext('app', { kind: 'app', formKind: '', formId: '', pageKey: '', pageTitle: '', workOrderId: id })) void delivery.current?.flush();
  }, []);
  const activity = useCallback(() => recorder.current?.activity(), []);
  const value = useMemo(() => ({ form, complete, job, activity, status }), [form, complete, job, activity, status]);
  return <Context.Provider value={value}><View style={{ flex: 1 }} onTouchStart={activity} onTouchMove={activity}>{children}</View></Context.Provider>;
}

export function useFormTimeTracking({ enabled, formKind, formId, workOrderId, pageKey, pageTitle }: FormContext & { enabled: boolean }) {
  const context = useContext(Context);
  const setForm = context?.form;
  const complete = context?.complete;
  const completed = useRef('');
  const identity = formKind + ':' + formId;
  useFocusEffect(useCallback(() => {
    if (!enabled) completed.current = '';
    if (enabled && completed.current !== identity && formId && pageKey) setForm?.({ formKind, formId, workOrderId, pageKey: workTimePageKey(pageKey), pageTitle: pageTitle.slice(0, 160) });
    return () => setForm?.(null, formId);
  }, [enabled, formKind, formId, workOrderId, pageKey, pageTitle, setForm, identity]));
  const markCompleted = useCallback(() => {
    if (!formId || !pageKey || completed.current === identity) return;
    completed.current = identity;
    complete?.({ formKind, formId, workOrderId, pageKey: workTimePageKey(pageKey), pageTitle: pageTitle.slice(0, 160) });
  }, [complete, formKind, formId, workOrderId, pageKey, pageTitle, identity]);
  return { activity: context?.activity || (() => {}), markCompleted };
}

export function useJobTimeTracking(workOrderId: string) {
  const setJob = useContext(Context)?.job;
  useFocusEffect(useCallback(() => { setJob?.(workOrderId); return () => setJob?.('', workOrderId); }, [setJob, workOrderId]));
}

export function WorkTimeStatus() {
  const status = useContext(Context)?.status;
  return status ? <Text accessibilityRole="text" style={{ color: '#704d16', paddingVertical: 8 }}>{status}</Text> : null;
}
