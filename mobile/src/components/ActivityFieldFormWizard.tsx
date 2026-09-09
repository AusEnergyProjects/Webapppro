import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldButton } from '@/components/field-button';
import { FieldDatePicker } from '@/components/field-date-picker';
import { FieldSelect } from '@/components/field-select';
import { ActivityAssignmentReview } from '@/components/ActivityAssignmentReview';
import { SignatureCapture } from '@/components/SignatureCapture';
import { apiRequest, ApiError } from '@/lib/api';
import { processActivityFormCompletionQueue } from '@/lib/activity-form-completion';
import { getSetting, setSetting } from '@/lib/database';
import { API_BASE_URL } from '@/lib/config';
import { observeLocation } from '@/lib/evidence';
import { activityCurrentSignatureKeys, activityOptionLabel, activityProgress, activitySectionProgress, activitySignerDefault, mergeActivityAnswers } from '@/lib/activity-field-wizard';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldWorkPackSignatureDraft, FieldWorkPackSignerRole } from '@/lib/types';
import type { ActivityAnswers, ActivityRecord } from '../../../src/lib/trade-activity-form-types';
import { activityBaseFieldKey, activityRepeatCount, activityRepeatItemLabel, activityRepeatKey, boundActivityDeclaration, removeLastActivityRepeat, activityWizardSteps, activityWizardPages, activityWizardPageForStepKey, type ExpandedActivityField } from '../../../src/lib/trade-activity-form-flow';

const endpoint = '/api/trade-activity-forms';
export type ActivityFieldSummary = { id: string; intentId: string; title: string; status: 'not_started' | ActivityRecord['status']; lifecycleStatus?: 'unscheduled' | 'scheduled' | 'partial' | 'completed' | 'audited' | 'cancelled'; recordNumber: string; progress: { complete: number; total: number } };
type Presented = Omit<ActivityRecord, 'evidence'> & { evidence: Omit<ActivityRecord['evidence'][number], 'objectKey'>[]; missing: { key: string; label: string; kind: string }[]; signerDefaults: { technician: string; customer: string }; signingScopes?: { before: string; after: string }; signerSetup?: { firstName: string; lastName: string; canSave: boolean; firstNameLocked?: boolean; lastNameLocked?: boolean } };
type CaptureMetadata = { capturedAt: string; latitude: number | null; longitude: number | null; accuracy: number | null; metadataOrigin: 'device_capture' | 'file_upload'; locationObservedAt?: string; mocked?: boolean | null };
type PendingFile = { id: string; fieldKey: string; uri: string; name: string; contentType: string; metadata: CaptureMetadata };
type PendingSignature = { declarationKey: string; declarationText: string; phase: 'before' | 'after'; role: 'customer' | 'technician' | 'other'; signerName: string; strokes: FieldWorkPackSignatureDraft['strokes'] };
type Cache = { record: Presented; answers: ActivityAnswers; pending: PendingFile[]; pendingSignatures?: PendingSignature[]; stepKey: string; camera?: { fieldKey: string; metadata: CaptureMetadata }; finishRequested?: boolean; finishError?: string };
type ApprovedProductOption = { value: string; label: string; count: number };

function pendingSignatureToSync(
  pending: readonly PendingSignature[],
  requiredBeforeDeclarationKeys: ReadonlySet<string>,
  currentSignatureKeys: ReadonlySet<string>,
) {
  const before = pending.find((item) => item.phase === 'before');
  if (before) return before;
  if ([...requiredBeforeDeclarationKeys].some((key) => !currentSignatureKeys.has(key))) return undefined;
  return pending.find((item) => item.phase === 'after');
}

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

function streamlinedActivityPages(source: ReturnType<typeof activityWizardPages>) {
  const fieldPages = source.filter((page) => page.kind === 'fields');
  const signaturePages: ReturnType<typeof activityWizardPages> = [];
  const signerPageIndexes = new Map<string, number>();
  const review = source.find((page) => page.kind === 'review');
  for (const page of source) {
    if (page.kind !== 'signature') continue;
    if (!['customer', 'technician'].includes(page.declaration.role)) {
      signaturePages.push(page);
      continue;
    }
    const existingIndex = signerPageIndexes.get(page.declaration.role);
    if (existingIndex === undefined) {
      signerPageIndexes.set(page.declaration.role, signaturePages.length);
      signaturePages.push(page);
      continue;
    }
    const existing = signaturePages[existingIndex];
    if (existing?.kind !== 'signature') continue;
    signaturePages[existingIndex] = {
      ...existing,
      legacyStepKeys: [...new Set([...existing.legacyStepKeys, ...page.legacyStepKeys])],
    };
  }
  return [...fieldPages, ...signaturePages, ...(review ? [review] : [])];
}

function availableStepKey(record: Presented, answers: ActivityAnswers, requested = '') {
  const available = streamlinedActivityPages(activityWizardPages(record.form, answers));
  return activityWizardPageForStepKey(available, requested)?.key || available[0]?.key || 'review';
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

function signingUserContentChanged(previous: Presented, fresh: Presented, phase: 'before' | 'after') {
  if (previous.formSha256 !== fresh.formSha256) return true;
  const fields = previous.form.fields.filter((field) => field.presentation !== 'derived'
    && (phase === 'after' || field.phase === 'before'));
  const keys = new Set(fields.map((field) => field.key));
  const repeatGroups = new Set(fields.map((field) => field.repeatGroup).filter(Boolean));
  const answers = (record: Presented) => Object.fromEntries(Object.entries(record.answers)
    .filter(([key]) => keys.has(activityBaseFieldKey(key)) || (key.startsWith('$repeat.') && repeatGroups.has(key.slice('$repeat.'.length)))));
  const evidence = (record: Presented) => record.evidence.filter((item) => keys.has(activityBaseFieldKey(item.fieldKey)))
    .map((item) => ({ id: item.id, fieldKey: item.fieldKey, sha256: item.sha256 })).sort((a, b) => a.id.localeCompare(b.id));
  const beforeSignatures = (record: Presented) => phase === 'after' ? record.signatures.filter((item) => item.phase === 'before')
    .map((item) => ({ id: item.id, declarationSha256: item.declarationSha256, scopeSha256: item.scopeSha256 })).sort((a, b) => a.id.localeCompare(b.id)) : [];
  return JSON.stringify(answers(previous)) !== JSON.stringify(answers(fresh))
    || JSON.stringify(evidence(previous)) !== JSON.stringify(evidence(fresh))
    || JSON.stringify(beforeSignatures(previous)) !== JSON.stringify(beforeSignatures(fresh));
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
  const syncs = useRef(Promise.resolve());
  const syncWorkerRunning = useRef(false);
  const pendingSyncKeys = useRef(new Set<string>());
  const pendingFullUpload = useRef(false);
  const actionRunning = useRef(false);
  const moving = useRef(false);
  const [busy, setBusy] = useState('loading');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(true);
  const [signature, setSignature] = useState<FieldWorkPackSignatureDraft>(signatureDraft('', ''));
  const [acknowledged, setAcknowledged] = useState(false);
  const [readingDeclaration, setReadingDeclaration] = useState(false);
  const [signingName, setSigningName] = useState<{ firstName: string; lastName: string } | null>(null);
  const [approvedBrands, setApprovedBrands] = useState<ApprovedProductOption[]>([]);
  const [approvedModels, setApprovedModels] = useState<Record<string, ApprovedProductOption[]>>({});
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const scroll = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const cacheKey = `activity-form:${workOrderId}:${intentId}`;
  const record = cache?.record;
  const steps = cache ? activityWizardSteps(cache.record.form, cache.answers) : [];
  const pages = cache ? streamlinedActivityPages(activityWizardPages(cache.record.form, cache.answers)) : [];
  const stepIndex = Math.max(0, pages.findIndex((item) => item.key === cache?.stepKey));
  const step = pages[stepIndex];
  const editable = record?.status === 'draft';
  const signatureDeclarations = step?.kind === 'signature' && record
    ? step.legacyStepKeys.flatMap((key) => {
      const declaration = record.form.declarations.find((item) => item.key === key);
      return declaration ? [declaration] : [];
    })
    : [];
  const currentSignatureKeys = record ? activityCurrentSignatureKeys(record.signatures, record.missing) : new Set<string>();
  const pendingSignatureKeys = new Set((cache?.pendingSignatures || []).map((item) => item.declarationKey));
  const signatureGroupCurrent = signatureDeclarations.length > 0
    && signatureDeclarations.every((declaration) => currentSignatureKeys.has(declaration.key));
  const signatureGroupRetained = signatureDeclarations.length > 0
    && signatureDeclarations.every((declaration) => currentSignatureKeys.has(declaration.key) || pendingSignatureKeys.has(declaration.key));
  const currentSignature = step?.kind === 'signature' && signatureGroupCurrent
    ? [...(record?.signatures || [])].reverse().find((item) => step.legacyStepKeys.includes(item.declarationKey))
    : undefined;
  const pendingSignature = step?.kind === 'signature' && !currentSignature && signatureGroupRetained
    ? cache?.pendingSignatures?.find((item) => step.legacyStepKeys.includes(item.declarationKey))
    : undefined;
  const approvedBrandFieldKeys = new Set(record?.form.fields
    .filter((field) => field.approvedProduct?.role === 'brand').map((field) => field.key) || []);
  const hasApprovedProductSelector = approvedBrandFieldKeys.size > 0
    && Boolean(record?.form.fields.some((field) => field.approvedProduct?.role === 'model'));
  const selectedApprovedBrands = [...new Set(Object.entries(cache?.answers || {})
    .filter(([key, value]) => approvedBrandFieldKeys.has(activityBaseFieldKey(key)) && typeof value === 'string' && value.trim())
    .map(([, value]) => String(value)))];
  const selectedApprovedBrandsKey = selectedApprovedBrands.sort().join('\u0000');
  const approvedProductInstallationDate = String(cache?.answers['customer_property.installation_date'] || '');

  function remember(value: Cache) {
    const previous = cacheRef.current;
    const target = activityWizardPageForStepKey(streamlinedActivityPages(activityWizardPages(value.record.form, value.answers)), value.stepKey);
    value = { ...value, stepKey: target?.key || 'review' };
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
        {
          const answers = reconciliation.merged;
          const addedSelfie = fresh.form.fields.find((field) => field.section === 'Start of job' && field.type === 'photo'
            && !saved?.record.form.fields.some((previous) => previous.key === field.key));
          await remember({
            ...(saved || {}),
            record: fresh,
            answers,
            pending: saved?.pending || [],
            pendingSignatures: saved?.pendingSignatures || [],
            stepKey: availableStepKey(fresh, answers, addedSelfie?.key || saved?.stepKey),
          });
          if (online && saved?.pendingSignatures?.length) queuePageSync([], true);
        }
      } catch (caught) { if (!disposed) setError(caught instanceof Error ? caught.message : 'Could not load this form.'); }
      finally { if (!disposed) setBusy(''); }
    })();
    return () => { disposed = true; };
    // Load once per activity. Reconnection does not replace unsaved local answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId, intentId, variantId]);
  useEffect(() => {
    if (online && cacheRef.current) queuePageSync([], true);
    // Connectivity is the retry trigger; the queue reads the current cache itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);
  useEffect(() => {
    const recordId = record?.id;
    if (!online || !recordId || !hasApprovedProductSelector || !approvedProductInstallationDate) return;
    let disposed = false;
    const selectedBrands = selectedApprovedBrandsKey ? selectedApprovedBrandsKey.split('\u0000') : [];
    void (async () => {
      setProductsLoading(true);
      setProductsError('');
      try {
        const results = await Promise.all(['', ...selectedBrands].map(async (brand) => {
          const query = new URLSearchParams({ recordId, view: 'official_products' });
          if (brand) query.set('brand', brand);
          const response = await apiRequest<{ brands: ApprovedProductOption[]; models: ApprovedProductOption[] }>(`${endpoint}?${query.toString()}`);
          return { brand, response };
        }));
        if (disposed) return;
        const root = results.find((result) => !result.brand)?.response;
        setApprovedBrands(root?.brands || []);
        setApprovedModels(Object.fromEntries(results.filter((result) => result.brand).map((result) => [result.brand, result.response.models || []])));
      } catch (caught) {
        if (!disposed) setProductsError(caught instanceof Error ? caught.message : 'Approved products could not be loaded.');
      } finally {
        if (!disposed) setProductsLoading(false);
      }
    })();
    return () => { disposed = true; };
  }, [online, record?.id, hasApprovedProductSelector, approvedProductInstallationDate, selectedApprovedBrandsKey]);
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
    if (busy || actionRunning.current) return;
    actionRunning.current = true;
    setBusy(label); setError('');
    try { await action(); } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'ACTIVITY_ALREADY_SUBMITTED' && cacheRef.current) {
        try {
          const latest = cacheRef.current;
          await acceptResponse(latest, await latestRecord(latest.record.id));
          setError('This form was submitted while it was open. The completed saved version is now shown.');
        } catch { setError('This form was submitted while it was open. Reopen it when you are connected.'); }
      } else if (caught instanceof ApiError && ['ACTIVITY_REVISION_CONFLICT', 'ACTIVITY_SIGNING_SCOPE_CHANGED'].includes(caught.code)) {
        const local = cacheRef.current;
        if (local) {
          try {
            const fresh = await latestRecord(local.record.id);
            const answers = reconcileAnswers(local.record.answers, local.answers, fresh).merged;
            await remember({ ...local, record: fresh, answers, stepKey: availableStepKey(fresh, answers, local.stepKey) });
          } catch {
            setError('Reconnect to continue saving. Your answers and photos remain on this phone.');
            return;
          }
        }
        if (caught.code === 'ACTIVITY_SIGNING_SCOPE_CHANGED') {
          setSignature((current) => ({ ...current, strokes: [], capturedAt: '' }));
          setAcknowledged(false);
          setError(caught.message);
        } else setError('TLink loaded the latest saved details automatically.');
      } else setError(caught instanceof Error ? caught.message : 'The action could not be completed. Your draft is retained.');
    }
    finally { actionRunning.current = false; setBusy(''); }
  }
  async function latestRecord(recordId: string) {
    const response = await apiRequest<{ record: Presented }>(`${endpoint}?recordId=${encodeURIComponent(recordId)}`);
    return response.record;
  }
  async function acceptResponse(snapshot: Cache, nextRecord: Presented) {
    const current = cacheRef.current?.record.id === snapshot.record.id ? cacheRef.current : snapshot;
    const answers = mergeActivityAnswers(snapshot.answers, current.answers, nextRecord.answers, derivedAnswerKeys(nextRecord)).merged;
    const next: Cache = {
      ...current,
      record: nextRecord,
      answers,
      stepKey: availableStepKey(nextRecord, answers, current.stepKey),
    };
    await remember(next);
    return next;
  }
  async function request(action: string, body: Record<string, unknown> = {}): Promise<Cache> {
    const initial = cacheRef.current;
    if (!initial || !online) throw new Error('Reconnect to save this action. Your draft stays on this phone.');
    let latest: Cache = initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await apiRequest<{ record: Presented }>(endpoint, { method: 'POST', body: JSON.stringify({ action, recordId: latest.record.id, expectedRevision: latest.record.revision,
          ...body, ...(action === 'save' ? { answers: latest.answers, baseAnswers: latest.record.answers } : {}) }) });
        return acceptResponse(latest, response.record);
      } catch (caught) {
        const retryRevision = action === 'save' || action === 'submit';
        if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_REVISION_CONFLICT' || !retryRevision || attempt === 2) throw caught;
        const fresh = await latestRecord(latest.record.id);
        if (fresh.status === 'submitted_for_creditex_review') return acceptResponse(latest, fresh);
        const cached = cacheRef.current;
        const current: Cache = cached?.record.id === latest.record.id ? cached : latest;
        const reconciliation = reconcileAnswers(latest.record.answers, current.answers, fresh);
        latest = {
          ...current,
          record: fresh,
          answers: reconciliation.merged,
          stepKey: availableStepKey(fresh, reconciliation.merged, current.stepKey),
        };
        await remember(latest);
        if (action === 'submit' && JSON.stringify(latest.answers) !== JSON.stringify(fresh.answers)) {
          latest = await request('save');
          if (latest.record.status === 'submitted_for_creditex_review') return latest;
        }
      }
    }
    throw new Error('The activity form could not be saved.');
  }
  function answer(key: string, value: string | number | boolean) {
    if (!cacheRef.current) return;
    void remember({ ...cacheRef.current, answers: { ...cacheRef.current.answers, [key]: value } }).catch(() => setError('Could not save the draft on this phone. Keep this form open and reconnect.'));
  }
  function answerApprovedBrand(field: ExpandedActivityField, value: string) {
    const latest = cacheRef.current;
    if (!latest) return;
    const answers = { ...latest.answers, [field.key]: value };
    for (const modelField of latest.record.form.fields.filter((candidate) => candidate.approvedProduct?.role === 'model'
      && candidate.approvedProduct.brandFieldKey === field.baseKey)) {
      delete answers[activityRepeatKey(modelField.key, field.repeatIndex)];
    }
    void remember({ ...latest, answers }).catch(() => setError('Could not save the approved product on this phone. Keep this form open and try again.'));
  }
  async function saveAnswers() {
    const latest = cacheRef.current;
    if (!latest || JSON.stringify(latest.answers) === JSON.stringify(latest.record.answers)) return;
    await request('save', { answers: latest.answers });
  }
  async function syncPendingSignatures() {
    while (true) {
      const snapshot = cacheRef.current;
      if (!snapshot) return;
      const requiredBeforeDeclarationKeys = new Set(activityWizardPages(snapshot.record.form, snapshot.answers)
        .flatMap((page) => page.kind === 'signature' && page.declaration.phase === 'before' && page.declaration.required
          ? [page.declaration.key] : []));
      const serverSignatureKeys = activityCurrentSignatureKeys(snapshot.record.signatures, snapshot.record.missing);
      const queued = pendingSignatureToSync(snapshot.pendingSignatures || [], requiredBeforeDeclarationKeys, serverSignatureKeys);
      if (!queued) return;
      let latest = snapshot;
      const record = latest.record;
      const declaration = record.form.declarations.find((item) => item.key === queued.declarationKey);
      if (!declaration) throw new Error('This declaration changed. Open its signature section and sign it again.');
      if (record.signatures.some((item) => item.declarationKey === queued.declarationKey
        && !record.missing.some((missing) => missing.kind === 'signature' && missing.key === queued.declarationKey))) {
        await remember({ ...latest, pendingSignatures: (latest.pendingSignatures || []).filter((item) => item.declarationKey !== queued.declarationKey) });
        continue;
      }
      if (boundActivityDeclaration(declaration, latest.answers) !== queued.declarationText) throw new Error('This declaration changed. Open its signature section and sign it again.');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = cacheRef.current;
        if (!current) return;
        latest = current;
        try {
          await request('sign', { declarationKey: queued.declarationKey,
            signerName: queued.role === 'technician' ? latest.record.signerDefaults.technician : queued.signerName,
            strokes: queued.strokes, acknowledged: true,
            ...(latest.record.signingScopes?.[queued.phase] ? { expectedScope: latest.record.signingScopes[queued.phase] } : {}) });
          const accepted = cacheRef.current;
          if (accepted) await remember({ ...accepted, pendingSignatures: (accepted.pendingSignatures || []).filter((item) => item.declarationKey !== queued.declarationKey) });
          break;
        } catch (caught) {
          if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_SIGNING_SCOPE_CHANGED' || attempt === 1) throw caught;
          const fresh = await latestRecord(latest.record.id);
          if (signingUserContentChanged(latest.record, fresh, queued.phase)) throw caught;
          const current = cacheRef.current?.record.id === latest.record.id ? cacheRef.current : latest;
          const answers = reconcileAnswers(latest.record.answers, current.answers, fresh).merged;
          if (boundActivityDeclaration(declaration, answers) !== queued.declarationText) throw caught;
          await remember({ ...current, record: fresh, answers, stepKey: availableStepKey(fresh, answers, current.stepKey) });
        }
      }
    }
  }
  function queuePageSync(fieldKeys: readonly string[], flushAllPending = false) {
    for (const key of fieldKeys) pendingSyncKeys.current.add(key);
    pendingFullUpload.current ||= flushAllPending;
    if (syncWorkerRunning.current || !online) return;
    syncWorkerRunning.current = true;
    syncs.current = (async () => {
      setSyncing(true);
      try {
        do {
          const uploadEverything = pendingFullUpload.current;
          const queuedKeys = [...pendingSyncKeys.current];
          pendingFullUpload.current = false;
          pendingSyncKeys.current.clear();
          try {
            await saveAnswers();
            const uploadKeys = uploadEverything
              ? [...new Set(cacheRef.current?.pending.map((item) => item.fieldKey) || [])]
              : queuedKeys;
            for (const fieldKey of uploadKeys) await uploadPending(fieldKey);
            await syncPendingSignatures();
          } catch {
            for (const key of queuedKeys) pendingSyncKeys.current.add(key);
            pendingFullUpload.current ||= uploadEverything;
            break;
          }
        } while (pendingFullUpload.current || pendingSyncKeys.current.size);
      } finally {
        syncWorkerRunning.current = false;
        setSyncing(false);
      }
    })();
  }
  async function waitForBackgroundSync() {
    let pending = syncs.current;
    await pending;
    while (pending !== syncs.current) {
      pending = syncs.current;
      await pending;
    }
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
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: true, allowsEditing: false, cameraType: /selfie/i.test(field.key) ? ImagePicker.CameraType.front : ImagePicker.CameraType.back });
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
        const cached = cacheRef.current;
        const current: Cache = cached?.record.id === latest.record.id ? cached : latest;
        const reconciliation = reconcileAnswers(latest.record.answers, current.answers, fresh);
        uploadSnapshot = {
          ...current,
          record: fresh,
          answers: reconciliation.merged,
          stepKey: availableStepKey(fresh, reconciliation.merged, current.stepKey),
        };
        await remember(uploadSnapshot);
        form.set('expectedRevision', String(fresh.revision));
        response = await apiRequest<{ record: Presented }>(endpoint, { method: 'POST', body: form });
      }
      finally { if (previewUri) { const preview = new File(previewUri); if (preview.exists) preview.delete(); } }
      await acceptResponse(uploadSnapshot, response.record);
      const accepted = cacheRef.current;
      if (accepted) await remember({ ...accepted, pending: accepted.pending.filter((item) => item.id !== pending.id) });
      // Only remove this task's local copy after its server receipt is durably saved.
      const file = new File(pending.uri); if (file.exists) file.delete();
    }
  }
  async function move(delta: number) {
    const latest = cacheRef.current;
    if (!latest) return;
    const currentSteps = streamlinedActivityPages(activityWizardPages(latest.record.form, latest.answers));
    const index = Math.max(0, currentSteps.findIndex((item) => item.key === latest.stepKey));
    await remember({ ...latest, stepKey: currentSteps[Math.max(0, Math.min(currentSteps.length - 1, index + delta))].key });
  }
  async function addRepeatItem(group: string) {
    const latest = cacheRef.current;
    if (!latest) return;
    const count = activityRepeatCount(latest.record.form, latest.answers, group);
    if (count >= 20) return;
    const answers = { ...latest.answers, [`$repeat.${group}`]: count + 1 };
    const nextPage = streamlinedActivityPages(activityWizardPages(latest.record.form, answers)).find((page) => page.kind === 'fields'
      && page.fields.some((field) => field.repeatGroup === group && field.repeatIndex === count));
    await remember({ ...latest, answers, stepKey: nextPage?.key || latest.stepKey });
    queuePageSync([]);
  }
  function removeRepeatItem(group: string) {
    const latest = cacheRef.current;
    if (!latest) return;
    const count = activityRepeatCount(latest.record.form, latest.answers, group);
    if (count <= 1) return;
    const removedIndex = count - 1;
    const fieldKeys = latest.record.form.fields.filter((field) => field.repeatGroup === group)
      .map((field) => activityRepeatKey(field.key, removedIndex));
    if (latest.record.evidence.some((item) => fieldKeys.includes(item.fieldKey))) {
      setError(`This ${activityRepeatItemLabel(group)} has already uploaded evidence and cannot be removed from the field record.`);
      return;
    }
    const itemLabel = activityRepeatItemLabel(group);
    Alert.alert(`Remove this ${itemLabel}?`, 'This removes the accidental item and any answers or pending files attached to it.', [
      { text: 'Keep item', style: 'cancel' },
      { text: 'Remove item', style: 'destructive', onPress: () => void perform('remove', async () => {
        await waitForBackgroundSync();
        const current = cacheRef.current;
        if (!current) return;
        const currentCount = activityRepeatCount(current.record.form, current.answers, group);
        if (currentCount <= 1) return;
        const currentRemovedIndex = currentCount - 1;
        const currentFieldKeys = current.record.form.fields.filter((field) => field.repeatGroup === group)
          .map((field) => activityRepeatKey(field.key, currentRemovedIndex));
        if (current.record.evidence.some((item) => currentFieldKeys.includes(item.fieldKey))) {
          setError(`This ${itemLabel} finished uploading and stays in the field record.`);
          return;
        }
        const pending = current.pending.filter((item) => currentFieldKeys.includes(item.fieldKey));
        const answers = removeLastActivityRepeat(current.record.form, current.answers, group);
        const previousPage = [...streamlinedActivityPages(activityWizardPages(current.record.form, answers))].reverse().find((page) => page.kind === 'fields'
          && page.fields.some((field) => field.repeatGroup === group && field.repeatIndex === currentRemovedIndex - 1));
        await remember({ ...current, answers, pending: current.pending.filter((item) => !currentFieldKeys.includes(item.fieldKey)), stepKey: previousPage?.key || current.stepKey });
        for (const item of pending) { const file = new File(item.uri); if (file.exists) file.delete(); }
        queuePageSync([]);
      }) },
    ]);
  }
  async function next() {
    if (!step || !cache) return;
    if (step.kind === 'fields') {
      if (!editable) { await move(1); return; }
      if (moving.current) return;
      for (const field of step.fields) {
        const value = cacheRef.current?.answers[field.key];
        if (field.approvedProduct?.role === 'brand') {
          if (productsLoading) return setError('The approved brand list is loading. Try Next again in a moment.');
          if (productsError || !approvedBrands.some((option) => option.value === value)) return setError(productsError || 'Choose an approved brand before continuing.');
        }
        if (field.approvedProduct?.role === 'model') {
          const brandFieldKey = field.approvedProduct.brandFieldKey;
          const brand = brandFieldKey ? String(cacheRef.current?.answers[activityRepeatKey(brandFieldKey, field.repeatIndex)] || '') : '';
          if (productsLoading) return setError('The approved model list is loading. Try Next again in a moment.');
          if (productsError || !(approvedModels[brand] || []).some((option) => option.value === value)) return setError(productsError || 'Choose an approved model before continuing.');
        }
        if (field.required && !['photo', 'document'].includes(field.type) && (value === undefined || value === '')) return setError(`Complete ${field.label.toLowerCase()} before continuing.`);
        if (field.requiredValue !== undefined && value !== field.requiredValue) return setError(`Complete ${field.label.toLowerCase()} before continuing. Your answer is retained.`);
        const current = cacheRef.current;
        if (field.required && ['photo', 'document'].includes(field.type) && !current?.record.evidence.some((item) => item.fieldKey === field.key) && !current?.pending.some((item) => item.fieldKey === field.key)) return setError(`Add ${field.label.toLowerCase()} before continuing.`);
      }
      setError('');
      const fieldKeys = step.fields.map((field) => field.key);
      moving.current = true;
      try {
        const transition = move(1);
        if (online) queuePageSync(fieldKeys);
        await transition;
      } finally {
        moving.current = false;
      }
      return;
    }
    if (step.kind === 'signature' && !currentSignature && !pendingSignature) {
      if (!acknowledged) return setError('Confirm the declaration before signing.');
      const latest = cacheRef.current;
      if (!latest) return;
      const signerName = step.declaration.role === 'technician' ? latest.record.signerDefaults.technician : signature.signerName.trim();
      if (!signerName) return setError('Add the signer name before signing.');
      if (!signature.strokes.length) return setError('Draw the signature before saving it.');
      const declarations = step.legacyStepKeys.flatMap((key) => {
        const declaration = latest.record.form.declarations.find((item) => item.key === key);
        return declaration ? [declaration] : [];
      });
      if (!declarations.length) return setError('This declaration is no longer part of the activity form.');
      const alreadyCurrent = activityCurrentSignatureKeys(latest.record.signatures, latest.record.missing);
      const queued = declarations.filter((declaration) => !alreadyCurrent.has(declaration.key)).map((declaration): PendingSignature => ({
        declarationKey: declaration.key,
        declarationText: boundActivityDeclaration(declaration, latest.answers),
        phase: declaration.phase,
        role: declaration.role,
        signerName,
        strokes: signature.strokes,
      }));
      const declarationKeys = new Set(declarations.map((declaration) => declaration.key));
      const nextPages = streamlinedActivityPages(activityWizardPages(latest.record.form, latest.answers));
      const index = Math.max(0, nextPages.findIndex((item) => item.key === latest.stepKey));
      const transition = remember({ ...latest,
        pendingSignatures: [...(latest.pendingSignatures || []).filter((item) => !declarationKeys.has(item.declarationKey)), ...queued],
        stepKey: nextPages[Math.min(nextPages.length - 1, index + 1)].key });
      setError('');
      if (online) queuePageSync([], true);
      void transition.catch(() => setError('The signature is visible here but could not be retained on this phone. Keep this job open and try again.'));
      return;
    }
    await perform('next', async () => {
      if (!editable) { await move(1); return; }
      await move(1);
    });
  }
  async function leave() { await writes.current; await syncs.current; await onChanged(); onReturnToJob(); }
  function finish() {
    onReturnToJob();
    void onChanged().catch(() => undefined);
  }
  function finishImmediately() {
    const latest = cacheRef.current;
    if (!latest) return;
    const retained = remember({ ...latest, finishRequested: true, finishError: '' });
    onReturnToJob();
    void retained
      .then(() => processActivityFormCompletionQueue(cacheKey))
      .then(() => onChanged())
      .catch(() => undefined);
  }
  async function share() {
    await perform('share', async () => {
      if (!record) return;
      const response = await apiRequest<{ reportUrl: string }>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'share_report', recordId: record.id }) });
      await Share.share({ message: response.reportUrl, url: response.reportUrl });
    });
  }

  if (!record || !cache) return <View style={styles.body}><Text style={styles.title}>{busy ? 'Loading activity form…' : 'Activity form'}</Text>{error ? <Text style={styles.error}>{error}</Text> : null}<FieldButton variant="secondary" onPress={onReturnToJob}>Job</FieldButton></View>;
  const title = step?.kind === 'fields' ? step.section : step?.kind === 'review' ? 'Review and submit'
    : step?.declaration.role === 'technician' ? `Installer declaration${signatureDeclarations.length > 1 ? 's' : ''} and sign-off`
      : step?.declaration.role === 'customer' ? `Customer declaration${signatureDeclarations.length > 1 ? 's' : ''} and permission`
        : step?.declaration.title || record.form.title;
  const signatureReviewDeclaration = step?.kind === 'signature' && signatureDeclarations.length > 1
    ? { ...step.declaration, title, text: `This one signature applies to all ${signatureDeclarations.length} declarations below.\n\n${signatureDeclarations.map((declaration, index) =>
      `${index + 1}. ${declaration.title}\n${boundActivityDeclaration(declaration, cache.answers)}`).join('\n\n')}` }
    : step?.kind === 'signature' ? step.declaration : null;
  const evidenceFieldKeys = new Set([...record.evidence.map((item) => item.fieldKey), ...cache.pending.map((item) => item.fieldKey)]);
  const signatureDeclarationKeys = new Set([...activityCurrentSignatureKeys(record.signatures, record.missing),
    ...(cache.pendingSignatures || []).map((item) => item.declarationKey)]);
  const overallProgress = activityProgress(steps, cache.answers, evidenceFieldKeys, signatureDeclarationKeys);
  const sections = activitySectionProgress(steps, cache.answers, evidenceFieldKeys);
  const fieldMissing = steps.flatMap((wizardStep) => {
    if (wizardStep.kind !== 'field' || !wizardStep.field.required) return [];
    const field = wizardStep.field;
    const value = cache.answers[field.key];
    const missingEvidence = ['photo', 'document'].includes(field.type) && !evidenceFieldKeys.has(field.key);
    const missingAnswer = !['photo', 'document'].includes(field.type)
      && (value === undefined || value === '' || (field.requiredValue !== undefined && value !== field.requiredValue));
    const unapprovedBrand = field.approvedProduct?.role === 'brand'
      && !approvedBrands.some((option) => option.value === value);
    const approvedBrandFieldKey = field.approvedProduct?.brandFieldKey;
    const selectedBrand = approvedBrandFieldKey
      ? String(cache.answers[activityRepeatKey(approvedBrandFieldKey, field.repeatIndex)] || '') : '';
    const unapprovedModel = field.approvedProduct?.role === 'model'
      && !(approvedModels[selectedBrand] || []).some((option) => option.value === value);
    return missingEvidence || missingAnswer || unapprovedBrand || unapprovedModel
      ? [{ key: field.key, label: field.label, kind: missingEvidence ? 'evidence' : 'answer' }]
      : [];
  });
  for (const signaturePage of pages.filter((page) => page.kind === 'signature')) {
    const requiredKeys = signaturePage.legacyStepKeys.filter((key) => record.form.declarations
      .some((declaration) => declaration.key === key && declaration.required));
    if (requiredKeys.some((key) => !signatureDeclarationKeys.has(key))) {
      fieldMissing.push({ key: signaturePage.key,
        label: signaturePage.declaration.role === 'technician' ? `Installer declaration${requiredKeys.length > 1 ? 's' : ''} and sign-off`
          : signaturePage.declaration.role === 'customer' ? `Customer declaration${requiredKeys.length > 1 ? 's' : ''} and permission`
            : signaturePage.declaration.title,
        kind: 'signature' });
    }
  }
  const currentSection = step?.kind === 'fields' ? sections.find((item) => item.key === `${step.phase}:${step.section}`) : undefined;
  const technicianSignature = step?.kind === 'signature' && step.declaration.role === 'technician';
  const boundSignerName = technicianSignature ? record.signerDefaults.technician : signature.signerName;
  const proposedSigningName = signingName || record.signerSetup || { firstName: '', lastName: '' };
  const boundSignature = technicianSignature && signature.signerName !== boundSignerName ? { ...signature, signerName: boundSignerName } : signature;
  const signerRole: FieldWorkPackSignerRole = { roleKey: signature.signerRoleKey, label: step?.kind === 'signature' ? step.declaration.role : 'Signer', capacity: signature.signerCapacity,
    identitySource: technicianSignature ? 'assigned_worker' : step?.kind === 'signature' && step.declaration.role === 'customer' ? 'customer_context' : 'manual_verified',
    minimumSignatures: 1, maximumSignatures: 1, identityRequirements: [] };
  const repeatField = step?.kind === 'fields' ? step.fields.find((field) => field.repeatGroup) : undefined;
  const followingPage = pages[stepIndex + 1];
  const repeatItemContinues = Boolean(repeatField && followingPage?.kind === 'fields' && followingPage.fields.some((field) =>
    field.repeatGroup === repeatField.repeatGroup && field.repeatIndex === repeatField.repeatIndex));
  const repeatCount = repeatField?.repeatGroup ? activityRepeatCount(record.form, cache.answers, repeatField.repeatGroup) : 1;
  const showRepeatActions = Boolean(repeatField?.repeatGroup && !repeatItemContinues && repeatField.repeatIndex === repeatCount - 1);
  const repeatItemLabel = repeatField?.repeatGroup ? activityRepeatItemLabel(repeatField.repeatGroup) : 'item';
  const repeatItemKeys = repeatField?.repeatGroup ? record.form.fields.filter((field) => field.repeatGroup === repeatField.repeatGroup)
    .map((field) => activityRepeatKey(field.key, repeatField.repeatIndex)) : [];
  const repeatItemHasSavedEvidence = record.evidence.some((item) => repeatItemKeys.includes(item.fieldKey));
  function renderField(field: ExpandedActivityField) {
    if (!record || !cache) return null;
    const approvedBrand = field.approvedProduct?.role === 'brand';
    const approvedModel = field.approvedProduct?.role === 'model';
    const approvedBrandFieldKey = field.approvedProduct?.brandFieldKey;
    const selectedBrand = approvedBrandFieldKey
      ? String(cache.answers[activityRepeatKey(approvedBrandFieldKey, field.repeatIndex)] || '') : '';
    const pendingHere = cache.pending.filter((item) => item.fieldKey === field.key);
    const savedHere = record.evidence.filter((item) => item.fieldKey === field.key);
    const evidenceForLabels = field.evidenceFor?.map((key) => record.form.fields.find((item) => item.key === key)?.label || key).filter(Boolean) || [];
    return <View key={field.key} style={styles.fieldCard}>
      <Text style={styles.fieldLabel}>{field.label}{field.repeatGroup ? ` · Item ${field.repeatIndex + 1}` : ''}</Text>

          {field.help ? <Text style={styles.text}>{field.help}</Text> : null}
          {(field.referenceDocuments || []).map((document) => { const url = new URL(document.url, API_BASE_URL).toString(); return <View key={url} style={styles.group}><Text style={styles.text}>{document.title}</Text><View style={styles.row}><FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy)} onPress={() => void perform('document', async () => { await Linking.openURL(url); })}>Open document</FieldButton><FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy)} onPress={() => void perform('document', async () => { await Share.share({ message: `${document.title}\n${url}`, url }); })}>Share copy</FieldButton></View></View>; })}
          {field?.presentation === 'derived' ? <View style={styles.derived}><Text style={styles.text}>{cache.answers[field.key] === undefined || cache.answers[field.key] === '' ? 'Recorded automatically by TLink.' : String(cache.answers[field.key])}</Text><Text style={styles.small}>This value comes from the job, business, assigned team member or signature record.</Text></View>
            : approvedBrand ? <><FieldSelect label="Choose approved brand" value={String(cache.answers[field.key] ?? '')} options={approvedBrands} placeholder={productsLoading ? 'Loading approved brands…' : 'Choose approved brand'} onChange={(value) => answerApprovedBrand(field, value)} disabled={!editable || Boolean(busy) || productsLoading || Boolean(productsError)} />{productsError ? <Text style={styles.error}>{productsError}</Text> : null}</>
              : approvedModel ? <><FieldSelect label="Choose approved model" value={String(cache.answers[field.key] ?? '')} options={approvedModels[selectedBrand] || []} placeholder={!selectedBrand ? 'Choose a brand first' : productsLoading ? 'Loading approved models…' : 'Choose approved model'} onChange={(value) => answer(field.key, value)} disabled={!editable || Boolean(busy) || !selectedBrand || productsLoading || Boolean(productsError)} />{productsError ? <Text style={styles.error}>{productsError}</Text> : null}</>
                : field.type === 'boolean' ? <View style={styles.row}>{[true, false].map((value) => <Pressable key={String(value)} accessibilityRole="radio" accessibilityState={{ selected: cache.answers[field.key] === value }} disabled={!editable || Boolean(busy)} onPress={() => answer(field.key, value)} style={[styles.choice, cache.answers[field.key] === value && styles.selected]}><Text style={styles.text}>{value ? 'Yes' : 'No'}</Text></Pressable>)}</View>
                  : field.type === 'select' ? <FieldSelect label="Choose an answer" value={String(cache.answers[field.key] ?? '')} options={field.options.map((value) => ({ value, label: activityOptionLabel(value, field?.optionLabels?.[value]) }))} onChange={(value) => answer(field.key, value)} disabled={!editable || Boolean(busy)} /> : ['photo', 'document'].includes(field.type) ? <>
            {evidenceForLabels.length ? <Text style={styles.evidenceBinding}>Evidence for: {evidenceForLabels.join(', ')}</Text> : null}
            <FieldButton disabled={!editable || Boolean(busy)} loading={busy === 'camera' || busy === 'document'} onPress={() => field.type === 'photo' ? void capture(field) : void chooseDocument(field)}>{field.type === 'photo' ? 'Take photo' : 'Choose document'}</FieldButton>
            <Text style={styles.small}>{savedHere.length} saved · {pendingHere.length} ready to upload</Text>
            {savedHere.map((item) => <Text key={item.id} style={styles.text}>{item.fileName}{item.latitude !== null ? ` · ${item.latitude.toFixed(5)}, ${item.longitude?.toFixed(5)}` : ''}</Text>)}
            {pendingHere.map((item) => <View key={item.id} style={styles.group}>{item.contentType.startsWith('image/') ? <Image alt="Pending site evidence" accessibilityLabel="Pending site evidence" source={{ uri: item.uri }} style={styles.preview} resizeMode="contain" /> : null}<Text style={styles.small}>{item.name} · Original retained on this phone</Text><FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => Alert.alert('Remove pending file?', 'This file has not been submitted.', [{ text: 'Keep' }, { text: 'Remove', onPress: () => void perform('remove', async () => { await remember({ ...cache, pending: cache.pending.filter((file) => file.id !== item.id) }); const file = new File(item.uri); if (file.exists) file.delete(); }) }])}>Remove pending file</FieldButton></View>)}
          </> : field.type === 'date' ? <FieldDatePicker label="Choose date" value={String(cache.answers[field.key] ?? '')} disabled={!editable || Boolean(busy)} onChange={(value) => answer(field.key, value)} /> : <TextInput accessibilityLabel={field.label} value={String(cache.answers[field.key] ?? '')} editable={editable && !busy} placeholder="Enter answer" placeholderTextColor={colours.muted} keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'} style={styles.input} onChangeText={(value) => answer(field.key, field.type === 'number' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : value)} />}
    </View>;
  }
  return <View style={styles.container}>
    <View style={styles.header}><FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => { if (overview) void perform('leaving', leave); else setOverview(true); }}>{overview ? 'Job' : 'Back'}</FieldButton><View style={styles.flex}><Text numberOfLines={2} style={styles.small}>{record.form.title}</Text><Text style={styles.small}>{record.recordNumber} · {syncing ? 'Saving in background' : online ? 'Connected' : 'Draft on this phone'}</Text></View><FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => setOverview(!overview)}>{overview ? 'Continue' : 'Sections'}</FieldButton></View>
    <ScrollView
      ref={scroll}
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.body}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onFocus={(event) => scroll.current?.scrollResponderScrollNativeHandleToKeyboard(event.target, 96, true)}
      scrollEnabled={true}
    >
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <ProgressMeter label="Form progress" complete={overallProgress.complete} total={overallProgress.total} />
      {overview ? <>
        <Text style={styles.title}>{record.form.title}</Text><Text style={styles.text}>Complete the questions, evidence and signatures, then submit to Creditex.</Text>
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
        <Text style={styles.small}>{step?.kind === 'fields' ? `Section ${stepIndex + 1} of ${pages.length} · ${step.fields.length} items` : step?.kind === 'signature' ? 'Signature' : 'Final review'}</Text><Text style={styles.title}>{title}</Text>
        {step?.kind === 'fields' ? <>{step.fields.map(renderField)}{showRepeatActions && repeatField?.repeatGroup ? <View style={styles.repeatActions}>
          <Text style={styles.progressLabel}>{repeatItemLabel.charAt(0).toUpperCase() + repeatItemLabel.slice(1)} {repeatField.repeatIndex + 1}</Text>
          <FieldButton variant="secondary" disabled={!editable || Boolean(busy) || repeatCount >= 20} onPress={() => void addRepeatItem(repeatField.repeatGroup!)}>Add another {repeatItemLabel}</FieldButton>
          {repeatCount > 1 ? <FieldButton variant="danger" disabled={!editable || Boolean(busy) || repeatItemHasSavedEvidence} onPress={() => removeRepeatItem(repeatField.repeatGroup!)}>Remove this {repeatItemLabel}</FieldButton> : null}
          {repeatItemHasSavedEvidence ? <Text style={styles.small}>This item has uploaded evidence and stays in the field record.</Text> : null}
        </View> : null}</> : step?.kind === 'signature' ? currentSignature ? <Text style={styles.text}>Signed by {currentSignature.signerName} on {new Date(currentSignature.signedAt).toLocaleString('en-AU')}.</Text> : pendingSignature ? <Text style={styles.text}>Signature saved on this phone. TLink is syncing it automatically.</Text> : <>
          <Text style={styles.small}>The signing date and time are recorded automatically when this signature is saved.</Text>
          {technicianSignature ? <View style={styles.derived}><Text style={styles.text}>{boundSignerName || 'Assigned technician profile name missing'}</Text><Text style={styles.small}>Technician identity comes from the active team member assigned to this job.</Text></View>
            : <TextInput accessibilityLabel="Signer's full name" value={signature.signerName} placeholder="Signer's full name" placeholderTextColor={colours.muted} editable={editable && !busy} style={styles.input} onChangeText={(signerName) => setSignature({ ...signature, signerName, strokes: [], capturedAt: '' })} />}
          <FieldButton variant="secondary" onPress={() => setReadingDeclaration(true)}>Read assignment form</FieldButton>
          <Modal visible={readingDeclaration} animationType="slide" onRequestClose={() => setReadingDeclaration(false)}>
            <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
              <ScrollView contentContainerStyle={styles.body}><ActivityAssignmentReview record={record} answers={cache.answers} declaration={signatureReviewDeclaration || step.declaration} /></ScrollView>
              <View style={styles.footer}><FieldButton style={styles.flex} onPress={() => setReadingDeclaration(false)}>Back to signature</FieldButton></View>
            </View>
          </Modal>
          {signatureDeclarations.length > 1 ? <Text style={styles.small}>One signature confirms all {signatureDeclarations.length} declarations for this signer shown in the assignment form.</Text> : null}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: acknowledged }} disabled={!editable || Boolean(busy)} onPress={() => setAcknowledged(!acknowledged)} style={styles.choice}><Text style={styles.text}>{acknowledged ? '☑' : '☐'} I have read and agree to {signatureDeclarations.length > 1 ? 'these declarations' : 'this declaration'}.</Text></Pressable>
          {technicianSignature && !boundSignerName ? <View style={styles.deliveryRecovery}>
            <Text style={styles.progressLabel}>Set up your signing name once</Text>
            <Text style={styles.text}>Your team profile needs your personal name for signatures. It will be saved to Teams and filled automatically on future jobs.</Text>
            {record.signerSetup?.canSave ? <>
              <TextInput accessibilityLabel="Technician first name" placeholder="First name" placeholderTextColor={colours.muted} style={styles.input} value={proposedSigningName.firstName} editable={!busy && !record.signerSetup.firstNameLocked} onChangeText={(firstName) => setSigningName({ ...proposedSigningName, firstName })} />
              <TextInput accessibilityLabel="Technician last name" placeholder="Last name" placeholderTextColor={colours.muted} style={styles.input} value={proposedSigningName.lastName} editable={!busy && !record.signerSetup.lastNameLocked} onChangeText={(lastName) => setSigningName({ ...proposedSigningName, lastName })} />
              <FieldButton disabled={!online || Boolean(busy) || !proposedSigningName.firstName.trim() || !proposedSigningName.lastName.trim()} loading={busy === 'signing-profile'} onPress={() => void perform('signing-profile', async () => {
                await saveAnswers();
                await request('save_signing_profile', { firstName: proposedSigningName.firstName, lastName: proposedSigningName.lastName });
                setSigningName(null);
              })}>Confirm my name and enable signing</FieldButton>
            </> : <Text style={styles.text}>The assigned technician needs to open this job on their own device, or have their personal name saved in Teams.</Text>}
          </View> : <SignatureCapture key={`${record.id}:${step.key}:${boundSignerName}`} signerRole={signerRole} declaration={boundActivityDeclaration(step.declaration, cache.answers)} showDeclaration={false} value={boundSignature} disabled={!editable || Boolean(busy)} onChange={setSignature} />}
        </> : <>
          <Text style={styles.text}>{record.status === 'submitted_for_creditex_review' ? 'Submitted to Creditex. The completed record is saved with this job.' : fieldMissing.length
            ? `${fieldMissing.length} required item${fieldMissing.length === 1 ? '' : 's'} remaining.`
            : 'Ready. Tap Done once. TLink will finish the upload and submission automatically in the background.'}</Text>
          {fieldMissing.slice(0, 8).map((item) => <FieldButton key={item.key} variant="secondary" onPress={() => { const target = activityWizardPageForStepKey(pages, item.key); if (target) void remember({ ...cache, stepKey: target.key }); }}>{item.label}</FieldButton>)}
          {fieldMissing.length > 8 ? <Text style={styles.small}>{fieldMissing.length - 8} more questions will follow.</Text> : null}
          {record.status === 'submitted_for_creditex_review' ? <><FieldButton disabled={!online || Boolean(busy)} onPress={() => void share()}>Share completed report</FieldButton><FieldButton variant="secondary" onPress={() => void perform('revoke', async () => { await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ action: 'revoke_report', recordId: record.id }) }); setError('Previous report links have been revoked.'); })}>Revoke report links</FieldButton></> : null}
        </>}
      </>}
    </ScrollView>
    {!overview ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}><FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy) || stepIndex === 0} onPress={() => void move(-1)}>Previous</FieldButton><FieldButton style={styles.flex} disabled={Boolean(busy) || (step?.kind === 'review' && record.status === 'draft' && fieldMissing.length > 0) || (technicianSignature && !boundSignerName)} loading={busy === 'next'} onPress={() => step?.kind === 'review' && record.status === 'draft' ? finishImmediately() : step?.kind === 'review' ? finish() : void next()}>{step?.kind === 'review' ? 'Done' : step?.kind === 'signature' && !currentSignature && !pendingSignature ? 'Save signature' : 'Next'}</FieldButton></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colours.cream }, flex: { flex: 1 }, body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderBottomWidth: 1, borderColor: colours.line },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderColor: colours.line, backgroundColor: colours.surface },
  title: { color: colours.ink, fontSize: 23, fontWeight: '800' }, text: { color: colours.ink, fontSize: 16, lineHeight: 23 }, small: { color: colours.muted, fontSize: 12, lineHeight: 18 },
  fieldCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, backgroundColor: colours.surface },
  fieldLabel: { color: colours.ink, fontSize: 17, lineHeight: 23, fontWeight: '700' },
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
  repeatActions: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.green, backgroundColor: colours.surfaceRaised },
});
