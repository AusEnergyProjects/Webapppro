import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldButton } from '@/components/field-button';
import { FieldDatePicker } from '@/components/field-date-picker';
import { FieldSelect } from '@/components/field-select';
import { SignatureCapture } from '@/components/SignatureCapture';
import { apiRequest, ApiError } from '@/lib/api';
import { getSetting, setSetting } from '@/lib/database';
import { API_BASE_URL } from '@/lib/config';
import { observeLocation } from '@/lib/evidence';
import { activityBookingDocumentDeliveryState, activityCurrentSignatureKeys, activityOptionLabel, activityProgress, activitySectionProgress, activitySignerDefault, mergeActivityAnswers } from '@/lib/activity-field-wizard';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldWorkPackSignatureDraft, FieldWorkPackSignerRole } from '@/lib/types';
import type { ActivityAnswers, ActivityRecord } from '../../../src/lib/trade-activity-form-types';
import { activityBaseFieldKey, activityRepeatCount, boundActivityDeclaration, activityWizardSteps, type ExpandedActivityField } from '../../../src/lib/trade-activity-form-flow';

const endpoint = '/api/trade-activity-forms';
export type ActivityFieldSummary = { id: string; intentId: string; title: string; status: 'not_started' | ActivityRecord['status']; recordNumber: string; progress: { complete: number; total: number } };
type Presented = Omit<ActivityRecord, 'evidence'> & { evidence: Omit<ActivityRecord['evidence'][number], 'objectKey'>[]; missing: { key: string; label: string; kind: string }[]; signerDefaults: { technician: string; customer: string } };
type CaptureMetadata = { capturedAt: string; latitude: number | null; longitude: number | null; accuracy: number | null; metadataOrigin: 'device_capture' | 'file_upload'; locationObservedAt?: string; mocked?: boolean | null };
type PendingFile = { id: string; fieldKey: string; uri: string; name: string; contentType: string; metadata: CaptureMetadata };
type Cache = { record: Presented; answers: ActivityAnswers; pending: PendingFile[]; stepKey: string; camera?: { fieldKey: string; metadata: CaptureMetadata } };
type CustomerDocumentResult = {
  status: 'provider_accepted' | 'failed' | 'not_required' | 'unavailable';
  canRetry?: boolean;
  message: string;
  documents?: unknown[];
  acceptedAt?: string;
  documentIds?: string[];
  documentSha256Set?: string[];
};


function signatureDraft(role: string, name: string): FieldWorkPackSignatureDraft {
  return { signerRoleKey: role, signerName: name, signerCapacity: role, identity: {}, strokes: [], capturedAt: '' };
}

function rebaseUntouchedSignatureDraft(
  draft: FieldWorkPackSignatureDraft,
  role: string,
  previousDefault: string,
  nextDefault: string,
) {
  const currentName = draft.signerName.trim();
  if (draft.strokes.length > 0 || (currentName && currentName !== previousDefault.trim())) return draft;
  return signatureDraft(role, nextDefault);
}

function availableStepKey(record: Presented, answers: ActivityAnswers, requested = '') {
  const available = activityWizardSteps(record.form, answers);
  return available.some((item) => item.key === requested) ? requested : available[0]?.key || 'review';
}

function retainedActivityFileName(originalName: string, contentType: string) {
  const extension = contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : 'jpg';
  const baseName = originalName.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._ -]+/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'evidence';
  return `activity-${Crypto.randomUUID()}-${baseName}.${extension}`;
}

function derivedAnswerKeys(record: Presented) {
  return new Set(record.form.fields.filter((field) => field.presentation === 'derived').map((field) => field.key));
}

function reconcileAnswers(base: ActivityAnswers, local: ActivityAnswers, fresh: Presented) {
  return mergeActivityAnswers(base, local, fresh.answers, derivedAnswerKeys(fresh));
}

function ProgressMeter({ label, complete, total, compact = false }: { label: string; complete: number; total: number; compact?: boolean }) {
  const percent = total ? Math.round((complete / total) * 100) : 0;
  const width = `${Math.max(0, Math.min(100, percent))}%` as `${number}%`;
  return <View accessibilityLabel={total ? `${label}: ${complete} of ${total} complete` : `${label}: optional`} style={compact ? styles.compactProgress : styles.progress}>
    <View style={styles.progressLabels}><Text style={compact ? styles.small : styles.progressLabel}>{label}</Text><Text style={styles.small}>{total ? `${complete}/${total}` : 'Optional'}</Text></View>
    {total ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width }]} /></View> : null}
  </View>;
}

export function ActivityFieldFormWizard({ workOrderId, intentId, variantId = '', online, onReturnToJob, onChanged }: {
  workOrderId: string; intentId: string; variantId?: string; online: boolean; onReturnToJob: () => void; onChanged: () => Promise<void>;
}) {
  const [cache, setCache] = useState<Cache | null>(null);
  const cacheRef = useRef<Cache | null>(null);
  const writes = useRef(Promise.resolve());
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [customerDocumentResult, setCustomerDocumentResult] = useState<CustomerDocumentResult | null>(null);
  const [overview, setOverview] = useState(true);
  const [signature, setSignature] = useState<FieldWorkPackSignatureDraft>(signatureDraft('', ''));
  const [acknowledged, setAcknowledged] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const cacheKey = `activity-form:${workOrderId}:${intentId}`;
  const record = cache?.record;
  const steps = cache ? activityWizardSteps(cache.record.form, cache.answers) : [];
  const stepIndex = Math.max(0, steps.findIndex((item) => item.key === cache?.stepKey));
  const step = steps[stepIndex];
  const editable = record?.status === 'draft' && !conflict;
  const locked = step?.kind === 'field' && record?.signatures.some((item) => item.phase === 'after' || item.phase === step.field.phase);
  const currentSignature = step?.kind === 'signature' && !record?.missing.some((item) => item.kind === 'signature' && item.key === step.declaration.key)
    ? [...(record?.signatures || [])].reverse().find((item) => item.declarationKey === step.declaration.key)
    : undefined;

  function remember(value: Cache) {
    const previous = cacheRef.current;
    const target = activityWizardSteps(value.record.form, value.answers).find((item) => item.key === value.stepKey);
    if (previous?.stepKey !== value.stepKey) {
      setAcknowledged(false);
      if (target?.kind === 'signature') setSignature(signatureDraft(target.declaration.role, activitySignerDefault(value.record, target.declaration.role)));
    } else if (previous && target?.kind === 'signature') {
      const previousDefault = activitySignerDefault(previous.record, target.declaration.role);
      const nextDefault = activitySignerDefault(value.record, target.declaration.role);
      setSignature((current) => rebaseUntouchedSignatureDraft(current, target.declaration.role, previousDefault, nextDefault));
    }
    cacheRef.current = value; setCache(value);
    writes.current = writes.current.catch(() => undefined).then(() => setSetting(cacheKey, JSON.stringify(value)));
    return writes.current;
  }
  useEffect(() => {
    let disposed = false;
    void (async () => {
      let saved: Cache | null = null;
      try {
        const raw = await getSetting(cacheKey);
        saved = raw ? JSON.parse(raw) as Cache : null;
        if (disposed) return;
        if (saved) {
          await remember(saved);
          if (saved.camera) {
            const result = await ImagePicker.getPendingResultAsync();
            if (result && 'canceled' in result && !result.canceled && result.assets[0]) {
              const asset = result.assets[0];
              // Android can restore the asset without its exposure time. Keep it, but never invent a capture/GPS match from camera-launch time.
              await retainFile(saved.camera.fieldKey, asset.uri, asset.fileName || 'Recovered site photo.jpg', asset.mimeType || 'image/jpeg', { ...saved.camera.metadata, capturedAt: '' });
              saved = cacheRef.current;
            } else if (cacheRef.current) { await remember({ ...cacheRef.current, camera: undefined }); saved = cacheRef.current; }
          }
        }
        if (!online) { if (!saved) throw new Error('Connect once to load this activity form.'); return; }
        const response = await apiRequest<{ record: Presented }>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'open', workOrderId, intentId, variantId }) });
        if (disposed) return;
        const fresh = response.record;
        const reconciliation = saved
          ? reconcileAnswers(saved.record.answers, saved.answers, fresh)
          : { merged: fresh.answers, conflicts: [] as string[] };
        if (saved && reconciliation.conflicts.length) {
          setConflict(true);
          setError('Another person changed an answer you also changed. Your answers and photos are still on this phone. Resolve that edit before saving.');
        } else {
          const answers = reconciliation.merged;
          await remember({
            ...(saved || {}),
            record: fresh,
            answers,
            pending: saved?.pending || [],
            stepKey: availableStepKey(fresh, answers, saved?.stepKey),
          });
          setConflict(false);
        }
      } catch (caught) { if (!disposed) setError(caught instanceof Error ? caught.message : 'Could not load this form.'); }
      finally { if (!disposed) setBusy(''); }
    })();
    return () => { disposed = true; };
    // Load once per activity. Reconnection does not replace unsaved local answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId, intentId, variantId]);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [cache?.stepKey, overview]);
  usePreventRemove(true, () => {
    if (busy) {
      Alert.alert(busy === 'loading' ? 'Loading form' : 'Saving form', 'Wait for this action to finish.');
      return;
    }
    if (!overview) {
      setOverview(true);
      return;
    }
    void perform('leaving', leave);
  });

  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label); setError('');
    try { await action(); } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'ACTIVITY_ALREADY_SUBMITTED' && cacheRef.current) {
        try {
          const latest = cacheRef.current;
          await acceptResponse(latest, await latestRecord(latest.record.id));
          setConflict(false);
          setError('This form was submitted while it was open. The completed saved version is now shown.');
        } catch { setError('This form was submitted while it was open. Reopen it when you are connected.'); }
      } else if (caught instanceof ApiError && caught.code === 'ACTIVITY_REVISION_CONFLICT') {
        setConflict(true); setError('Another person changed this form while it was open. Your answers and photos remain on this phone. Resolve the concurrent edit before saving.');
      } else setError(caught instanceof Error ? caught.message : 'The action could not be completed. Your draft is retained.');
    }
    finally { setBusy(''); }
  }
  async function latestRecord(recordId: string) {
    const response = await apiRequest<{ record: Presented }>(`${endpoint}?recordId=${encodeURIComponent(recordId)}`);
    return response.record;
  }
  async function acceptResponse(snapshot: Cache, nextRecord: Presented) {
    const next: Cache = {
      ...snapshot,
      record: nextRecord,
      answers: nextRecord.answers,
      stepKey: availableStepKey(nextRecord, nextRecord.answers, snapshot.stepKey),
    };
    await remember(next);
    return nextRecord;
  }
  async function request(action: string, body: Record<string, unknown> = {}) {
    const latest = cacheRef.current;
    if (!latest || !online) throw new Error('Reconnect to save this action. Your draft stays on this phone.');
    try {
      const response = await apiRequest<{ record: Presented }>(endpoint, { method: 'POST', body: JSON.stringify({ action, recordId: latest.record.id, expectedRevision: latest.record.revision, ...body }) });
      return acceptResponse(latest, response.record);
    } catch (caught) {
      if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_REVISION_CONFLICT' || action !== 'save') throw caught;
      const fresh = await latestRecord(latest.record.id);
      const reconciliation = reconcileAnswers(latest.record.answers, latest.answers, fresh);
      if (reconciliation.conflicts.length) {
        setConflict(true);
        throw new Error('Another person changed an answer you also changed. Your answer is still on this phone. Resolve the concurrent edit before continuing.');
      }
      const reconciled: Cache = {
        ...latest,
        record: fresh,
        answers: reconciliation.merged,
        stepKey: availableStepKey(fresh, reconciliation.merged, latest.stepKey),
      };
      await remember(reconciled);
      const response = await apiRequest<{ record: Presented }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action, recordId: fresh.id, expectedRevision: fresh.revision, ...body, answers: reconciliation.merged }),
      });
      setConflict(false);
      return acceptResponse(reconciled, response.record);
    }
  }
  function answer(key: string, value: string | number | boolean) {
    if (!cacheRef.current) return;
    void remember({ ...cacheRef.current, answers: { ...cacheRef.current.answers, [key]: value } }).catch(() => setError('Could not save the draft on this phone. Keep this form open and reconnect.'));
  }
  async function saveAnswers() {
    const latest = cacheRef.current;
    if (!latest || JSON.stringify(latest.answers) === JSON.stringify(latest.record.answers)) return;
    await request('save', { answers: latest.answers });
  }
  async function retainFile(fieldKey: string, uri: string, name: string, contentType: string, metadata: CaptureMetadata) {
    if (!cacheRef.current) return;
    const file = new File(uri);
    if (file.size > 8 * 1024 * 1024) throw new Error('This original file exceeds 8 MB. Choose a smaller document or lower the camera resolution and retake it.');
    const kept = new File(Paths.document, retainedActivityFileName(name, contentType));
    await file.copy(kept);
    if (!kept.exists || kept.size < 5) throw new Error('The captured file could not be retained on this phone. Please take it again.');
    await remember({ ...cacheRef.current, camera: undefined, pending: [...cacheRef.current.pending, { id: Crypto.randomUUID(), fieldKey, uri: kept.uri, name, contentType, metadata }] });
  }
  async function capture(field: ExpandedActivityField) {
    await perform('camera', async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { Alert.alert('Camera permission', 'Allow camera access in Settings to photograph this item.', [{ text: 'Cancel' }, { text: 'Open Settings', onPress: () => void Linking.openSettings() }]); return; }
      const observed = await observeLocation(true);
      const location = observed.location;
      if (location.state !== 'captured' || location.mocked === true || location.accuracyMetres === null || location.accuracyMetres > 100) throw new Error('Enable precise location and wait for GPS before taking this evidence photo.');
      const metadata: CaptureMetadata = { capturedAt: new Date().toISOString(), latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracyMetres, metadataOrigin: 'device_capture', locationObservedAt: location.observedAtUtc, mocked: location.mocked };
      if (cacheRef.current) await remember({ ...cacheRef.current, camera: { fieldKey: field.key, metadata } });
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: true, allowsEditing: false, cameraType: ImagePicker.CameraType.back });
      if (result.canceled || !result.assets[0]) { if (cacheRef.current) await remember({ ...cacheRef.current, camera: undefined }); return; }
      const asset = result.assets[0];
      metadata.capturedAt = new Date().toISOString();
      await retainFile(field.key, asset.uri, asset.fileName || 'Site photo.jpg', asset.mimeType || 'image/jpeg', metadata);
      if (Date.now() - Date.parse(location.observedAtUtc) > 120000) setError('Photo retained. This GPS observation is over two minutes old; retake the photo with a current location before using it as site evidence.');
    });
  }
  async function chooseDocument(field: ExpandedActivityField) {
    await perform('document', async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      await retainFile(field.key, asset.uri, asset.name, asset.mimeType || 'application/pdf', { capturedAt: '', latitude: null, longitude: null, accuracy: null, metadataOrigin: 'file_upload' });
    });
  }
  async function uploadPending(fieldKey: string) {
    for (const pending of cacheRef.current?.pending.filter((item) => item.fieldKey === fieldKey) || []) {
      const latest = cacheRef.current;
      if (!latest || !online) throw new Error('Reconnect to upload these photos. The originals remain on this phone.');
      if (pending.metadata.metadataOrigin === 'device_capture' && (!pending.metadata.capturedAt || !pending.metadata.locationObservedAt || !Number.isFinite(Date.parse(pending.metadata.capturedAt)) || Math.abs(Date.parse(pending.metadata.capturedAt) - Date.parse(pending.metadata.locationObservedAt)) > 120000)) throw new Error('This photo has no current capture-location match. Its original remains on this phone. Remove it and retake it with location enabled.');
      const form = new FormData();
      form.append('action', 'upload'); form.append('recordId', latest.record.id); form.append('expectedRevision', String(latest.record.revision)); form.append('fieldKey', fieldKey);
      form.append('captureMetadata', JSON.stringify(pending.metadata)); form.append('clientUploadId', pending.id);
      const originalFile = new File(pending.uri);
      if (!originalFile.exists || originalFile.size < 5) throw new Error('This saved original is unavailable. Remove it and take the photo again.');
      form.append('file', originalFile);
      let previewUri = '';
      if (pending.contentType.startsWith('image/')) {
        for (const [width, compress] of [[1600, 0.75], [1280, 0.65], [1024, 0.55]]) {
          const context = ImageManipulator.manipulate(pending.uri);
          context.resize({ width });
          const rendered = await context.renderAsync();
          const preview = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
          const file = new File(preview.uri);
          if (file.size <= 1024 * 1024) { previewUri = preview.uri; break; }
          file.delete();
        }
        if (!previewUri) throw new Error('A report preview could not be prepared within its size limit. The original stays on this phone.');
        form.append('preview', new File(previewUri));
      }
      let response: { record: Presented };
      let uploadSnapshot = latest;
      try {
        response = await apiRequest<{ record: Presented }>(endpoint, { method: 'POST', body: form });
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_REVISION_CONFLICT') throw caught;
        const fresh = await latestRecord(latest.record.id);
        const reconciliation = reconcileAnswers(latest.record.answers, latest.answers, fresh);
        if (reconciliation.conflicts.length) {
          setConflict(true);
          throw new Error('Another person changed an answer while this evidence was uploading. The photo remains on this phone. Resolve the concurrent edit before retrying.');
        }
        uploadSnapshot = {
          ...latest,
          record: fresh,
          answers: reconciliation.merged,
          stepKey: availableStepKey(fresh, reconciliation.merged, latest.stepKey),
        };
        await remember(uploadSnapshot);
        form.set('expectedRevision', String(fresh.revision));
        response = await apiRequest<{ record: Presented }>(endpoint, { method: 'POST', body: form });
      }
      finally { if (previewUri) { const preview = new File(previewUri); if (preview.exists) preview.delete(); } }
      await remember({ ...uploadSnapshot, record: response.record, answers: response.record.answers, pending: uploadSnapshot.pending.filter((item) => item.id !== pending.id) });
      // Only remove this task's local copy after its server receipt is durably saved.
      const file = new File(pending.uri); if (file.exists) file.delete();
    }
  }
  async function move(delta: number) {
    const latest = cacheRef.current;
    if (!latest) return;
    const currentSteps = activityWizardSteps(latest.record.form, latest.answers);
    const index = Math.max(0, currentSteps.findIndex((item) => item.key === latest.stepKey));
    await remember({ ...latest, stepKey: currentSteps[Math.max(0, Math.min(currentSteps.length - 1, index + delta))].key });
  }
  async function next() {
    if (!step || !cache) return;
    await perform('next', async () => {
      if (!editable) { await move(1); return; }
      if (step.kind === 'field') {
        const value = cacheRef.current?.answers[step.field.key];
        if (step.field.required && !['photo', 'document'].includes(step.field.type) && (value === undefined || value === '')) throw new Error('Answer this question before continuing.');
        if (step.field.requiredValue !== undefined && value !== step.field.requiredValue) throw new Error('Complete this requirement before continuing. Your current answer remains saved on this phone.');
        if (online) { await saveAnswers(); await uploadPending(step.field.key); }
        const current = cacheRef.current;
        if (step.field.required && ['photo', 'document'].includes(step.field.type) && !current?.record.evidence.some((item) => item.fieldKey === step.field.key) && !current?.pending.some((item) => item.fieldKey === step.field.key)) throw new Error('Add the required evidence before continuing.');
      } else if (step.kind === 'signature' && !currentSignature) {
        if (!acknowledged) throw new Error('Confirm the declaration before signing.');
        await saveAnswers();
        const signerName = step.declaration.role === 'technician' ? cache.record.signerDefaults.technician : signature.signerName;
        await request('sign', { declarationKey: step.declaration.key, signerName, strokes: signature.strokes, acknowledged: true });
      }
      await move(1);
    });
  }
  async function resolveConcurrentEdit(useLocalAnswers: boolean) {
    const local = cacheRef.current;
    if (!local) return;
    const fresh = await latestRecord(local.record.id);
    const answers = mergeActivityAnswers(
      local.record.answers,
      local.answers,
      fresh.answers,
      derivedAnswerKeys(fresh),
      useLocalAnswers ? 'local' : 'remote',
    ).merged;
    if (JSON.stringify(answers) === JSON.stringify(fresh.answers)) {
      await remember({ ...local, record: fresh, answers, stepKey: availableStepKey(fresh, answers, local.stepKey) });
    } else {
      const response = await apiRequest<{ record: Presented }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action: 'save', recordId: fresh.id, expectedRevision: fresh.revision, answers }),
      });
      await acceptResponse({ ...local, record: fresh }, response.record);
    }
    setConflict(false);
    setError('');
  }
  async function resendCustomerDocuments() {
    setCustomerDocumentResult(null);
    await perform('customer-documents', async () => {
      const response = await apiRequest<{ customerDocuments?: CustomerDocumentResult }>('/api/trade-crm', {
        method: 'POST',
        body: JSON.stringify({ action: 'resend_activity_customer_documents', workOrderId }),
      });
      const result = response.customerDocuments;
      const hasDocumentResult = Array.isArray(result?.documents)
        || (Array.isArray(result?.documentIds) && Array.isArray(result?.documentSha256Set));
      if (!result || !['provider_accepted', 'failed', 'not_required', 'unavailable'].includes(result.status)
        || !hasDocumentResult || typeof result.message !== 'string' || !result.message.trim()) {
        throw new Error('TLink received an unreadable customer-document delivery result. Try again.');
      }
      setCustomerDocumentResult(result);
      if (result.status !== 'provider_accepted' || !cacheRef.current) return;
      const local = cacheRef.current;
      try {
        const fresh = await latestRecord(local.record.id);
        const reconciliation = reconcileAnswers(local.record.answers, local.answers, fresh);
        if (reconciliation.conflicts.length) {
          setConflict(true);
          setError('The customer documents were accepted for delivery. Another answer changed at the same time; resolve that edit before continuing.');
          return;
        }
        await remember({ ...local, record: fresh, answers: reconciliation.merged, stepKey: availableStepKey(fresh, reconciliation.merged, local.stepKey) });
      } catch {
        setError('The customer documents were accepted for delivery, but this form could not refresh the receipt. Reopen it when connected.');
      }
    });
  }
  async function leave() { await writes.current; await onChanged(); onReturnToJob(); }
  async function share() {
    await perform('share', async () => {
      if (!record) return;
      const response = await apiRequest<{ reportUrl: string }>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'share_report', recordId: record.id }) });
      await Share.share({ message: response.reportUrl, url: response.reportUrl });
    });
  }

  if (!record || !cache) return <View style={styles.body}><Text style={styles.title}>{busy ? 'Loading activity form…' : 'Activity form'}</Text>{error ? <Text style={styles.error}>{error}</Text> : null}<FieldButton variant="secondary" onPress={onReturnToJob}>Job</FieldButton></View>;
  const title = step?.kind === 'field' ? step.field.label : step?.kind === 'review' ? 'Review and submit' : step?.declaration.title || record.form.title;
  const pendingHere = step?.kind === 'field' ? cache.pending.filter((item) => item.fieldKey === step.field.key) : [];
  const savedHere = step?.kind === 'field' ? record.evidence.filter((item) => item.fieldKey === step.field.key) : [];
  const evidenceFieldKeys = new Set([...record.evidence.map((item) => item.fieldKey), ...cache.pending.map((item) => item.fieldKey)]);
  const signatureDeclarationKeys = activityCurrentSignatureKeys(record.signatures, record.missing);
  const overallProgress = activityProgress(steps, cache.answers, evidenceFieldKeys, signatureDeclarationKeys);
  const sections = activitySectionProgress(steps, cache.answers, evidenceFieldKeys);
  const customerDocumentDelivery = activityBookingDocumentDeliveryState(record.form.fields, cache.answers);
  const systemMissing = record.missing.filter((item) => record.form.fields
    .find((field) => field.key === activityBaseFieldKey(item.key))?.presentation === 'derived');
  const fieldMissing = record.missing.filter((item) => !systemMissing.includes(item));
  const currentSection = step?.kind === 'field' ? sections.find((item) => item.key === `${step.field.phase}:${step.field.section}`) : undefined;
  const currentField = step?.kind === 'field' ? step.field : undefined;
  const evidenceForLabels = currentField?.evidenceFor?.map((key) => record.form.fields.find((field) => field.key === key)?.label || key).filter(Boolean) || [];
  const technicianSignature = step?.kind === 'signature' && step.declaration.role === 'technician';
  const boundSignerName = technicianSignature ? record.signerDefaults.technician : signature.signerName;
  const boundSignature = technicianSignature && signature.signerName !== boundSignerName ? { ...signature, signerName: boundSignerName } : signature;
  const signerRole: FieldWorkPackSignerRole = { roleKey: signature.signerRoleKey, label: step?.kind === 'signature' ? step.declaration.role : 'Signer', capacity: signature.signerCapacity,
    identitySource: technicianSignature ? 'assigned_worker' : step?.kind === 'signature' && step.declaration.role === 'customer' ? 'customer_context' : 'manual_verified',
    minimumSignatures: 1, maximumSignatures: 1, identityRequirements: [] };
  return <View style={styles.container}>
    <View style={styles.header}><FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => { if (overview) void perform('leaving', leave); else setOverview(true); }}>{overview ? 'Job' : 'Back'}</FieldButton><View style={styles.flex}><Text numberOfLines={2} style={styles.small}>{record.form.title}</Text><Text style={styles.small}>{record.recordNumber} · {online ? 'Connected' : 'Draft on this phone'}</Text></View><FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => setOverview(!overview)}>{overview ? 'Continue' : 'Sections'}</FieldButton></View>
    <ScrollView ref={scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" scrollEnabled={true}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {conflict ? <FieldButton variant="secondary" onPress={() => Alert.alert('Resolve concurrent edit', 'Another person changed the same answer. Choose which saved answer to keep. Photos on this phone are retained either way.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use saved version', onPress: () => void perform('resolve', () => resolveConcurrentEdit(false)) },
        { text: 'Keep this phone', onPress: () => void perform('resolve', () => resolveConcurrentEdit(true)) },
      ])}>Resolve concurrent edit</FieldButton> : null}
      <ProgressMeter label="Form progress" complete={overallProgress.complete} total={overallProgress.total} />
      {overview ? <>
        <Text style={styles.title}>{record.form.title}</Text><Text style={styles.text}>Complete the questions, evidence and signatures, then submit to Creditex.</Text>
        {customerDocumentResult ? <View accessibilityLiveRegion="polite" style={['failed', 'unavailable'].includes(customerDocumentResult.status) ? styles.deliveryFailed : styles.deliveryResult}>
          <Text style={styles.text}>{customerDocumentResult.message}</Text>
        </View> : null}
        {customerDocumentDelivery.applicable && !customerDocumentDelivery.accepted ? <View style={styles.deliveryRecovery}>
          <Text style={styles.progressLabel}>Customer documents need attention</Text>
          <Text style={styles.small}>Send the required booking PDFs to the customer before they agree to the upgrade.</Text>
          {customerDocumentResult?.canRetry !== false ? <FieldButton disabled={!online || Boolean(busy)} loading={busy === 'customer-documents'} onPress={() => void resendCustomerDocuments()}>Resend customer documents</FieldButton> : null}
          {!online ? <Text style={styles.small}>Reconnect to send these documents.</Text> : null}
        </View> : null}
        {systemMissing.length ? <View style={styles.deliveryRecovery}>
          <Text style={styles.progressLabel}>Job or profile details need attention</Text>
          <Text style={styles.small}>TLink fills these automatically. Update the customer, business, assigned team member or job record in the portal, then reopen this form.</Text>
          <Text style={styles.text}>{systemMissing.map((item) => item.label).join(', ')}</Text>
        </View> : null}
        {(['before', 'after'] as const).map((phase) => <View key={phase} style={styles.group}><Text style={styles.section}>{phase === 'before' ? 'Before work' : 'Work and completion'}</Text>{sections.filter((section) => section.phase === phase).map((section) => <Pressable
          key={section.key}
          accessibilityRole="button"
          accessibilityLabel={`${section.label}, ${section.complete} of ${section.total} complete`}
          disabled={Boolean(busy)}
          onPress={() => { void remember({ ...cache, stepKey: section.firstStepKey }); setOverview(false); }}
          style={({ pressed }) => [styles.sectionCard, pressed && styles.pressed]}
        ><ProgressMeter compact label={section.label} complete={section.complete} total={section.total} /></Pressable>)}</View>)}
        <FieldButton variant="secondary" onPress={() => { void remember({ ...cache, stepKey: 'review' }); setOverview(false); }}>Review progress</FieldButton>
      </> : <>
        {currentSection ? <ProgressMeter compact label={currentSection.label} complete={currentSection.complete} total={currentSection.total} /> : null}
        <Text style={styles.small}>{step?.kind === 'field' ? `${step.field.section}${step.field.repeatGroup ? ` · Item ${step.field.repeatIndex + 1}` : ''}` : step?.kind === 'signature' ? 'Signature' : step?.kind === 'declaration' ? 'Declaration' : 'Final review'}</Text><Text style={styles.title}>{title}</Text>
        {step?.kind === 'field' ? <>
          {step.field.help ? <Text style={styles.text}>{step.field.help}</Text> : null}
          {(step.field.referenceDocuments || []).map((document) => { const url = new URL(document.url, API_BASE_URL).toString(); return <View key={url} style={styles.group}><Text style={styles.text}>{document.title}</Text><View style={styles.row}><FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy)} onPress={() => void perform('document', async () => { await Linking.openURL(url); })}>Open document</FieldButton><FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy)} onPress={() => void perform('document', async () => { await Share.share({ message: `${document.title}\n${url}`, url }); })}>Share copy</FieldButton></View></View>; })}
          {locked ? <Text style={styles.small}>These answers are retained with the signed declaration.</Text> : null}
          {currentField?.presentation === 'derived' ? <View style={styles.derived}><Text style={styles.text}>{cache.answers[step.field.key] === undefined || cache.answers[step.field.key] === '' ? 'Recorded automatically by TLink.' : String(cache.answers[step.field.key])}</Text><Text style={styles.small}>This value comes from the job, business, assigned team member or signature record.</Text></View> : step.field.type === 'boolean' ? <View style={styles.row}>{[true, false].map((value) => <Pressable key={String(value)} accessibilityRole="radio" accessibilityState={{ selected: cache.answers[step.field.key] === value }} disabled={!editable || locked || Boolean(busy)} onPress={() => answer(step.field.key, value)} style={[styles.choice, cache.answers[step.field.key] === value && styles.selected]}><Text style={styles.text}>{value ? 'Yes' : 'No'}</Text></Pressable>)}</View> : step.field.type === 'select' ? <FieldSelect label="Choose an answer" value={String(cache.answers[step.field.key] ?? '')} options={step.field.options.map((value) => ({ value, label: activityOptionLabel(value, currentField?.optionLabels?.[value]) }))} onChange={(value) => answer(step.field.key, value)} disabled={!editable || locked || Boolean(busy)} /> : ['photo', 'document'].includes(step.field.type) ? <>
            {evidenceForLabels.length ? <Text style={styles.evidenceBinding}>Evidence for: {evidenceForLabels.join(', ')}</Text> : null}
            <FieldButton disabled={!editable || locked || Boolean(busy)} loading={busy === 'camera' || busy === 'document'} onPress={() => step.field.type === 'photo' ? void capture(step.field) : void chooseDocument(step.field)}>{step.field.type === 'photo' ? 'Take photo' : 'Choose document'}</FieldButton>
            <Text style={styles.small}>{savedHere.length} saved · {pendingHere.length} ready to upload</Text>
            {savedHere.map((item) => <Text key={item.id} style={styles.text}>{item.fileName}{item.latitude !== null ? ` · ${item.latitude.toFixed(5)}, ${item.longitude?.toFixed(5)}` : ''}</Text>)}
            {pendingHere.map((item) => <View key={item.id} style={styles.group}>{item.contentType.startsWith('image/') ? <Image alt="Pending site evidence" accessibilityLabel="Pending site evidence" source={{ uri: item.uri }} style={styles.preview} resizeMode="contain" /> : null}<Text style={styles.small}>{item.name} · Original retained on this phone</Text><FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => Alert.alert('Remove pending file?', 'This file has not been submitted.', [{ text: 'Keep' }, { text: 'Remove', onPress: () => void perform('remove', async () => { await remember({ ...cache, pending: cache.pending.filter((file) => file.id !== item.id) }); const file = new File(item.uri); if (file.exists) file.delete(); }) }])}>Remove pending file</FieldButton></View>)}
          </> : step.field.type === 'date' ? <FieldDatePicker label="Choose date" value={String(cache.answers[step.field.key] ?? '')} disabled={!editable || locked || Boolean(busy)} onChange={(value) => answer(step.field.key, value)} /> : <TextInput accessibilityLabel={step.field.label} value={String(cache.answers[step.field.key] ?? '')} editable={editable && !locked && !busy} placeholder="Enter answer" placeholderTextColor={colours.muted} keyboardType={step.field.type === 'number' ? 'decimal-pad' : 'default'} style={styles.input} onChangeText={(value) => answer(step.field.key, step.field.type === 'number' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value)} />}
          {step.field.repeatGroup && !locked ? <FieldButton variant="quiet" disabled={!editable || Boolean(busy) || activityRepeatCount(record.form, cache.answers, step.field.repeatGroup) >= 20} onPress={() => { const group = step.field.repeatGroup!; answer(`$repeat.${group}`, activityRepeatCount(record.form, cache.answers, group) + 1); }}>Add another {step.field.repeatGroup.replaceAll('_', ' ')}</FieldButton> : null}
        </> : step?.kind === 'declaration' ? <><Text style={styles.small}>Declaration · Page {step.page + 1} of {step.pages}</Text><Text style={styles.declaration}>{step.text}</Text></> : step?.kind === 'signature' ? currentSignature ? <Text style={styles.text}>Signed by {currentSignature.signerName} on {new Date(currentSignature.signedAt).toLocaleString('en-AU')}.</Text> : <>
          <Text style={styles.small}>The signing date and time are recorded automatically when this signature is saved.</Text>
          {technicianSignature ? <View style={styles.derived}><Text style={styles.text}>{boundSignerName || 'Assigned technician profile name missing'}</Text><Text style={styles.small}>Technician identity comes from the active team member assigned to this job.</Text></View>
            : <TextInput accessibilityLabel="Signer's full name" value={signature.signerName} placeholder="Signer's full name" placeholderTextColor={colours.muted} editable={editable && !busy} style={styles.input} onChangeText={(signerName) => setSignature({ ...signature, signerName, strokes: [], capturedAt: '' })} />}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }} disabled={!editable || Boolean(busy)} onPress={() => setAcknowledged(!acknowledged)} style={styles.choice}><Text style={styles.text}>{acknowledged ? '☑' : '☐'} I have read and agree to the declaration shown on the preceding pages.</Text></Pressable>
          <SignatureCapture key={`${record.id}:${step.key}:${boundSignerName}`} signerRole={signerRole} declaration={boundActivityDeclaration(step.declaration, cache.answers)} showDeclaration={false} value={boundSignature} disabled={!editable || Boolean(busy) || (technicianSignature && !boundSignerName)} onChange={setSignature} />
        </> : <>
          <Text style={styles.text}>{record.status === 'submitted_for_creditex_review' ? 'Submitted to Creditex. The completed record is saved with this job.' : `${record.missing.length} required item${record.missing.length === 1 ? '' : 's'} remaining.`}</Text>
          {systemMissing.length ? <Text style={styles.error}>TLink is missing system details: {systemMissing.map((item) => item.label).join(', ')}. Update the related portal record and reopen this form.</Text> : null}
          {fieldMissing.slice(0, 8).map((item) => <FieldButton key={item.key} variant="secondary" onPress={() => { const target = steps.find((entry) => entry.key === item.key || (entry.kind === 'declaration' && entry.declaration.key === item.key)); if (target) void remember({ ...cache, stepKey: target.kind === 'signature' ? `${target.declaration.key}:read:0` : target.key }); }}>{item.label}</FieldButton>)}
          {fieldMissing.length > 8 ? <Text style={styles.small}>{fieldMissing.length - 8} more questions will follow.</Text> : null}
          {cache.pending.length ? <FieldButton disabled={!online || Boolean(busy)} onPress={() => void perform('upload', async () => { await saveAnswers(); for (const key of new Set(cache.pending.map((item) => item.fieldKey))) await uploadPending(key); })}>Upload {cache.pending.length} pending files</FieldButton> : null}
          {record.status === 'draft' ? <FieldButton disabled={!editable || !online || Boolean(busy) || cache.pending.length > 0} loading={busy === 'submit'} onPress={() => void perform('submit', async () => { await saveAnswers(); await request('submit'); await onChanged(); })}>Submit completed form to Creditex</FieldButton> : <><FieldButton disabled={!online || Boolean(busy)} onPress={() => void share()}>Share completed report</FieldButton><FieldButton variant="secondary" onPress={() => void perform('revoke', async () => { await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ action: 'revoke_report', recordId: record.id }) }); setError('Previous report links have been revoked.'); })}>Revoke report links</FieldButton></>}
        </>}
      </>}
    </ScrollView>
    {!overview ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}><FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy) || stepIndex === 0} onPress={() => void move(-1)}>Previous</FieldButton><FieldButton style={styles.flex} disabled={Boolean(busy) || step?.kind === 'review' || (technicianSignature && !boundSignerName)} loading={busy === 'next'} onPress={() => void next()}>{step?.kind === 'signature' && !currentSignature ? 'Save signature' : 'Next'}</FieldButton></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.cream }, flex: { flex: 1 }, body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderBottomWidth: 1, borderColor: colours.line },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderColor: colours.line, backgroundColor: colours.surface },
  title: { color: colours.ink, fontSize: 23, fontWeight: '800' }, text: { color: colours.ink, fontSize: 16, lineHeight: 23 }, small: { color: colours.muted, fontSize: 12, lineHeight: 18 },
  section: { color: colours.green, fontSize: 17, fontWeight: '700' }, group: { gap: spacing.sm }, row: { flexDirection: 'row', gap: spacing.sm },
  progress: { gap: spacing.xs, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colours.surface }, compactProgress: { flex: 1, gap: spacing.xs },
  progressLabels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }, progressLabel: { color: colours.ink, fontSize: 14, fontWeight: '700' },
  progressTrack: { height: 6, overflow: 'hidden', borderRadius: 999, backgroundColor: colours.line }, progressFill: { height: '100%', borderRadius: 999, backgroundColor: colours.green },
  sectionCard: { minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.green, backgroundColor: colours.surfaceRaised },
  error: { color: colours.red, fontSize: 15, lineHeight: 22 }, input: { color: colours.ink, fontSize: 18, minHeight: 54, padding: spacing.md, backgroundColor: colours.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.line },
  choice: { flexGrow: 1, minHeight: 56, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.surfaceRaised }, selected: { borderColor: colours.green, backgroundColor: colours.mintStrong },
  declaration: { color: colours.ink, fontSize: 16, lineHeight: 25 }, preview: { width: '100%', height: 170, borderRadius: radius.sm },
  derived: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.surfaceRaised },
  evidenceBinding: { color: colours.green, fontSize: 14, fontWeight: '700' }, pressed: { opacity: 0.72 },
  deliveryRecovery: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.green, backgroundColor: colours.surfaceRaised },
  deliveryResult: { padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.green, backgroundColor: colours.mint },
  deliveryFailed: { padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.red, backgroundColor: colours.redSoft },
});
