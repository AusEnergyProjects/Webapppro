import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';

import type { SwmsAnswers, SwmsPayload, SwmsRecord, SwmsSaveInput, SwmsSignatureStroke, SwmsStartInput } from '../../../src/lib/trade-swms';
import { SignatureCapture } from '@/components/SignatureCapture';
import { FieldButton } from '@/components/field-button';
import { useFormTimeTracking, WorkTimeStatus } from '@/components/work-time-tracking';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldWorkPackSignatureDraft, FieldWorkPackSignerRole } from '@/lib/types';
import { useBusinessApi } from '@/lib/use-business-api';
import { useApp } from '@/providers/app-provider';

export type { SwmsPayload } from '../../../src/lib/trade-swms';

function emptySignature(name: string): FieldWorkPackSignatureDraft {
  return { signerRoleKey: 'scheduled_worker', signerName: name, signerCapacity: 'Scheduled worker', identity: {}, strokes: [], capturedAt: '' };
}

export function swmsSignatureStrokes(draft: FieldWorkPackSignatureDraft): readonly SwmsSignatureStroke[] {
  const origin = draft.strokes[0]?.points[0]?.capturedAtMs || 0;
  return draft.strokes.map(stroke => ({ points: stroke.points.map(point => ({
    x: point.x, y: point.y, pressure: point.pressure, capturedAtOffsetMs: Math.max(0, Math.round(point.capturedAtMs - origin)),
  })) }));
}

export function FieldSwmsFiles({ workOrderId, online, onOpen }: {
  workOrderId: string; online: boolean; onOpen: (data: SwmsPayload) => void;
}) {
  const apiRequest = useBusinessApi();
  const { user } = useApp();
  const ownerKey = user?.localOwnerKey || '';
  const [data, setData] = useState<SwmsPayload | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const loadKey = JSON.stringify([workOrderId, ownerKey, online, attempt]);
  const ready = online && loadedFor === loadKey;
  useEffect(() => {
    const controller = new AbortController();
    if (online && ownerKey) void apiRequest<SwmsPayload>(`/api/trade-swms?workOrderId=${encodeURIComponent(workOrderId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch(caught => { if (!controller.signal.aborted) { setData(null); setError(caught instanceof Error ? caught.message : 'The SWMS could not be loaded.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoadedFor(loadKey); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [apiRequest, loadKey, online, ownerKey, workOrderId]);

  async function open() {
    if (!ready || !data || pending.current || (!data.record && !data.capabilities.canEdit)) return;
    pending.current = true; setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try {
      let next = data;
      if (!next.record) {
        const body: SwmsStartInput = { action: 'start', workOrderId, expectedJobRevision: next.jobRevision };
        next = await apiRequest<SwmsPayload>('/api/trade-swms', { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
      }
      if (controller.signal.aborted) return;
      if (!next.record) throw new Error('The SWMS draft was not returned. Refresh Files and try again.');
      setData(next);
      onOpen(next);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The SWMS could not be opened.'); }
    finally {
      if (request.current === controller) { request.current = null; pending.current = false; setBusy(false); }
    }
  }

  return <View style={styles.section}>
    <Text style={styles.title}>SWMS</Text>
    <Text style={styles.help}>Prepare a safe work method statement for this job when needed.</Text>
    {!online ? <Text style={styles.help}>Connect to open, prepare or sign the SWMS.</Text> : !ready ? <Text style={styles.help}>Loading SWMS...</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {ready && data ? <>
      {data.record?.status === 'complete' ? <>
        <Text style={styles.help}>Signed by {data.record.signature?.signerName || 'the scheduled worker'}. Saved in Files.</Text>
        <FieldButton variant="secondary" loading={busy} onPress={() => void open()}>View signed SWMS</FieldButton>
      </> : data.record || data.capabilities.canEdit ? <FieldButton variant="secondary" loading={busy} onPress={() => void open()}>{data.record ? data.capabilities.canEdit ? 'Continue SWMS' : 'View SWMS draft' : 'Add SWMS'}</FieldButton> : null}
      {!data.capabilities.canEdit && !data.record && data.capabilities.reason ? <Text style={styles.help}>{data.capabilities.reason}</Text> : null}
    </> : null}
    {online && ready && error ? <FieldButton variant="quiet" disabled={busy} onPress={() => setAttempt(value => value + 1)}>Refresh SWMS</FieldButton> : null}
  </View>;
}

export function FieldSwmsForm({ initial, online, onBack, onChanged }: {
  initial: SwmsPayload & { record: SwmsRecord }; online: boolean; onBack: () => void; onChanged: () => Promise<void>;
}) {
  const apiRequest = useBusinessApi();
  const navigation = useNavigation();
  const [data, setData] = useState(initial);
  const [answers, setAnswers] = useState<SwmsAnswers>(() => ({ ...initial.record.answers }));
  const [signature, setSignature] = useState(() => emptySignature(initial.context.signer.name));
  const [page, setPage] = useState<'details' | 'sign'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const record = data.record;
  const dirty = JSON.stringify(answers) !== JSON.stringify(record.answers) || signature.strokes.length > 0;
  const editable = data.capabilities.canEdit && record.status === 'draft';
  const missing = data.template.fields.filter(field => field.required && !answers[field.key].trim());
  const timing = useFormTimeTracking({ formKind: 'swms', formId: record.id, workOrderId: record.workOrderId,
    pageKey: page === 'details' ? 'work_details' : 'signature', pageTitle: page === 'details' ? 'SWMS work details' : 'SWMS signature',
    enabled: editable && online });
  const signerRole: FieldWorkPackSignerRole = { roleKey: 'scheduled_worker', label: 'Scheduled worker', capacity: 'Scheduled worker',
    identitySource: 'assigned_worker', minimumSignatures: 1, maximumSignatures: 1, identityRequirements: [] };

  function leave(action = onBack) {
    if (pending.current) return;
    if (dirty) Alert.alert('Unsaved SWMS', 'Save your draft before leaving, or discard these unsaved changes.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Discard changes', style: 'destructive', onPress: action },
    ]);
    else action();
  }
  usePreventRemove(dirty || busy, ({ data: event }) => leave(() => navigation.dispatch(event.action)));

  function change(key: keyof SwmsAnswers, value: string) {
    if (!editable || busy || !online || conflict) return;
    setAnswers(current => ({ ...current, [key]: value }));
    setSignature(emptySignature(data.context.signer.name)); setMessage(''); setError(''); timing.activity();
  }

  async function save(next: 'draft' | 'sign' | 'complete') {
    if (pending.current || !editable || !online || conflict) return;
    if (next !== 'draft' && missing.length) return setError(`Complete ${missing.map(field => field.label.toLowerCase()).join(', ')} before signing.`);
    if (next !== 'draft' && !data.capabilities.canSign) return setError(data.capabilities.reason || 'Only the scheduled worker can sign this SWMS.');
    if (next === 'complete' && !signature.strokes.some(stroke => stroke.points.length >= 3)) return setError('Draw your signature before saving the SWMS.');
    pending.current = true; setBusy(true); setError(''); setMessage('');
    const signal = lifetime.current?.signal;
    try {
      const body: SwmsSaveInput = { workOrderId: record.workOrderId, id: record.id, expectedRevision: record.revision,
        expectedJobRevision: data.jobRevision, answers,
        ...(next === 'complete' ? { finalize: true, signature: swmsSignatureStrokes(signature) } : {}) };
      const result = await apiRequest<SwmsPayload>('/api/trade-swms', { method: 'PATCH', body: JSON.stringify(body), signal });
      if (signal?.aborted) return;
      if (!result.record || (next === 'complete' && result.record.status !== 'complete')) throw new Error('The SWMS was not confirmed as saved. Refresh and review the record.');
      setData({ ...result, record: result.record }); setAnswers({ ...result.record.answers }); setSignature(emptySignature(result.context.signer.name));
      void onChanged().catch(() => { if (!signal?.aborted) setMessage('SWMS saved. The job could not refresh; check Sync when connected.'); });
      if (next === 'complete') { timing.markCompleted(); onBack(); }
      else if (next === 'sign' && result.capabilities.canSign) setPage('sign');
      else setMessage('Draft saved.');
    } catch (caught) {
      if (!signal?.aborted) {
        if (caught instanceof Error && 'status' in caught && caught.status === 409) { setConflict(true); setSignature(emptySignature(data.context.signer.name)); }
        setError(caught instanceof Error ? caught.message : 'The SWMS was not saved. Your answers remain on this screen.');
      }
    } finally { pending.current = false; if (!signal?.aborted) setBusy(false); }
  }

  async function reload() {
    if (!online || pending.current) return;
    pending.current = true; setBusy(true);
    const signal = lifetime.current?.signal;
    try {
      const result = await apiRequest<SwmsPayload>(`/api/trade-swms?workOrderId=${encodeURIComponent(record.workOrderId)}`, { signal });
      if (signal?.aborted) return;
      if (!result.record) throw new Error('This SWMS is no longer available. Return to Files.');
      setData({ ...result, record: result.record }); setAnswers({ ...result.record.answers }); setSignature(emptySignature(result.context.signer.name));
      setConflict(false); setError(''); setMessage('Saved SWMS loaded.'); setPage('details');
    } catch (caught) { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'The SWMS could not be refreshed.'); }
    finally { pending.current = false; if (!signal?.aborted) setBusy(false); }
  }

  const context = record.status === 'complete' ? record.context : data.context;
  const signed = record.status === 'complete' ? record.signature : null;
  const savedSignature: FieldWorkPackSignatureDraft | null = signed ? {
    ...emptySignature(signed.signerName), capturedAt: signed.signedAt,
    strokes: signed.strokes.map((stroke, index) => ({ strokeKey: `${record.id}:${index}`, points: stroke.points.map(point => ({
      x: point.x, y: point.y, pressure: point.pressure, capturedAtMs: Date.parse(signed.signedAt) + point.capturedAtOffsetMs,
    })) })),
  } : null;
  return <View style={styles.card}>
    <FieldButton variant="secondary" disabled={busy} onPress={() => page === 'sign' ? setPage('details') : leave()}>{page === 'sign' ? 'Work details' : 'Files'}</FieldButton>
    <Text style={styles.title}>Safe work method statement</Text>
    <Text style={styles.help}>Review the actual work and site conditions. Adding this record to TLink is optional; SWMS duties still apply where required.</Text>
    <View style={styles.context}>
      <Text style={styles.label}>{context.businessName}</Text>
      {context.abn ? <Text style={styles.help}>ABN {context.abn}</Text> : null}
      <Text style={styles.help}>{context.workNumber} | {context.jobTitle}</Text>
      {context.siteAddress ? <Text style={styles.help}>{context.siteAddress}</Text> : null}
      <Text style={styles.label}>Scheduled worker: {context.scheduledWorker.name || 'Not assigned'}</Text>
    </View>
    {!online ? <Text style={styles.warning}>You are offline. Keep this screen open and reconnect to save or sign. Unsaved changes are only on this screen.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.help}>{message}</Text> : null}
    {conflict ? <>
      <Text style={styles.warning}>This job or SWMS changed elsewhere. Your text remains here. Load the saved version before editing or signing again.</Text>
      <FieldButton variant="secondary" disabled={!online || busy} onPress={() => Alert.alert('Load saved SWMS?', 'This replaces the unsaved answers on this screen.', [{ text: 'Keep answers', style: 'cancel' }, { text: 'Load saved version', onPress: () => void reload() }])}>Load saved version</FieldButton>
    </> : null}
    {page === 'details' ? <>
      {data.template.fields.map(field => <View key={field.key} style={styles.field}>
        <Text style={styles.label}>{field.label}</Text><Text style={styles.help}>{field.hint}</Text>
        {record.status === 'complete' ? <Text selectable style={styles.answer}>{record.answers[field.key]}</Text>
          : <TextInput accessibilityLabel={field.label} multiline textAlignVertical="top" value={answers[field.key]} maxLength={4000}
            editable={editable && online && !busy && !conflict} style={styles.input} onChangeText={value => change(field.key, value)} />}
      </View>)}
      {savedSignature && signed ? <>
        <Text style={styles.label}>Signed by {signed.signerName}</Text>
        <Text style={styles.help}>{new Date(signed.signedAt).toLocaleString('en-AU')} | Template version {record.templateVersion}</Text>
        <SignatureCapture signerRole={signerRole} declaration={data.template.declaration} value={savedSignature} displayOnly onChange={() => {}} />
      </> : null}
      {editable ? <>
        <FieldButton variant="secondary" loading={busy} disabled={!online || conflict} onPress={() => void save('draft')}>Save draft</FieldButton>
        {data.capabilities.canSign ? <FieldButton disabled={!online || busy || conflict || missing.length > 0} onPress={() => void save('sign')}>Review and sign</FieldButton> : <Text style={styles.help}>{data.capabilities.reason || 'The scheduled worker must open and sign this SWMS using their own access.'}</Text>}
      </> : <Text style={styles.help}>{record.status === 'complete' ? 'This signed SWMS is saved in Files and cannot be edited.' : data.capabilities.reason || 'Your access allows you to view this SWMS.'}</Text>}
    </> : <>
      <Text style={styles.label}>Signing as {data.context.signer.name}</Text>
      <SignatureCapture signerRole={signerRole} declaration={data.template.declaration} value={signature}
        disabled={!online || busy || conflict || !data.capabilities.canSign || !editable} onChange={value => { setSignature(value); setError(''); timing.activity(); }} />
      <FieldButton loading={busy} disabled={!online || conflict || !data.capabilities.canSign || !editable || !signature.strokes.length} onPress={() => void save('complete')}>Sign and save to Files</FieldButton>
    </>}
    <WorkTimeStatus />
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colours.surface, borderColor: colours.line, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  section: { borderTopColor: colours.line, borderTopWidth: 1, paddingTop: spacing.lg, gap: spacing.sm },
  context: { backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: spacing.xs },
  field: { gap: spacing.sm }, title: { color: colours.ink, fontWeight: '800', fontSize: 21 },
  label: { color: colours.ink, fontWeight: '700', fontSize: 16 }, help: { color: colours.muted, lineHeight: 21 },
  answer: { color: colours.ink, lineHeight: 23, fontSize: 16 },
  input: { minHeight: 110, borderColor: colours.line, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, color: colours.ink, fontSize: 16 },
  error: { color: colours.red, lineHeight: 21 }, warning: { color: colours.amber, lineHeight: 21 },
});
