import { useBusinessApi } from '@/lib/use-business-api';
import { ApiError, downloadElectricalAssessmentFile } from '@/lib/api';
import { useApp } from '@/providers/app-provider';
import { activitySignatureStrokesAreValid } from '@/lib/activity-form-completion';
import type { FieldWorkPackSignatureDraft, FieldWorkPackSignerRole } from '@/lib/types';
import type { PiesaPresentation } from '../../../src/lib/veu-electrical-assessment';
import type { ActivityAnswers, ActivityDeclaration } from '../../../src/lib/trade-activity-form-types';
import { activityOptionLabel, activityRepeatCount, activityRepeatItemLabel, boundActivityDeclaration,
  expandedActivityFields, fieldConditionMet, mergeActivityAnswers, removeLastActivityRepeat, type ExpandedActivityField } from '../../../src/lib/trade-activity-form-flow';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from './keyboard-aware-scroll-view';
import { FieldButton } from './field-button';
import { FieldDatePicker } from './field-date-picker';
import { FieldSelect } from './field-select';
import { SignatureCapture } from './SignatureCapture';
import { colours, radius, spacing } from '@/lib/theme';

const endpoint = '/api/trade-veu-electrical-assessments';
type Result = { record: PiesaPresentation; canManage?: boolean };
type PendingEvidence = { fieldKey: string; uri: string; name: string };
const sameAnswers = (left: ActivityAnswers, right: ActivityAnswers) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
const freshSignature = (declaration: ActivityDeclaration, signerName: string): FieldWorkPackSignatureDraft => ({
  signerRoleKey: declaration.key, signerName, signerCapacity: declaration.title, identity: {}, strokes: [], capturedAt: '',
});

/** The official schema and completion rules are owned by the assessment service. */
export function FieldVeuElectricalAssessmentWizard({ workOrderId, recordId, online, onReturnToJob, onChanged }: {
  workOrderId: string; recordId: string; online: boolean; onReturnToJob: () => void; onChanged: () => Promise<void>;
}) {
  const apiRequest = useBusinessApi(), { user } = useApp(), navigation = useNavigation();
  const [record, setRecord] = useState<PiesaPresentation | null>(null), [answers, setAnswers] = useState<ActivityAnswers>({});
  const [canManage, setCanManage] = useState(false), [loadedFor, setLoadedFor] = useState(''), [page, setPage] = useState('');
  const loadKey = JSON.stringify([recordId, workOrderId, online]);
  const loading = online && loadedFor !== loadKey;
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [signatures, setSignatures] = useState<Record<string, FieldWorkPackSignatureDraft>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<PendingEvidence | null>(null);
  const current = useRef({ record, answers, busy: '', alive: true });
  const mutation = useRef({ identity: '', requestId: '' });
  const dirty = Boolean(record && !sameAnswers(record.answers, answers));
  const ink = Object.values(signatures).some(signature => signature.strokes.length > 0);
  const writable = online && canManage && record?.status === 'draft';

  function confirmLeave(leave: () => void) {
    if (current.current.busy) { Alert.alert('Please wait', 'Wait for the assessment request to finish.'); return; }
    if (dirty || ink || pending) Alert.alert('Unsaved assessment', 'Save your answers, signature or evidence before leaving. Discard only if you do not need these unsaved changes.', [
      { text: 'Keep working', style: 'cancel' }, { text: 'Discard unsaved changes', style: 'destructive', onPress: () => {
        if (pending) { const file = new File(pending.uri); if (file.exists) file.delete(); }
        leave();
      } },
    ]);
    else leave();
  }
  usePreventRemove(Boolean(busy || dirty || ink || pending), ({ data }) => confirmLeave(() => navigation.dispatch(data.action)));
  const adopt = useCallback((next: PiesaPresentation, saved = false) => {
    if (!next || next.id !== recordId || next.workOrderId !== workOrderId || !['draft', 'complete'].includes(next.status)
      || !Number.isSafeInteger(next.revision) || !Array.isArray(next.form?.fields) || !Array.isArray(next.form.declarations)
      || !next.answers || typeof next.answers !== 'object' || Array.isArray(next.answers) || !next.signerFields
      || !Array.isArray(next.evidence) || !Array.isArray(next.signatures) || !Array.isArray(next.missing)
      || typeof next.ready !== 'boolean' || !next.signingScopes?.before || !next.signingScopes.after
      || typeof next.reportUrl !== 'string' || !Array.isArray(next.delivery)) throw new Error('This assessment does not match the selected job.');
    const previous = current.current.record;
    const completedElsewhere = next.status === 'complete' && previous?.status === 'draft' && !saved && !sameAnswers(previous.answers, current.current.answers);
    const merge = previous && !saved && next.status === 'draft' ? mergeActivityAnswers(previous.answers, current.current.answers, next.answers) : { merged: next.answers, conflicts: [] };
    current.current.record = next; current.current.answers = merge.merged;
    setRecord(next); setAnswers(merge.merged);
    setSignatures(existing => Object.fromEntries(Object.entries(existing).filter(([key]) => {
      const declaration = next.form.declarations.find(item => item.key === key);
      return declaration && previous?.signingScopes[declaration.phase] === next.signingScopes[declaration.phase]
        && !next.signatures.some(signature => signature.declarationKey === key);
    })));
    if (previous?.signingScopes.before !== next.signingScopes.before || previous?.signingScopes.after !== next.signingScopes.after) setAccepted({});
    if (merge.conflicts.length) setError('These answers also changed elsewhere. Your unsaved answers are retained; review them before saving.');
    if (completedElsewhere) setNotice('This assessment was completed elsewhere. The official completed answers are shown; your unsaved changes were not applied.');
    setPage(previousPage => next.status === 'complete' ? 'review' : previousPage || next.form.fields[0]?.section || 'review');
  }, [recordId, workOrderId]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!online) throw new Error('Connect to load and complete this assessment.');
    const result = await apiRequest<Result>(`${endpoint}?recordId=${encodeURIComponent(recordId)}`, { signal });
    if (signal?.aborted || !current.current.alive) return;
    adopt(result.record); setCanManage(result.canManage === true);
  }, [online, apiRequest, recordId, adopt]);
  useEffect(() => {
    const state = current.current; state.alive = true;
    const controller = new AbortController();
    void refresh(controller.signal).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The assessment could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadedFor(loadKey); });
    return () => { state.alive = false; controller.abort(); };
  }, [refresh, loadKey]);

  async function perform(label: string, task: () => Promise<void>) {
    if (current.current.busy || !current.current.alive) return;
    current.current.busy = label; setBusy(label); setError(''); setNotice('');
    try { await task(); }
    catch (caught) { if (current.current.alive) setError(caught instanceof ApiError && caught.code === 'NETWORK_TIMEOUT'
      ? 'The service did not confirm this request. Your unsaved work stays here. Refresh the saved assessment before trying again.'
      : caught instanceof Error ? caught.message : 'The assessment request failed. Refresh its saved state before trying again.'); }
    finally { current.current.busy = ''; if (current.current.alive) setBusy(''); }
  }
  async function mutate(action: string, payload: object, method = 'POST') {
    const previous = current.current.record;
    if (!online || !canManage || !previous || previous.status !== 'draft' && action !== 'retry_delivery') throw new Error('Connect with assessment access to save this form.');
    const body = { ...payload, recordId: previous.id, ...(action === 'retry_delivery' ? {} : { baseRevision: previous.revision }) };
    const identity = JSON.stringify({ method, body });
    if (mutation.current.identity !== identity) mutation.current = { identity, requestId: Crypto.randomUUID() };
    const result = await apiRequest<Result>(endpoint, { method, body: JSON.stringify({ ...body, requestId: mutation.current.requestId }) }, undefined, action === 'complete' || action === 'retry_delivery' ? { operation: 'report' } : {});
    if (!current.current.alive) return;
    if (action === 'complete' && (result.record?.status !== 'complete' || !result.record.reportUrl)) throw new Error('Completion was not confirmed. Refresh the saved assessment before trying again.');
    adopt(result.record, true); setNotice(action === 'complete' ? 'Assessment completed. Its PDF is saved with this job.' : 'Saved.');
  }
  async function save() {
    const previous = current.current.record;
    if (!previous || sameAnswers(previous.answers, current.current.answers)) return;
    await mutate('save', { answers: current.current.answers }, 'PATCH');
  }
  function edit(key: string, value: string | number | boolean) {
    const next = { ...current.current.answers };
    if (value === '') delete next[key]; else next[key] = value;
    current.current.answers = next; setAnswers(next); setNotice('');
  }
  async function retainEvidence(field: ExpandedActivityField, uri: string, name: string) {
    const original = new File(uri);
    if (!original.exists || original.size < 5 || original.size > 8 * 1024 * 1024) throw new Error('Choose an evidence file under 8 MB.');
    const kept = new File(Paths.document, `piesa-${Crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)}`);
    original.copy(kept); const item = { fieldKey: field.key, uri: kept.uri, name };
    setPending(item); await upload(item);
  }
  async function capture(field: ExpandedActivityField, camera: boolean) {
    await save();
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Allow camera access in your phone settings to take evidence photos.');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: true, cameraType: ImagePicker.CameraType.back });
      if (!result.canceled && result.assets[0]) await retainEvidence(field, result.assets[0].uri, result.assets[0].fileName || 'Assessment-photo.jpg');
    } else {
      const result = await DocumentPicker.getDocumentAsync({ type: field.type === 'photo' ? ['image/jpeg', 'image/png'] : ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
      if (!result.canceled && result.assets[0]) await retainEvidence(field, result.assets[0].uri, result.assets[0].name);
    }
  }
  async function upload(item: PendingEvidence) {
    const previous = current.current.record;
    if (!online || !canManage || !previous || previous.status !== 'draft') throw new Error('Reconnect to upload this retained evidence.');
    const file = new File(item.uri);
    if (!file.exists) throw new Error('This retained file is unavailable. Take or choose it again.');
    const identity = JSON.stringify({ operation: 'upload', recordId: previous.id, revision: previous.revision, fieldKey: item.fieldKey, uri: item.uri });
    if (mutation.current.identity !== identity) mutation.current = { identity, requestId: Crypto.randomUUID() };
    const body = new FormData(); body.append('action', 'upload'); body.append('recordId', previous.id);
    body.append('baseRevision', String(previous.revision)); body.append('fieldKey', item.fieldKey); body.append('requestId', mutation.current.requestId); body.append('file', file);
    const result = await apiRequest<Result>(endpoint, { method: 'POST', body });
    if (!current.current.alive) return;
    adopt(result.record, true); setPending(null); file.delete(); setNotice('Evidence saved.');
  }
  async function saveFile(view: 'pdf' | 'evidence', evidenceId = '') {
    const value = current.current.record, ownerKey = user?.localOwnerKey;
    if (!value || !ownerKey) throw new Error('Reopen this job with your current business access.');
    const downloaded = await downloadElectricalAssessmentFile(value.id, view, ownerKey, evidenceId);
    if (!current.current.alive) return;
    const extension = downloaded.contentType === 'application/pdf' ? 'pdf' : downloaded.contentType === 'image/png' ? 'png' : 'jpg';
    let directory: Directory;
    try { directory = await Directory.pickDirectoryAsync(); }
    catch (caught) {
      if (caught instanceof Error && /cancelled|canceled/i.test(caught.message)) return;
      throw caught;
    }
    if (!current.current.alive) return;
    const file = directory.createFile(`${value.recordNumber}-${evidenceId || value.revision}-${Crypto.randomUUID()}.${extension}`, downloaded.contentType);
    try {
      file.write(downloaded.bytes);
      if (!file.exists || file.size !== downloaded.bytes.byteLength) throw new Error('The document was not saved completely. Choose a folder with write access and try again.');
    } catch (caught) { if (file.exists) file.delete(); throw caught; }
    setNotice(`Saved ${file.name} in the folder you selected.`);
  }

  const sections = record ? [...new Set(record.form.fields.map(field => field.section))] : [];
  const pages = [...sections, 'signatures', 'review'];
  const fields = record ? expandedActivityFields(record.form, answers) : [];
  const declarations = record?.form.declarations.filter(item => fieldConditionMet(item.condition, answers, record.form)) || [];
  const disabled = !writable || Boolean(busy);
  const signatureReady = !dirty && !pending && !record?.missing.some(item => item.kind !== 'signature');
  function renderField(field: ExpandedActivityField) {
    const label = `${field.label}${field.required ? ' *' : ''}${field.repeatGroup ? ` · ${activityRepeatItemLabel(field.repeatGroup)} ${field.repeatIndex + 1}` : ''}`;
    const evidence = record?.evidence.filter(item => item.fieldKey === field.key) || [];
    return <View key={field.key} style={styles.question}>
      <Text style={styles.label}>{label}</Text>{field.help ? <Text style={styles.help}>{field.help}</Text> : null}
      {field.key === 'initial_correct' ? <>
        <Text style={styles.help}>{answers.initial_correct === true ? 'Initial assessment declaration confirmed.' : 'Save and review the initial assessment before confirming this declaration.'}</Text>
        <FieldButton disabled={disabled || dirty || answers.initial_correct === true} onPress={() => void perform('attest', () => mutate('attest_initial', { action: 'attest_initial', scopeSha256: record!.signingScopes.before, accepted: true }))}>Confirm initial assessment declaration</FieldButton>
      </> : field.type === 'boolean' || field.type === 'select' ? <FieldSelect label={field.label} value={field.type === 'boolean' ? answers[field.key] === true ? 'yes' : answers[field.key] === false ? 'no' : '' : String(answers[field.key] ?? '')} disabled={disabled}
        options={field.type === 'boolean' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : field.options.map(option => ({ value: option, label: activityOptionLabel(option, field.optionLabels?.[option]) }))}
        onChange={value => edit(field.key, field.type === 'boolean' ? value === 'yes' : value)} />
        : field.type === 'date' ? <FieldDatePicker label={field.label} value={String(answers[field.key] || '')} disabled={disabled} onChange={value => edit(field.key, value)} />
          : field.type === 'photo' || field.type === 'document' ? <>
            {field.type === 'photo' ? <FieldButton variant="secondary" disabled={disabled || Boolean(pending)} onPress={() => void perform('camera', () => capture(field, true))}>Take evidence photo</FieldButton> : null}
            <FieldButton variant="secondary" disabled={disabled || Boolean(pending)} onPress={() => void perform('document', () => capture(field, false))}>Choose {field.type === 'photo' ? 'evidence photo' : 'document'}</FieldButton>
            {evidence.map(item => <FieldButton key={item.id} variant="quiet" disabled={Boolean(busy) || !online} onPress={() => void perform('file', () => saveFile('evidence', item.id))}>Save evidence · {item.fileName}</FieldButton>)}
          </> : <TextInput accessibilityLabel={field.label} value={String(answers[field.key] ?? '')} editable={!disabled} multiline={field.key.includes('notes')} keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'} style={styles.input}
            onChangeText={value => edit(field.key, field.type === 'number' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value)} />}
      {field.repeatGroup && field.repeatIndex === activityRepeatCount(record!.form, answers, field.repeatGroup) - 1 && fields.filter(item => item.repeatGroup === field.repeatGroup && item.repeatIndex === field.repeatIndex).at(-1)?.key === field.key ? <>
        <FieldButton variant="secondary" disabled={disabled || activityRepeatCount(record!.form, answers, field.repeatGroup) >= 20} onPress={() => edit(`$repeat.${field.repeatGroup}`, activityRepeatCount(record!.form, answers, field.repeatGroup!) + 1)}>Add another {activityRepeatItemLabel(field.repeatGroup)}</FieldButton>
        {field.repeatIndex > 0 ? <FieldButton variant="quiet" disabled={disabled} onPress={() => {
          const next = removeLastActivityRepeat(record!.form, current.current.answers, field.repeatGroup!);
          current.current.answers = next; setAnswers(next); setNotice('');
        }}>Remove last {activityRepeatItemLabel(field.repeatGroup)}</FieldButton> : null}
      </> : null}
    </View>;
  }
  function renderDeclaration(declaration: ActivityDeclaration) {
    if (!record) return null;
    const saved = record.signatures.find(item => item.declarationKey === declaration.key);
    const fieldKey = record.signerFields[declaration.key], signerName = fieldKey ? String(answers[fieldKey] || '').trim() : '';
    const draft = signatures[declaration.key] || freshSignature(declaration, signerName);
    const role: FieldWorkPackSignerRole = { roleKey: declaration.key, label: declaration.title, capacity: declaration.title,
      identitySource: declaration.role === 'customer' ? 'customer_context' : 'manual_verified', minimumSignatures: 1, maximumSignatures: 1, identityRequirements: [] };
    return <View key={declaration.key} style={styles.question}><Text style={styles.title}>{declaration.title}</Text>
      {saved ? <Text style={styles.help}>Signed by {saved.signerName} · {new Date(saved.signedAt).toLocaleString('en-AU')}</Text> : <>
        <Text style={styles.label}>{signerName || 'Enter the signer’s name in the assessment first.'}</Text>
        <Text style={styles.help}>{boundActivityDeclaration(declaration, answers)}</Text>
        {!signatureReady ? <Text style={styles.help}>Save and complete the required answers, evidence and initial declaration before signing.</Text> : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted[declaration.key] || false }} disabled={disabled || !signatureReady} onPress={() => setAccepted(previous => ({ ...previous, [declaration.key]: !previous[declaration.key] }))}>
          <Text style={styles.label}>{accepted[declaration.key] ? '☑' : '☐'} I am the named signer and have read and agree to this declaration.</Text>
        </Pressable>
        <SignatureCapture signerRole={role} declaration={boundActivityDeclaration(declaration, answers)} showDeclaration={false} value={draft} disabled={disabled || !signatureReady || !accepted[declaration.key] || !signerName} onChange={value => setSignatures(previous => ({ ...previous, [declaration.key]: value }))} />
        <FieldButton disabled={disabled || !signatureReady || !accepted[declaration.key] || !signerName || !activitySignatureStrokesAreValid(draft.strokes)} onPress={() => void perform('sign', async () => {
          if (!activitySignatureStrokesAreValid(draft.strokes)) throw new Error('Draw your actual signature before saving.');
          await mutate('sign', { action: 'sign', declarationKey: declaration.key, signerName, accepted: true, scopeSha256: record.signingScopes[declaration.phase], strokes: draft.strokes.map(stroke => ({ points: stroke.points.map(point => ({ x: point.x, y: point.y })) })) });
        })}>Save {declaration.role === 'customer' ? 'owner' : 'electrician'} signature</FieldButton>
      </>}
    </View>;
  }

  return <KeyboardAwareScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <FieldButton variant="secondary" disabled={Boolean(busy)} onPress={() => confirmLeave(onReturnToJob)}>Back to job</FieldButton>
    <Text style={styles.title}>Pre-installation electrical safety assessment (Insulation)</Text>
    {record ? <Text style={styles.help}>{record.recordNumber} · {record.status === 'complete' ? 'Completed' : dirty ? 'Unsaved answers' : 'Saved'}</Text> : null}
    {!online ? <Text style={styles.error}>Connect to save answers, upload evidence, sign or complete this assessment. Unsaved answers stay here while this screen remains open.</Text> : null}
    {loading ? <Text style={styles.help}>Loading the official assessment...</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}{notice ? <Text accessibilityLiveRegion="polite" style={styles.success}>{notice}</Text> : null}
    {!loading && online ? <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => void perform('refresh', () => refresh())}>Refresh saved assessment</FieldButton> : null}
    {record ? <>
      {!canManage && record.status === 'draft' ? <Text style={styles.help}>This assessment is view only for your current access.</Text> : null}
      <FieldSelect label="Assessment section" value={page} disabled={Boolean(busy)} options={pages.map(section => ({ value: section, label: section === 'signatures' ? 'Signatures' : section === 'review' ? 'Review and completion' : section }))} onChange={setPage} />
      {sections.includes(page) ? <><Text style={styles.title}>{page}</Text>{fields.filter(field => field.section === page).map(renderField)}{!fields.some(field => field.section === page) ? <Text style={styles.help}>This section does not apply to the saved assessment choices.</Text> : null}</> : page === 'signatures' ? declarations.map(renderDeclaration) : <>
        <Text style={styles.title}>{record.status === 'complete' ? 'Completed assessment' : record.ready && !dirty ? 'Ready to complete' : 'Still required'}</Text>
        {record.missing.map(item => <FieldButton key={`${item.kind}:${item.key}`} variant="quiet" disabled={Boolean(busy)} onPress={() => setPage(fields.find(field => field.key === item.key)?.section || 'signatures')}>{item.label}</FieldButton>)}
        {record.status === 'draft' ? <FieldButton disabled={disabled || dirty || Boolean(pending) || !record.ready} onPress={() => void perform('complete', async () => {
          await mutate('complete', { action: 'complete' });
          if (current.current.record?.status === 'complete') { try { await onChanged(); } catch { setNotice('Assessment completed and PDF retained. Refresh the job to update its progress.'); } }
        })}>{busy === 'complete' ? 'Completing and preparing PDF...' : 'Complete assessment and email PDF'}</FieldButton> : <>
          <FieldButton disabled={Boolean(busy) || !online} onPress={() => void perform('pdf', () => saveFile('pdf'))}>Save completed assessment PDF on phone</FieldButton>
          <Text style={styles.help}>The completed PDF is retained in this job&apos;s Files.</Text>
          {record.delivery.map(delivery => <View key={delivery.role} style={styles.question}><Text style={styles.label}>{delivery.role === 'customer' ? 'Customer copy' : 'Business copy'} · {delivery.status.replaceAll('_', ' ')}</Text><Text style={styles.help}>{delivery.message}</Text></View>)}
          {canManage && record.delivery.some(delivery => ['failed', 'blocked', 'queued'].includes(delivery.status)) ? <FieldButton variant="secondary" disabled={Boolean(busy) || !online} onPress={() => void perform('delivery', () => mutate('retry_delivery', { action: 'retry_delivery' }))}>Retry email delivery</FieldButton> : null}
        </>}
      </>}
      {pending ? <View style={styles.question}><Text style={styles.error}>This evidence is retained on your phone and still needs uploading: {pending.name}</Text><FieldButton disabled={disabled} onPress={() => void perform('upload', () => upload(pending))}>Retry evidence upload</FieldButton></View> : null}
      {record.status === 'draft' ? <FieldButton disabled={disabled || !dirty} onPress={() => void perform('save', save)}>{busy === 'save' ? 'Saving answers...' : 'Save answers'}</FieldButton> : null}
      <View style={styles.navigation}><FieldButton variant="secondary" disabled={Boolean(busy) || pages.indexOf(page) <= 0} onPress={() => setPage(pages[Math.max(0, pages.indexOf(page) - 1)])}>Previous</FieldButton>
        <FieldButton variant="secondary" disabled={Boolean(busy) || pages.indexOf(page) >= pages.length - 1 || !online && dirty} onPress={() => void perform('next', async () => { if (writable) await save(); if (current.current.alive) setPage(pages[Math.min(pages.length - 1, pages.indexOf(page) + 1)]); })}>Next section</FieldButton></View>
    </> : null}
  </KeyboardAwareScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md }, title: { color: colours.ink, fontSize: 21, fontWeight: '800' },
  label: { color: colours.ink, fontWeight: '700', fontSize: 16 }, help: { color: colours.muted, lineHeight: 22 },
  question: { paddingVertical: spacing.md, gap: spacing.sm, borderTopColor: colours.line, borderTopWidth: 1 },
  input: { minHeight: 50, padding: spacing.md, color: colours.ink, backgroundColor: colours.surfaceRaised, borderColor: colours.line, borderWidth: 1, borderRadius: radius.sm },
  error: { color: colours.red, lineHeight: 22 }, success: { color: colours.green, lineHeight: 22 }, navigation: { flexDirection: 'row', gap: spacing.md },
});
