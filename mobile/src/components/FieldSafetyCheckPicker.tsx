import { useBusinessApi } from '@/lib/use-business-api';
import type { SafetyCheckKind } from '../../../src/lib/job-safety-check';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { colours, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';

type Check = { id: string; workOrderId: string; kind: SafetyCheckKind; recordNumber: string; status: 'draft' | 'complete' };
type Result = { records: Check[]; canManage: boolean };
export type FieldSafetyCheckState = { workOrderId: string; state: 'loading' | 'attached' | 'empty' | 'unavailable' };
const endpoint = '/api/trade-safety-checks';
const kinds: SafetyCheckKind[] = ['electrical', 'gas'];
const title = (kind: SafetyCheckKind) => kind === 'electrical' ? 'Electrical safety check' : 'Gas safety check';
const verified = (record: Check, workOrderId: string) => Boolean(record && typeof record.id === 'string' && record.id
  && record.workOrderId === workOrderId && kinds.includes(record.kind) && ['draft', 'complete'].includes(record.status)
  && typeof record.recordNumber === 'string');

export function FieldSafetyCheckPicker({ workOrderId, online, onChanged, onOpen, mode = 'library', onStateChange }: {
  workOrderId: string; online: boolean; onChanged: () => Promise<void>; onOpen: (recordId: string) => void;
  mode?: 'library' | 'attached' | 'files'; onStateChange?: (state: FieldSafetyCheckState) => void;
}) {
  const apiRequest = useBusinessApi();
  const [records, setRecords] = useState<Check[]>([]), [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0), [loadedFor, setLoadedFor] = useState('');
  const loadKey = JSON.stringify([workOrderId, online, loadAttempt]), loading = online && loadedFor !== loadKey;
  const current = useRef({ alive: true, busy: false });
  const load = useCallback(async (signal: AbortSignal) => {
    onStateChange?.({ workOrderId, state: online ? 'loading' : 'unavailable' });
    if (!online) return;
    try {
      const result = await apiRequest<Result>(`${endpoint}?workOrderId=${encodeURIComponent(workOrderId)}`, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(result.records) || result.records.some(record => !verified(record, workOrderId))) throw new Error('The safety check list could not be verified for this job.');
      setRecords(result.records); setCanManage(result.canManage === true); setError('');
      onStateChange?.({ workOrderId, state: result.records.length ? 'attached' : 'empty' });
    } catch (caught) {
      if (!signal.aborted) {
        setCanManage(false); setError(caught instanceof Error ? caught.message : 'The safety checks could not be loaded.');
        onStateChange?.({ workOrderId, state: 'unavailable' });
      }
    } finally { if (!signal.aborted) setLoadedFor(loadKey); }
  }, [apiRequest, online, workOrderId, loadKey, onStateChange]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const state = current.current; state.alive = true;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') setLoadAttempt(value => value + 1);
      previous = next;
    });
    return () => { state.alive = false; subscription.remove(); };
  }, []);
  async function add(kind: SafetyCheckKind) {
    if (mode !== 'library' || !online || loading || !canManage || records.some(record => record.kind === kind) || current.current.busy) return;
    current.current.busy = true; setBusy(kind); setError(''); setMessage('');
    try {
      const result = await apiRequest<{ record: Check }>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'start', workOrderId, kind }) });
      if (!current.current.alive) return;
      if (!verified(result.record, workOrderId) || result.record.kind !== kind) throw new Error('The added safety check could not be verified for this job.');
      setRecords(previous => [...previous.filter(record => record.kind !== kind), result.record]); setMessage(`${title(kind)} added to this job.`);
      onStateChange?.({ workOrderId, state: 'attached' }); onOpen(result.record.id);
      try { await onChanged(); } catch { if (current.current.alive) setMessage('Safety check added. Refresh the job to see it.'); }
    } catch (caught) { if (current.current.alive) setError(caught instanceof Error ? caught.message : 'The safety check could not be added.'); }
    finally { current.current.busy = false; if (current.current.alive) setBusy(''); }
  }
  const visible = mode === 'files' ? records.filter(record => record.status === 'complete') : records;
  if (mode !== 'library' && !visible.length && !loading && !error && online) return null;
  return <View style={styles.section}>
    <Text style={styles.title}>Official safety checks</Text>
    {mode === 'library' ? <Text style={styles.help}>Complete the official Victorian electrical or gas safety form with evidence and signatures.</Text> : null}
    {loading ? <Text style={styles.help}>Loading this job&apos;s safety checks...</Text> : null}
    {visible.map(record => <View key={record.id} style={styles.section}>
      <Text style={styles.title}>{title(record.kind)}</Text><Text style={styles.help}>{record.recordNumber} · {record.status === 'complete' ? 'Completed safety check PDF' : 'Saved draft'}</Text>
      <FieldButton variant="secondary" disabled={!online || Boolean(busy)} onPress={() => onOpen(record.id)}>{`${record.status === 'complete' ? 'View completed' : 'Open'} ${record.kind} safety check`}</FieldButton>
    </View>)}
    {mode === 'library' && !loading && canManage ? kinds.filter(kind => !records.some(record => record.kind === kind)).map(kind => <FieldButton key={kind} disabled={!online || Boolean(busy)} onPress={() => void add(kind)}>{busy === kind ? `Adding ${kind} safety check...` : `Add ${kind} safety check to this job`}</FieldButton>) : null}
    {mode === 'library' && !loading && online && !error && !canManage ? <Text style={styles.help}>Your access does not include adding safety checks.</Text> : null}
    {!online ? <Text style={styles.help}>Connect to check, add or open the saved official safety forms.</Text> : null}
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><FieldButton variant="quiet" disabled={!online || Boolean(busy) || loading} onPress={() => setLoadAttempt(value => value + 1)}>Refresh safety checks</FieldButton></> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingVertical: spacing.md }, title: { color: colours.ink, fontSize: 17, fontWeight: '800' },
  help: { color: colours.muted, lineHeight: 21 }, error: { color: colours.red, lineHeight: 21 }, success: { color: colours.green, lineHeight: 21 },
});
