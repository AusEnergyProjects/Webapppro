import { useBusinessApi } from '@/lib/use-business-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { colours, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';

type Assessment = { id: string; workOrderId: string; recordNumber: string; status: 'draft' | 'complete' };
type Result = { records: Assessment[]; canManage: boolean };
export type FieldElectricalAssessmentState = { workOrderId: string; state: 'loading' | 'attached' | 'empty' | 'unavailable' };
const endpoint = '/api/trade-veu-electrical-assessments';

export function FieldVeuElectricalAssessmentPicker({ workOrderId, online, onChanged, onOpen, mode = 'library', onStateChange }: {
  workOrderId: string; online: boolean; onChanged: () => Promise<void>; onOpen: (recordId: string) => void; mode?: 'library' | 'attached' | 'files';
  onStateChange?: (state: FieldElectricalAssessmentState) => void;
}) {
  const apiRequest = useBusinessApi();
  const [records, setRecords] = useState<Assessment[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0), [loadedFor, setLoadedFor] = useState('');
  const loadKey = JSON.stringify([workOrderId, online, loadAttempt]);
  const loading = online && loadedFor !== loadKey;
  const current = useRef({ alive: true, busy: false });
  const load = useCallback((signal: AbortSignal) => {
    onStateChange?.({ workOrderId, state: online ? 'loading' : 'unavailable' });
    if (!online) return Promise.resolve();
    return apiRequest<Result>(`${endpoint}?workOrderId=${encodeURIComponent(workOrderId)}`, { signal })
      .then(result => {
        if (signal.aborted) return;
        if (!Array.isArray(result.records) || result.records.some(record => record.workOrderId !== workOrderId)) throw new Error('The assessment list could not be verified for this job.');
        setRecords(result.records); setCanManage(result.canManage === true); setError('');
        onStateChange?.({ workOrderId, state: result.records.length ? 'attached' : 'empty' });
      })
      .catch(caught => { if (!signal.aborted) { setCanManage(false); setError(caught instanceof Error ? caught.message : 'The electrical safety form could not be loaded.'); onStateChange?.({ workOrderId, state: 'unavailable' }); } })
      .finally(() => { if (!signal.aborted) setLoadedFor(loadKey); });
  }, [apiRequest, online, workOrderId, loadKey, onStateChange]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    const state = current.current; state.alive = true;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && previous !== 'active') setLoadAttempt(value => value + 1);
      previous = next;
    });
    return () => { state.alive = false; subscription.remove(); };
  }, []);

  async function add() {
    if (mode !== 'library' || !online || loading || !canManage || records.length || current.current.busy) return;
    current.current.busy = true; setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiRequest<{ record: Assessment }>(endpoint, {
        method: 'POST', body: JSON.stringify({ action: 'start', workOrderId }),
      });
      if (!current.current.alive) return;
      if (!result.record?.id || result.record.workOrderId !== workOrderId) throw new Error('The added assessment could not be verified for this job.');
      setRecords([result.record]); setMessage('Assessment added to this job.');
      onStateChange?.({ workOrderId, state: 'attached' });
      try { await onChanged(); }
      catch { if (current.current.alive) setMessage('Assessment added. Refresh the job to see it.'); }
    } catch (caught) { if (current.current.alive) setError(caught instanceof Error ? caught.message : 'The assessment could not be added.'); }
    finally { current.current.busy = false; if (current.current.alive) setBusy(false); }
  }
  const visibleRecords = mode === 'files' ? records.filter(record => record.status === 'complete') : records;
  if (mode !== 'library' && !visibleRecords.length && !loading && !error && online) return null;
  return <View style={styles.section}>
    <Text style={styles.title}>Pre-installation electrical safety assessment (Insulation)</Text>
    <Text style={styles.help}>PIESA: the official Victorian form for insulation electrical safety checks, evidence and signatures.</Text>
    {loading ? <Text style={styles.help}>Loading this job&apos;s assessment...</Text> : null}
    {visibleRecords.map(record => <View key={record.id} style={styles.section}><Text style={styles.help}>{record.recordNumber} · {record.status === 'complete' ? 'Completed assessment PDF' : 'Added to this job'}</Text><FieldButton variant="secondary" disabled={!online || busy} onPress={() => onOpen(record.id)}>{record.status === 'complete' ? 'View completed assessment' : 'Open assessment'}</FieldButton></View>)}
    {visibleRecords.length ? <Text style={styles.help}>Answer the questions, attach evidence, sign and finish the assessment here in TLink.</Text> : mode === 'library' && !loading && canManage ? <FieldButton disabled={!online || busy} onPress={() => void add()}>{busy ? 'Adding assessment...' : 'Add to this job'}</FieldButton> : mode === 'library' && !loading && online && !error ? <Text style={styles.help}>Your access does not include adding job assessments.</Text> : null}
    {!online ? <Text style={styles.help}>{mode === 'attached' ? 'Connect to check this job’s electrical safety assessment.' : 'Connect to add or open this assessment.'}</Text> : null}
    {error ? <><Text style={styles.error}>{error}</Text><FieldButton variant="quiet" disabled={!online || busy || loading} onPress={() => setLoadAttempt(value => value + 1)}>Refresh assessment</FieldButton></> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, paddingVertical: spacing.md },
  title: { color: colours.ink, fontSize: 17, fontWeight: '800' },
  help: { color: colours.muted, lineHeight: 21 }, error: { color: colours.red, lineHeight: 21 },
  success: { color: colours.green, lineHeight: 21 },
});
