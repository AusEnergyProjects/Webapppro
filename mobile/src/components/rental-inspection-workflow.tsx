import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '@/components/keyboard-aware-scroll-view';
import { FieldButton } from '@/components/field-button';
import { FieldSelect } from '@/components/field-select';
import { FieldDatePicker } from '@/components/field-date-picker';
import { assertLocalDataOwner, getLocalDataOwner, readRentalSetting, writeRentalSetting, type LocalDataOwner } from '@/lib/database';
import { observeLocation, observedTime } from '@/lib/evidence';
import { RENTAL_ADVERSE_OUTCOMES, newRentalItem,
  rentalObservationsComplete, rentalAccessLimitations, rentalCompletionTarget, rentalPendingCompletionBlockers,
  type RentalAssessmentItem, type RentalAssessmentResult,
  type RentalAssessmentModule, type RentalAssessmentSection } from '@/lib/rental-inspection';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldRentalInspectionSummary } from '@/lib/types';
import { rentalQuotation, rentalAssessorFields, rentalFindingDescriptionLabel, rentalObservationBlockers, rentalSharedObservationResponse, rentalObservationNumberIsValid } from '../../../src/lib/rental-quotation.mjs';
import { RENTAL_ASSESSOR_TITLE, rentalAssessorMetadataField, rentalAssessorOutcomePatch, rentalWindowIsFixed,
  rentalAssessorCheckPresentation, rentalAssessorEvidenceRequirement, rentalAssessorSections,
  RENTAL_SHOWER_CHOICES, rentalShowerChoicePatch, rentalShowerChoiceValue } from '../../../src/lib/rental-assessor-workflow.mjs';
import { acknowledgeRentalSave, loadRentalResult, discardRentalSave, enqueueRentalSave, enqueueRentalFinish, getRentalSaveState,
  processRentalSaveQueue, rememberRentalPhotoLocation, requestWhenRentalSynced, subscribeRentalSaves,
  type RentalSaveRecord, type RentalQueuedPhoto } from '@/lib/rental-save-queue';

type Props = { workOrderId: string; summary: FieldRentalInspectionSummary; online: boolean; onChanged: () => Promise<void>; onReturnToJob: () => void };
type Photo = RentalQueuedPhoto;
type Draft = { outcome: string; locationLabel: string; publicNotes: string; internalNotes: string;
  findingTitle: string; findingDescription: string; scopeSummary: string;
  quantity: string; unitLabel: string; quotation: Record<string, string>;
  severity: string; immediateAction: string; notified: boolean; response: Record<string, unknown>; photos: Photo[] };
type Cursor = { sectionKey: string; checkIndex: number; instanceKey: string };
type Page = 'earlier' | 'categories' | 'answer' | 'details' | 'finding' | 'safety' | 'metadata' | 'review';
type Cache = { drafts: Record<string, Draft>; answers: Record<string, Record<string, unknown>> };
const emptyCache: Cache = { drafts: {}, answers: {} };
const readable = (s: string) => s.replaceAll('_', ' ');
const draftPrefix = (module: RentalAssessmentModule) => [module.id, module.template.assessmentScope || 'legacy', module.template.templateVersion || 1].join(':') + ':';
const itemKey = (module: RentalAssessmentModule, cursor: Cursor) => draftPrefix(module) + [cursor.sectionKey, cursor.checkIndex, cursor.instanceKey].join(':');
function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  return 'outcome' in value && typeof value.outcome === 'string' && 'photos' in value && Array.isArray(value.photos)
    && 'response' in value && typeof value.response === 'object' && 'findingDescription' in value && typeof value.findingDescription === 'string';
}
function initialDraft(item: RentalAssessmentItem, data: RentalAssessmentResult): Draft {
  const finding = data.findings?.find((f) => f.itemId === item.id);
  return { outcome: item.outcome, locationLabel: item.locationLabel, publicNotes: item.publicNotes, internalNotes: item.internalNotes,
    findingTitle: finding?.title || '', findingDescription: finding?.description || item.publicNotes || '',
    scopeSummary: finding?.scopeSummary || '', severity: finding?.severity || 'required',
    quantity: finding ? String(finding.quantityMilli / 1000) : '', unitLabel: finding?.unitLabel || 'each', quotation: rentalQuotation(finding?.details.quotation),
    immediateAction: String(finding?.details.immediateAction || ''), notified: finding?.details.responsiblePeopleNotified === true,
    response: item.response, photos: [] };
}
function RentalTextField({ label, value, onChange, editable, multiline = false, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; editable: boolean; multiline?: boolean; maxLength?: number;
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput editable={editable}
    style={[styles.input, multiline && styles.notes]} value={value} onChangeText={onChange} multiline={multiline} maxLength={maxLength ?? (multiline ? 4000 : 500)} /></View>;
}
type ObservationField = ReturnType<typeof rentalAssessorFields>[number];
function RentalObservationInput({ field, value, editable, onChange }: {
  field: ObservationField; value: unknown; editable: boolean; onChange: (value: string) => void;
}) {
  const text = String(value ?? '');
  if (field.input === 'select') {
    const options = field.options || [];
    return <FieldSelect label={field.label} value={text} disabled={!editable} onChange={onChange}
      options={text && !options.some((option) => option.value === text) ? [...options, { value: text, label: text }] : options} />;
  }
  return <View style={styles.field}><Text style={styles.label}>{field.label}{field.unit ? ' (' + field.unit + ')' : ''}</Text>
    <TextInput accessibilityLabel={field.label} editable={editable} style={[styles.input, field.input === 'textarea' && styles.notes]}
      value={text} onChangeText={onChange} multiline={field.input === 'textarea'}
      keyboardType={field.input === 'number' ? 'decimal-pad' : 'default'} inputMode={field.input === 'number' ? 'decimal' : 'text'}
      maxLength={field.input === 'number' ? 12 : 500} /></View>;
}
function findingChoices(outcome: string): string[] {
  if (outcome === 'specialist_verification_required') return ['Visible condition recorded; specialist verification needed', 'Label unreadable', 'Could not safely check'];
  if (outcome === 'not_accessible') return ['Access blocked', 'Area locked', 'Unsafe to access', 'Occupant did not allow access'];
  if (outcome === 'exemption_evidence_pending') return ['Supporting document not available', 'Exemption evidence not provided'];
  return ['Missing', 'Not working when checked', 'Visible damage', 'Worn or deteriorated', 'Gaps visible'];
}
export function RentalInspectionWorkflow({ workOrderId, summary, online, onChanged, onReturnToJob }: Props) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<RentalAssessmentResult>({});
  const [moduleId, setModuleId] = useState('');
  const [cursor, setCursor] = useState<Cursor>({ sectionKey: '', checkIndex: 0, instanceKey: 'property' });
  const [page, setPage] = useState<Page>('categories');
  const [metadataIndex, setMetadataIndex] = useState(0);
  const [detailIndex, setDetailIndex] = useState(0);
  const [cache, setCache] = useState<Cache>(emptyCache);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [editEquipmentKey, setEditEquipmentKey] = useState('');
  const [saves, setSaves] = useState<RentalSaveRecord[]>([]);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const cacheRef = useRef(cache);
  const cacheKey = 'rental-wizard:' + workOrderId;
  const pendingWrite = useRef(Promise.resolve());
  const localOwner = useRef<LocalDataOwner | null>(null);
  const loadedCacheKey = useRef('');
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);
  const applyResult = useCallback((result: RentalAssessmentResult) => {
    setData((current) => (current.inspection?.revision || 0) > (result.inspection?.revision || 0) ? current : result);
    setModuleId((selected) => result.modules?.some((entry) => entry.id === selected) ? selected : result.modules?.[0]?.id || '');
  }, []);
  useEffect(() => { cacheRef.current = cache; }, [cache]);
  const persist = useCallback((value = cacheRef.current) => {
    const owner = localOwner.current;
    if (!owner) return Promise.reject(new Error('The assessment is still opening. Try again.'));
    pendingWrite.current = pendingWrite.current.catch(() => undefined).then(() => writeRentalSetting(owner, cacheKey, JSON.stringify(value)));
    return pendingWrite.current;
  }, [cacheKey]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (loadedCacheKey.current !== cacheKey) {
          const owner = await getLocalDataOwner();
          const stored = await readRentalSetting(owner, cacheKey);
          if (live) localOwner.current = owner;
          if (stored) {
            const local: Cache = JSON.parse(stored);
            if (local && local.drafts && local.answers && typeof local.drafts === 'object' && !Array.isArray(local.drafts)
              && typeof local.answers === 'object' && !Array.isArray(local.answers) && live) { setCache(local); cacheRef.current = local; }
          }
          if (live) loadedCacheKey.current = cacheKey;
        }
        const saved = await getRentalSaveState(workOrderId);
        if (live) { setSaves(saved.records); if (saved.result) { applyResult(saved.result); setLoaded(true); } }
        if (!online) return;
        const result = await loadRentalResult(workOrderId);
        if (live) applyResult(result);
        void processRentalSaveQueue(workOrderId).catch(() => { /* The queue retains failed saves and their error. */ });
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not open the assessment.'); }
      finally { if (live) setLoaded(true); }
    })();
    return () => { live = false; };
  }, [workOrderId, cacheKey, online, applyResult]);
  useEffect(() => {
    if (!loaded || !data.modules) return;
    const remaining: Cache['answers'] = {};
    for (const [id, patch] of Object.entries(cacheRef.current.answers)) {
      const assessmentModule = data.modules.find((entry) => entry.id === id);
      if (!assessmentModule) { remaining[id] = patch; continue; }
      const dirty = Object.fromEntries(Object.entries(patch).filter(([fieldKey, value]) => {
        const original = assessmentModule.template.metadataFields.find((entry) => entry.key === fieldKey);
        const field = original && rentalAssessorMetadataField(original);
        return field && field.source !== 'team_profile' && field.source !== 'automatic' && field.phase !== 'profile' && fieldKey !== 'roomRoster' && !(assessmentModule.key === 'minimum_standards' && fieldKey === 'credentialConfirmed')
          && JSON.stringify(value) !== JSON.stringify(assessmentModule.answers[fieldKey]);
      }));
      if (Object.keys(dirty).length) remaining[id] = dirty;
    }
    if (JSON.stringify(remaining) === JSON.stringify(cacheRef.current.answers)) return;
    const nextCache = { ...cacheRef.current, answers: remaining };
    cacheRef.current = nextCache; setCache(nextCache);
    void persist(nextCache).catch(() => setError('Could not save the latest property details on this phone.'));
  }, [data.modules, loaded, persist]);
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    let revision = 0;
    const acknowledged = new Set<string>();
    async function refresh() {
      const ticket = ++revision;
      try {
        const state = await getRentalSaveState(workOrderId);
        if (!live || ticket !== revision) return;
        setSaves(state.records);
        if (state.result) applyResult(state.result);
        for (const record of state.records.filter((entry) => entry.status === 'succeeded' && !acknowledged.has(entry.id))) {
          // Recover an interrupted local clear, without deleting edits made after submission.
          const local = cacheRef.current.drafts[record.draftKey];
          if (local && JSON.stringify(local) === JSON.stringify(record.draftSnapshot)) {
            const nextCache = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts } };
            delete nextCache.drafts[record.draftKey];
            cacheRef.current = nextCache; setCache(nextCache); await persist(nextCache);
          }
          acknowledged.add(record.id);
          await acknowledgeRentalSave(record.id);
          if (!state.pending) void onChangedRef.current().catch(() => { /* Saved assessment remains available in its local cache. */ });
        }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not read the saved assessment.'); }
    }
    const unsubscribe = subscribeRentalSaves(workOrderId, () => { void refresh(); });
    void refresh();
    return () => { live = false; unsubscribe(); };
  }, [workOrderId, loaded, applyResult, persist]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { void persist().catch(() => setError('The draft could not be saved on this phone. Keep this screen open and retry.')); }, 200);
    return () => clearTimeout(timer);
  }, [cache, loaded, persist]);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [page, cursor, metadataIndex, detailIndex]);
  const hasDraft = Object.keys(cache.drafts).length > 0 || Object.keys(cache.answers).length > 0;
  const active = data.modules?.find((m) => m.id === moduleId) || data.modules?.[0];
  const sections: RentalAssessmentSection[] = active ? rentalAssessorSections(active.template) : [];
  // A retired page is reachable only to recover its existing draft or queued photos.
  const section = sections.find((s) => s.key === cursor.sectionKey) || active?.template.sections.find((s) => s.key === cursor.sectionKey);
  const check = section?.checks[cursor.checkIndex];
  const showerCheck = check && ['showerhead_rating', 'shower_2027_readiness'].includes(check.key);
  const storedItem = data.items?.find((i) => i.moduleId === active?.id && i.sectionKey === cursor.sectionKey && i.checkKey === check?.key && i.instanceKey === cursor.instanceKey);
  const item = active && section && check ? storedItem || newRentalItem(active, section, check, cursor.instanceKey) : undefined;
  const key = active ? itemKey(active, cursor) : '';
  const pendingSaves = saves.filter((entry) => entry.status !== 'succeeded');
  const completionBlockers = active ? rentalPendingCompletionBlockers(data, active, pendingSaves) : [];
  const finishRequest = pendingSaves.find((entry) => entry.finish);
  const pendingPhotos = pendingSaves.reduce((total, entry) => total + entry.photos.filter((photo) => !photo.linked).length, 0);
  const syncingPhotos = pendingSaves.filter((entry) => entry.status === 'syncing').reduce((total, entry) => total + entry.photos.filter((photo) => !photo.linked).length, 0);
  const saveStatus = pendingSaves.some((entry) => entry.status === 'conflict') ? 'Review saved item'
    : syncingPhotos ? `${syncingPhotos} ${syncingPhotos === 1 ? 'photo' : 'photos'} syncing`
      : finishRequest ? 'Finish queued' : pendingSaves.some((entry) => entry.status === 'syncing') ? 'Syncing answers'
        : pendingSaves.length ? 'Saved on phone' : '';
  const queuedAnswer = [...pendingSaves].reverse().find((entry) => entry.draftKey === key);
  const queuedDraft = queuedAnswer && isDraft(queuedAnswer.draftSnapshot) ? queuedAnswer.draftSnapshot : undefined;
  const pendingAnswers: Record<string, unknown> = {};
  for (const entry of pendingSaves) {
    if (entry.body.action === 'save_module_answers' && entry.body.moduleId === active?.id
      && entry.body.answers && typeof entry.body.answers === 'object' && !Array.isArray(entry.body.answers)) Object.assign(pendingAnswers, entry.body.answers);
  }
  const answers = active ? { ...active.answers, ...pendingAnswers, ...cache.answers[active.id] } : {};
  const savedDraft = item ? cache.drafts[key] || queuedDraft || initialDraft(item, data) : undefined;
  const candidates: Parameters<typeof rentalSharedObservationResponse>[0]['candidates'] = [...(data.items || [])];
  for (const record of saves) {
    const body = record.body;
    if (body.action !== 'save_item' || !isDraft(record.draftSnapshot)) continue;
    candidates.push({ moduleId: String(body.moduleId), sectionKey: String(body.sectionKey), checkKey: String(body.checkKey), instanceKey: String(body.instanceKey),
      locationLabel: record.draftSnapshot.locationLabel, outcome: record.draftSnapshot.outcome, response: record.draftSnapshot.response });
  }
  if (active) for (const [savedKey, savedDraft] of Object.entries(cache.drafts)) {
    if (!savedKey.startsWith(draftPrefix(active))) continue;
    const [sectionKey, index, ...instance] = savedKey.slice(draftPrefix(active).length).split(':');
    const savedCheck = sections.find((entry) => entry.key === sectionKey)?.checks[Number(index)];
    if (savedCheck) candidates.push({ moduleId: active.id, sectionKey, checkKey: savedCheck.key, instanceKey: instance.join(':'),
      locationLabel: savedDraft.locationLabel, outcome: savedDraft.outcome, response: savedDraft.response });
  }
  const observationCandidates = candidates.map((candidate) => candidate.moduleId === active?.id && candidate.instanceKey === 'property'
    ? { ...candidate, locationLabel: 'Property' } : candidate);
  const propertySteps = sections.flatMap((group) => group.checks.map((_entry, checkIndex) => ({ section: group, checkIndex })));
  const earlierItems = active?.key === 'minimum_standards' ? (data.items || []).filter((entry) => entry.moduleId === active.id && entry.instanceKey !== 'property') : [];
  const earlierDrafts = active?.key === 'minimum_standards' ? Object.entries(cache.drafts).filter(([draftKey]) => {
    if (!draftKey.startsWith(draftPrefix(active))) return false;
    const [sectionKey, , ...instance] = draftKey.slice(draftPrefix(active).length).split(':');
    return instance.join(':') !== 'property' || !sections.some((entry) => entry.key === sectionKey);
  }) : [];
  const baseDraft = savedDraft ? { ...savedDraft, locationLabel: cursor.instanceKey === 'property' ? 'Property' : savedDraft.locationLabel } : undefined;
  const presentation = check ? rentalAssessorCheckPresentation(check, { assessmentScope: active?.template.assessmentScope, outcome: baseDraft?.outcome, publicNotes: baseDraft?.publicNotes }) : undefined;
  const photoRequirement = check ? rentalAssessorEvidenceRequirement(check, baseDraft?.outcome || '') : { minimumFiles: 0, minimumPhotos: 0, reason: '' };
  const sharedObservation = rentalSharedObservationResponse({
    target: { moduleId: active?.id || '', sectionKey: section?.key, checkKey: check?.key || '', instanceKey: cursor.instanceKey, locationLabel: baseDraft?.locationLabel },
    candidates: observationCandidates, currentResponse: baseDraft?.response || {},
  });
  const draft = baseDraft ? { ...baseDraft, response: sharedObservation.response } : undefined;
  const responseFields = draft && draft.outcome && draft.outcome !== 'not_applicable' && check ? rentalAssessorFields(check).filter((entry) =>
    (!showerCheck || entry.key !== 'welsRating')
    && (!entry.legacy || active?.key !== 'minimum_standards' && String(draft.response[entry.key] ?? '').trim())
    && (!entry.showForOutcomes || entry.showForOutcomes.includes(draft.outcome))
    && (!entry.showIf || entry.showIf.values.includes(String(draft.response[entry.showIf.key] ?? '')) || String(draft.response[entry.key] ?? '').trim())
    && (!entry.shared || !sharedObservation.recordedKeys.includes(entry.key) || editEquipmentKey === key)) : [];
  const detailField = responseFields[detailIndex];
  const editable = data.permissions?.canEdit === true && active?.status !== 'complete'
    && (!['answer', 'details', 'finding', 'safety'].includes(page) || !queuedAnswer);
  const activeHasDraft = active ? Object.keys(cache.drafts).some((entry) => entry.startsWith(draftPrefix(active))
    && (active.key !== 'minimum_standards' || entry.slice(draftPrefix(active).length).split(':').slice(2).join(':') === 'property')) : false;
  const observationsReady = active ? rentalObservationsComplete(data, active.id) && !activeHasDraft && !pendingSaves.length : false;
  const metadata = active?.template.metadataFields.map(rentalAssessorMetadataField).filter((f) => f.key !== 'roomRoster' && f.phase !== 'profile' && f.source !== 'team_profile' && f.source !== 'automatic' && !(active.key === 'minimum_standards' && f.key === 'credentialConfirmed')
    && !['coverageConfirmed', 'assessorDeclaration'].includes(f.key)
    && (f.phase !== 'final' || observationsReady)) || [];
  const accessSuggestion = active ? rentalAccessLimitations(data.items || [], active.id) : '';
  const field = metadata[metadataIndex];
  const queuedMetadata = pendingSaves.find((entry) => entry.draftKey === `metadata:${active?.id}:${field?.key}`);
  const report = data.reports?.find((r) => r.status === 'issued');
  const allComplete = data.modules?.every((m) => m.status === 'complete') === true;
  const evidence = item ? data.evidence?.filter((e) => e.itemId === item.id && e.status === 'active') || [] : [];
  function change(values: Partial<Draft>) {
    if (!draft) return;
    const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...(cacheRef.current.drafts[key] || draft), response: draft.response, ...values } } };
    cacheRef.current = next; setCache(next);
  }
  async function request(body: Record<string, unknown>) {
    if (!online) throw new Error('Reconnect to save this assessment. Your draft stays on this phone.');
    const result = await requestWhenRentalSynced(workOrderId, body);
    if (!result.ok) throw new Error(result.error || 'The assessment could not be saved.');
    applyResult(result);
    return result;
  }
  async function perform(name: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name); setError('');
    try { await action(); } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  }
  async function leave() {
    await perform('leave', async () => { await persist(); onReturnToJob(); });
  }
  function backToSectionsOrJob() {
    if (page !== 'categories') { setPage('categories'); return; }
    if (busyRef.current) return Alert.alert('Saving on phone', 'Your latest change is being saved. Try again in a moment.');
    void leave();
  }
  function openCheck(s: RentalAssessmentSection, index = 0, instanceKey?: string) {
    const target = s.checks[index];
    const prior = active?.key === 'minimum_standards' ? undefined : data.items?.find((i) => i.moduleId === active?.id && i.sectionKey === s.key && i.checkKey === target.key);
    setCursor({ sectionKey: s.key, checkIndex: index, instanceKey: instanceKey || prior?.instanceKey || (active?.key === 'minimum_standards' || target.repeatBy === 'property' ? 'property' : 'first') });
    setGuidanceOpen(false); setError(''); setPage('answer');
  }
  function advanceQuestion() {
    if (!section || !check) return;
    if (active?.key !== 'minimum_standards' && check.repeatBy !== 'property') {
      const entries = repeatInstances(section, cursor.checkIndex);
      const index = entries.findIndex((entry) => entry.value === cursor.instanceKey);
      if (index >= 0 && entries[index + 1]) return openCheck(section, cursor.checkIndex, entries[index + 1].value);
    }
    const stepIndex = propertySteps.findIndex((entry) => entry.section.key === section.key && entry.checkIndex === cursor.checkIndex);
    if (stepIndex < 0) { setPage('categories'); return; }
    const target = propertySteps[stepIndex + 1];
    if (target) openCheck(target.section, target.checkIndex);
    else { setMetadataIndex(0); setPage(editable && metadata.length ? 'metadata' : 'review'); }
  }
  function changeAnswer(fieldKey: string, value: unknown) {
    if (!active) return;
    const nextCache = { ...cacheRef.current, answers: { ...cacheRef.current.answers, [active.id]: { ...cacheRef.current.answers[active.id], [fieldKey]: value } } };
    cacheRef.current = nextCache; setCache(nextCache);
  }
  function repeatInstances(s: RentalAssessmentSection, index: number) {
    if (!active || active.key === 'minimum_standards') return [];
    const prefix = draftPrefix(active) + [s.key, index].join(':') + ':';
    const saved = (data.items || []).filter((entry) => entry.moduleId === active.id && entry.sectionKey === s.key && entry.checkKey === s.checks[index].key)
      .map((entry) => ({ value: entry.instanceKey, label: entry.locationLabel || 'Recorded item' }));
    const localDrafts = { ...Object.fromEntries(pendingSaves.filter((entry) => isDraft(entry.draftSnapshot))
      .map((entry) => [entry.draftKey, entry.draftSnapshot])), ...cache.drafts };
    for (const [draftKey, local] of Object.entries(localDrafts)) {
      if (!isDraft(local) || !draftKey.startsWith(prefix)) continue;
      const value = draftKey.slice(prefix.length);
      if (!saved.some((entry) => entry.value === value)) saved.push({ value, label: local.locationLabel || 'Unsaved item' });
    }
    return saved;
  }
  async function addServiceItem() {
    if (!active || active.key === 'minimum_standards' || !section || !check || check.repeatBy === 'property') return;
    await perform('draft', async () => {
      await persist();
      const nextCursor = { sectionKey: section.key, checkIndex: cursor.checkIndex, instanceKey: Crypto.randomUUID() };
      const nextCache = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts,
        [itemKey(active, nextCursor)]: initialDraft(newRentalItem(active, section, check, nextCursor.instanceKey), data) } };
      await persist(nextCache); setCache(nextCache); cacheRef.current = nextCache;
      openCheck(section, cursor.checkIndex, nextCursor.instanceKey);
    });
  }
  async function capture() {
    if (!editable || !draft) return;
    await perform('camera', async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow TLink to use the camera in Settings.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => void Linking.openSettings() }]);
        return;
      }
      // GPS runs alongside the camera. Weak indoor reception must never hold the Next button.
      const locationCapture = observeLocation(true);
      const captured = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: true, cameraType: ImagePicker.CameraType.back });
      if (captured.canceled || !captured.assets[0]) return;
      const asset = captured.assets[0];
      const suffix = asset.mimeType === 'image/heic' ? '.heic' : asset.mimeType === 'image/png' ? '.png' : '.jpg';
      const owner = localOwner.current;
      if (!owner) throw new Error('Sign in again before taking photos.');
      assertLocalDataOwner(owner);
      const originals = new Directory(Paths.document, 'rental-original-photos');
      await originals.create({ intermediates: true, idempotent: true });
      assertLocalDataOwner(owner);
      const retained = new File(originals, 'rental-photo-' + Crypto.randomUUID() + suffix);
      try { await new File(asset.uri).copy(retained); assertLocalDataOwner(owner); }
      catch (error) { if (retained.exists) await retained.delete(); throw error; }
      // Retain the captured bytes before asking for location; a failed GPS fix must not lose the photo.
      const photo: Photo = { uri: retained.uri, width: asset.width, height: asset.height, capture: observedTime(), location: null, locationPending: true };
      const currentDraft = cacheRef.current.drafts[key] || draft;
      const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...currentDraft, photos: [...currentDraft.photos, photo] } } };
      setCache(next); cacheRef.current = next; await persist(next);
      const capturedDraftKey = key;
      void locationCapture.then(async (location) => {
        // This checkpoint survives Next, navigation and a process restart. Never attach a later location to another photo.
        await rememberRentalPhotoLocation(workOrderId, photo.uri, location, owner);
        if (!mounted.current) return;
        const current = cacheRef.current.drafts[capturedDraftKey];
        if (!current?.photos.some((entry) => entry.uri === photo.uri)) return;
        const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [capturedDraftKey]: { ...current,
          photos: current.photos.map((entry) => entry.uri === photo.uri ? { ...entry, location, locationPending: false } : entry) } } };
        cacheRef.current = next; setCache(next); await persist(next);
      }).catch(() => { if (mounted.current) setError('The photo is saved. Its location needs review in Sync. You can keep assessing.'); });
    });
  }
  async function updatePhoto(uri: string, values: Partial<Photo>) {
    const currentDraft = cacheRef.current.drafts[key];
    if (!currentDraft) throw new Error('The photo draft is no longer available.');
    const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...currentDraft,
      photos: currentDraft.photos.map((photo) => photo.uri === uri ? { ...photo, ...values, ...(values.location && !photo.mediaId ? { clientUploadId: undefined, captureSessionId: undefined, prepared: undefined } : {}) } : photo) } } };
    setCache(next); cacheRef.current = next; await persist(next);
  }
  async function removePhoto(uri: string) {
    await perform('remove', async () => {
      const currentDraft = cacheRef.current.drafts[key];
      if (!currentDraft) return;
      const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...currentDraft,
        photos: currentDraft.photos.filter((photo) => photo.uri !== uri) } } };
      setCache(next); cacheRef.current = next; await persist(next);
    });
  }
  async function refreshPhotoGps(index: number) {
    if (!draft) return;
    await perform('gps', async () => {
      const photo = draft.photos[index];
      if (!photo || Date.now() - Date.parse(photo.capture.captureObservedAtUtc) > 120000) throw new Error('This photo is too old for a fresh capture-location match. Remove it, then take a new photo with location enabled.');
      const location = await observeLocation(true);
      if (location.location.state !== 'captured') throw new Error('Location is still unavailable. Enable precise location in Settings.');
      // A later observation must not be represented as the location at capture.
      if (Math.abs(Date.parse(location.location.observedAtUtc) - Date.parse(photo.capture.captureObservedAtUtc)) > 120000) throw new Error('The GPS fix was too late for this photo. Remove it and take a new photo.');
      const owner = localOwner.current;
      if (!owner) throw new Error('The assessment is still opening.');
      await rememberRentalPhotoLocation(workOrderId, photo.uri, location, owner);
      await updatePhoto(photo.uri, { location, locationPending: false });
    });
  }
  async function saveAnswer() {
    if (!active || !item || !draft || !section || !check) return;
    if (!draft.outcome) throw new Error('Choose an answer.');
    if (active.key !== 'minimum_standards' && check.repeatBy !== 'property' && !draft.locationLabel.trim()) throw new Error('Add the appliance, circuit or alarm location.');
    for (const responseField of rentalAssessorFields(check).filter((entry) => entry.input === 'number')) {
      const value = String(draft.response[responseField.key] ?? '').trim();
      if (value && !rentalObservationNumberIsValid(value)) {
        throw new Error('Enter a zero or positive number for ' + responseField.label.toLowerCase() + '.');
      }
    }
    if (draft.outcome === 'not_applicable' && !draft.publicNotes.trim()) throw new Error('Explain why this check does not apply.');
    const adverse = RENTAL_ADVERSE_OUTCOMES.has(draft.outcome);
    if (adverse && !draft.findingDescription.trim()) throw new Error('Add a short note about what you saw or could not check.');
    if (adverse && draft.severity === 'immediate_safety_risk' && (!draft.immediateAction.trim() || !draft.notified)) throw new Error('Record the make-safe action and notification.');
    const existingFinding = data.findings?.find((finding) => finding.itemId === item.id);
    const body = { action: 'save_item', moduleId: active.id, expectedModuleRevision: active.revision,
      expectedItemRevision: item.revision, sectionKey: section.key, checkKey: check.key, instanceKey: item.instanceKey,
      locationLabel: draft.locationLabel.trim(), outcome: draft.outcome, response: draft.response, publicNotes: draft.publicNotes.trim(), internalNotes: draft.internalNotes.trim(), sortOrder: item.sortOrder,
      finding: adverse ? { ...existingFinding, title: draft.findingTitle.trim() || section.title + ': ' + readable(draft.outcome), description: draft.findingDescription.trim(),
        scopeSummary: draft.scopeSummary.trim(), severity: draft.severity, recommendedAction: draft.scopeSummary.trim(),
        quantityMilli: existingFinding?.quantityMilli || 0, unitLabel: existingFinding?.unitLabel || 'each',
        details: { ...existingFinding?.details, quotation: draft.quotation, immediateAction: draft.immediateAction.trim(), responsiblePeopleNotified: draft.notified } } : undefined };
    const photoCount = evidence.filter((entry) => entry.contentType.startsWith('image/')).length + draft.photos.length;
    const requirement = rentalAssessorEvidenceRequirement(check, draft.outcome);
    if (evidence.length + draft.photos.length < requirement.minimumFiles || photoCount < requirement.minimumPhotos) {
      throw new Error(requirement.reason);
    }
    if (adverse) {
      const blockers = rentalObservationBlockers({ checkKey: check.key, outcome: draft.outcome, response: draft.response, finding: body.finding });
      if (blockers.length) throw new Error(blockers[0]);
    }
    // Missing GPS is retained for Sync to explain and resolve. It must not trap the assessor on this check.
    // Next waits only for durable device storage. Network delivery belongs to the queue.
    const record = await enqueueRentalSave({ workOrderId, body, module: active, baseItem: storedItem || null,
      baseFinding: existingFinding || null, draftKey: key, draftSnapshot: draft, photos: draft.photos, purpose: check.prompt });
    setSaves((current) => [...current.filter((entry) => entry.id !== record.id), record]);
    const nextCache = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts }, answers: { ...cacheRef.current.answers } };
    delete nextCache.drafts[key];
    await persist(nextCache);
    cacheRef.current = nextCache; setCache(nextCache);
    advanceQuestion();
  }
  async function next() {
    if (!draft || !check) return;
    if (!editable) return advanceQuestion();
    if (!draft.outcome) return setError('Choose an answer.');
    if (page === 'answer' && check.responseType !== 'outcome' && responseFields.length) { setDetailIndex(0); setPage('details'); return; }
    if (page === 'details') {
      if (editable && detailField?.required && !String(draft.response[detailField.key] ?? '').trim()) return setError('Record this result before continuing.');
      if (check.responseType !== 'outcome' && detailIndex + 1 < responseFields.length) { setDetailIndex(detailIndex + 1); return; }
    }
    if (check.responseType !== 'outcome' && (page === 'answer' || page === 'details') && RENTAL_ADVERSE_OUTCOMES.has(draft.outcome)) {
      change({ findingDescription: draft.findingDescription.trim() ? draft.findingDescription : draft.publicNotes || String(draft.response.limitationReason || ''),
        quotation: { ...rentalQuotation(draft.quotation), measurements: draft.quotation?.measurements || String(draft.response.measurement || ''), specification: draft.quotation?.specification || [draft.response.make, draft.response.model].filter(Boolean).join(' ') },
        quantity: draft.quantity ?? String((data.findings?.find((finding) => finding.itemId === item?.id)?.quantityMilli || 0) / 1000),
        unitLabel: draft.unitLabel || data.findings?.find((finding) => finding.itemId === item?.id)?.unitLabel || 'each' });
      setPage('finding'); return;
    }
    if (page === 'finding' || (page === 'answer' && RENTAL_ADVERSE_OUTCOMES.has(draft.outcome))) {
      if (editable && !draft.findingDescription.trim()) return setError('Add a short note about what you saw or could not check.');
      if (draft.severity === 'immediate_safety_risk') { setPage('safety'); return; }
    }
    if (editable) await perform('save', saveAnswer); else advanceQuestion();
  }
  async function saveMetadata() {
    if (!active || !field) return;
    if (queuedMetadata) { if (metadataIndex + 1 < metadata.length) setMetadataIndex(metadataIndex + 1); else setPage('review'); return; }
    if (field?.required && (field.type === 'checkbox' ? answers[field.key] !== true : !String(answers[field.key] || '').trim())) return setError('Complete this answer before continuing.');
    if (answers[field.key] === undefined) {
      if (metadataIndex + 1 < metadata.length) setMetadataIndex(metadataIndex + 1); else setPage('review');
      return;
    }
    await perform('metadata', async () => {
      const body = { action: 'save_module_answers', moduleId: active.id, expectedRevision: active.revision, answers: { [field.key]: answers[field.key] } };
      if (field.phase === 'final') await request(body);
      else {
        const record = await enqueueRentalSave({ workOrderId, body, module: active, draftKey: `metadata:${active.id}:${field.key}`, draftSnapshot: body.answers });
        setSaves((current) => [...current.filter((entry) => entry.id !== record.id), record]);
      }
      const remaining = { ...cacheRef.current.answers[active.id] }; delete remaining[field.key];
      const nextCache = { ...cacheRef.current, answers: { ...cacheRef.current.answers } };
      if (Object.keys(remaining).length) nextCache.answers[active.id] = remaining; else delete nextCache.answers[active.id];
      await persist(nextCache); cacheRef.current = nextCache; setCache(nextCache);
      if (metadataIndex + 1 < metadata.length) setMetadataIndex(metadataIndex + 1); else setPage('review');
    });
  }
  async function reviewQueuedAnswer() {
    const record = page === 'metadata' ? queuedMetadata : queuedAnswer;
    if (!record || !active) return;
    await perform('restore', async () => {
      const restored = isDraft(record.draftSnapshot)
        ? { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...record.draftSnapshot, photos: record.draftSnapshot.photos.map((photo) => record.photos.find((checkpoint) => checkpoint.uri === photo.uri) || photo).filter((photo) => !photo.mediaId || !data.evidence?.some((entry) => entry.jobMediaId === photo.mediaId && entry.status === 'active')) } } }
        : { ...cacheRef.current, answers: { ...cacheRef.current.answers, [active.id]: { ...cacheRef.current.answers[active.id], ...pendingAnswers } } };
      await persist(restored); cacheRef.current = restored; setCache(restored);
      await discardRentalSave(record.id);
      setError('Your answer is back in the form. Review it against the latest job before saving again.');
      if (page !== 'metadata') setPage('answer');
    });
  }
  function openQueuedAnswer(record: RentalSaveRecord) {
    const assessmentModule = data.modules?.find((entry) => entry.id === record.body.moduleId);
    if (!assessmentModule) return;
    setModuleId(assessmentModule.id);
    if (record.body.action === 'save_module_answers') {
      if (record.body.answers && typeof record.body.answers === 'object' && 'roomRoster' in record.body.answers) { setPage('categories'); setError(record.error); return; }
      const fields = assessmentModule.template.metadataFields.map(rentalAssessorMetadataField).filter((entry) => entry.key !== 'roomRoster'
        && entry.phase !== 'profile' && entry.source !== 'team_profile' && entry.source !== 'automatic'
        && !['coverageConfirmed', 'assessorDeclaration'].includes(entry.key)
        && !(assessmentModule.key === 'minimum_standards' && entry.key === 'credentialConfirmed'));
      const fieldKey = Object.keys(record.body.answers || {})[0];
      setMetadataIndex(Math.max(0, fields.findIndex((entry) => entry.key === fieldKey))); setPage('metadata');
    } else {
      const section = assessmentModule.template.sections.find((entry) => entry.key === record.body.sectionKey);
      if (!section) return;
      setCursor({ sectionKey: section.key, checkIndex: Math.max(0, section.checks.findIndex((entry) => entry.key === record.body.checkKey)), instanceKey: String(record.body.instanceKey || 'property') });
      setPage('answer');
    }
    setError('');
  }
  function openCompletionIssue(blockerKey: string) {
    if (!active) return;
    const target = rentalCompletionTarget(active, data.items || [], blockerKey);
    if (target?.kind === 'check') {
      const group = sections.find((entry) => entry.key === target.sectionKey);
      if (group) openCheck(group, target.checkIndex, target.instanceKey);
    } else if (target?.kind === 'metadata') {
      const index = metadata.findIndex((entry) => entry.key === target.fieldKey);
      if (index >= 0) { setMetadataIndex(index); setPage('metadata'); setError(''); }
      else setError('Finish the remaining checks and let their photos sync. The final declaration will then be ready.');
    } else setError(data.completion?.[active.id]?.blockers.find((entry) => entry.key === blockerKey)?.label || 'Review the property checks before finishing.');
  }
  async function finishAssessment() {
    if (!active) return;
    if (finishRequest && finishRequest.status !== 'conflict') {
      void processRentalSaveQueue(workOrderId).catch(() => { /* Sync displays the retained error. */ });
      return;
    }
    if (earlierDrafts.some(([draftKey]) => draftKey.endsWith(':property'))) {
      setPage('earlier'); setError('Review the photos saved on the earlier shower page before finishing.'); return;
    }
    const conflict = pendingSaves.find((entry) => !entry.finish && entry.status === 'conflict');
    if (conflict) { setError('A saved answer needs review before the report can finish. Use Open saved answer above. ' + conflict.error); return; }
    const blockers = completionBlockers;
    if (blockers.length) { setError('Finish needs this answer: ' + blockers[0].label + ' Tap the answer above to complete it.'); return; }
    if (activeHasDraft) { setPage('categories'); setError('Save the unfinished answers shown in the categories before finishing.'); return; }
    if (cache.answers[active.id]) { setError('Save the property details before finishing.'); return; }
    const email = data.permissions?.canIssue === true && Boolean(data.deliveryRecipient?.email);
    Alert.alert(email ? 'Finish and email report?' : 'Finish assessment?',
      'I have checked the property, recorded areas I could not access, and confirm this assessment is complete and accurate to the best of my knowledge.'
      + (email ? `\n\nThe completed report will be emailed to ${data.deliveryRecipient!.email} after its photos sync.` : '\n\nYour finish request will be saved on this phone and completed after photos sync.'), [
      { text: 'Review', style: 'cancel' },
      { text: email ? 'Confirm and email' : 'Confirm and finish', onPress: () => void perform('complete', async () => {
        await persist();
        const record = await enqueueRentalFinish({ workOrderId, module: active, reviewed: data, email, recipientEmail: data.deliveryRecipient?.email || '' });
        setSaves((current) => [...current.filter((entry) => entry.id !== record.id), record]);
        setPage('review');
        void onChanged().catch(() => { /* The durable finish request remains in Sync. */ });
      }) },
    ]);
  }
  function previous() {
    setError('');
    if (page === 'safety') return setPage(check?.responseType === 'outcome' ? 'answer' : 'finding');
    if (page === 'finding') { if (check?.responseType !== 'outcome' && responseFields.length) { setDetailIndex(responseFields.length - 1); return setPage('details'); } return setPage('answer'); }
    if (page === 'details') { if (detailIndex > 0) return setDetailIndex(detailIndex - 1); return setPage('answer'); }
    if (page === 'metadata' && metadataIndex > 0) return setMetadataIndex(metadataIndex - 1);
    if (page === 'answer' && section) {
      if (active?.key !== 'minimum_standards' && check?.repeatBy !== 'property') {
        const entries = repeatInstances(section, cursor.checkIndex);
        const index = entries.findIndex((entry) => entry.value === cursor.instanceKey);
        if (index > 0) return openCheck(section, cursor.checkIndex, entries[index - 1].value);
      }
      const stepIndex = propertySteps.findIndex((entry) => entry.section.key === section.key && entry.checkIndex === cursor.checkIndex);
      const prior = propertySteps[stepIndex - 1];
      if (prior) return openCheck(prior.section, prior.checkIndex);
    }
    setPage('categories');
  }
  // The form is inside the job route. Replaying the native back action would
  // remove that entire route, skipping both its sections and the job overview.
  usePreventRemove(true, () => backToSectionsOrJob());
  return <View style={styles.shell}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel={page === 'categories' ? 'Back to job' : 'Back to assessment sections'} disabled={page === 'categories' && Boolean(busy)} onPress={backToSectionsOrJob} style={styles.job}><MaterialCommunityIcons name="arrow-left" size={22} color={colours.green} /><Text style={styles.link}>{page === 'categories' ? 'Job' : 'Sections'}</Text></Pressable><Text style={styles.reference}>{data.inspection?.inspectionNumber || summary.inspectionNumber}</Text><Text style={styles.status}>{busy ? 'Saving on phone...' : saveStatus || (hasDraft ? 'Draft on phone' : 'Saved')}</Text></View>
    <KeyboardAwareScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      {!loaded ? <Text style={styles.body}>Opening assessment...</Text> : !active ? <Text style={styles.body}>{error || (!online ? 'Reconnect once to open this assessment. Your draft is saved on this phone.' : 'This assessment is not available.')}</Text> : <>
      {!online ? <Text style={styles.small}>Working offline. Answers and photos stay on this phone and sync when reception returns.</Text> : null}
      {pendingSaves.length ? <View style={styles.syncNotice}><Text style={styles.small}>{finishRequest ? 'Your finish request is saved. You can return to the job while it completes.' : `${pendingSaves.length} saved ${pendingSaves.length === 1 ? 'answer' : 'answers'}. You can keep assessing while they sync.`}{pendingPhotos ? ` ${pendingPhotos} ${pendingPhotos === 1 ? 'photo remains' : 'photos remain'} on this phone until linked to the report.` : ''}</Text>
        {pendingSaves.filter((entry) => entry.error).slice(0, 1).map((record) => <View key={record.id}><Text accessibilityRole="alert" style={styles.error}>{record.error}</Text>
          <FieldButton variant="quiet" onPress={() => record.finish ? setPage('review') : openQueuedAnswer(record)}>{record.finish ? 'Review finish request' : 'Open saved answer'}</FieldButton>
          {record.status !== 'conflict' ? <FieldButton variant="quiet" disabled={!online} onPress={() => { void processRentalSaveQueue(workOrderId).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not sync. Your answers remain on this phone.')); }}>Retry sync</FieldButton> : null}
        </View>)}
      </View> : null}
      {page === 'categories' ? <>
        <Text style={styles.title}>{active.key === 'minimum_standards' ? RENTAL_ASSESSOR_TITLE : active.title}</Text>
        {data.modules && data.modules.length > 1 ? <FieldSelect label="Assessment" value={active.id} disabled={Boolean(busy)} options={data.modules.map((m) => ({ value: m.id, label: m.title }))} onChange={setModuleId} /> : null}
        {editable && active.key === 'minimum_standards' && (active.template.assessmentScope !== 'current_minimum_standards' || Number(active.template.templateVersion || 1) < 3) ? <>
          <FieldButton disabled={Boolean(busy) || activeHasDraft || earlierDrafts.length > 0 || pendingSaves.length > 0 || !online} onPress={() => void perform('scope', async () => { await request({ action: 'set_assessment_scope', moduleId: active.id, scope: 'current_minimum_standards', expectedInspectionRevision: data.inspection?.revision, expectedModuleRevision: active.revision }); })}>Open the complete rental assessment</FieldButton>
          {earlierDrafts.length ? <Text style={styles.small}>Finish the answers under Earlier saved observations before updating this assessment.</Text> : null}
        </> : null}
        <Text style={styles.body}>Check the whole property once in each category. Add photos and total measurements where shown.</Text>
        {earlierItems.length || earlierDrafts.length ? <FieldButton variant="quiet" onPress={() => setPage('earlier')}>Earlier saved observations</FieldButton> : null}
        {sections.filter((entry) => propertySteps.some((step) => step.section.key === entry.key)).map((s) => {
          const steps = propertySteps.filter((step) => step.section.key === s.key);
          const count = steps.filter(({ checkIndex }) => { const c = s.checks[checkIndex];
          if (pendingSaves.some((entry) => entry.body.moduleId === active.id && entry.body.sectionKey === s.key && entry.body.checkKey === c.key && (active.key !== 'minimum_standards' || entry.body.instanceKey === 'property'))) return true;
          const entries = data.items?.filter((i) => i.moduleId === active.id && i.sectionKey === s.key && i.checkKey === c.key && (active.key !== 'minimum_standards' || i.instanceKey === 'property')) || [];
          const pending = Object.keys(cache.drafts).some((draftKey) => active.key === 'minimum_standards' ? draftKey === itemKey(active, { sectionKey: s.key, checkIndex, instanceKey: 'property' }) : draftKey.startsWith(draftPrefix(active) + [s.key, checkIndex].join(':') + ':'));
          return !pending && entries.length > 0 && entries.every((entry) => {
            const requirement = rentalAssessorEvidenceRequirement(c, entry.outcome);
            return entry.outcome && (data.evidence?.filter((e) => e.itemId === entry.id && e.status === 'active').length || 0) >= requirement.minimumFiles
              && (data.evidence?.filter((e) => e.itemId === entry.id && e.status === 'active' && e.contentType.startsWith('image/')).length || 0) >= requirement.minimumPhotos;
          });
        }).length;
          return <Pressable key={s.key} disabled={Boolean(busy)} onPress={() => openCheck(s, steps[0].checkIndex)} style={styles.category}><MaterialCommunityIcons name={count === steps.length ? 'check-circle-outline' : 'camera-outline'} size={23} color={colours.green} /><View style={styles.flex}><Text style={styles.categoryTitle}>{s.title}</Text><Text style={styles.small}>{count}/{steps.length} recorded</Text></View><MaterialCommunityIcons name="chevron-right" size={24} color={colours.green} /></Pressable>; })}
        <FieldButton variant="secondary" disabled={Boolean(busy)} onPress={() => { setMetadataIndex(0); setPage(active.status === 'complete' || !metadata.length ? 'review' : 'metadata'); }}>Review and finish</FieldButton>
      </> : page === 'earlier' ? <>
        <Text style={styles.title}>Earlier saved observations</Text>
        <Text style={styles.body}>These records and their evidence are retained. The property checks are answered separately for the whole dwelling.</Text>
        {earlierDrafts.length ? <Text style={styles.small}>Earlier unfinished answers and photos remain on this phone. Use Finish saved answer to include them in the report.</Text> : null}
        {earlierDrafts.map(([draftKey, previousDraft]) => <FieldButton key={draftKey} variant="secondary" onPress={() => {
          const [sectionKey, index, ...instance] = draftKey.slice(draftPrefix(active).length).split(':');
          const group = active.template.sections.find((entry) => entry.key === sectionKey);
          if (group) openCheck(group, Number(index), instance.join(':'));
        }}>Finish saved answer: {previousDraft.locationLabel || 'Earlier observation'}</FieldButton>)}
        {earlierItems.map((entry) => <View key={entry.id} style={styles.photo}>
          <Text style={styles.label}>{entry.locationLabel || 'Earlier observation'} | {sections.find((group) => group.key === entry.sectionKey)?.title || entry.sectionKey}</Text>
          <Text style={styles.body}>{readable(entry.outcome)}{entry.publicNotes ? ': ' + entry.publicNotes : ''}</Text>
          {Object.entries(entry.response).filter(([responseKey, value]) => responseKey !== 'roomId' && value !== '' && value !== null).map(([responseKey, value]) => <Text key={responseKey} style={styles.small}>{readable(responseKey)}: {String(value)}</Text>)}
          {(data.evidence || []).filter((photo) => photo.itemId === entry.id && photo.status === 'active').map((photo) => <Text key={photo.id} style={styles.small}>Evidence retained: {photo.caption || photo.fileName}</Text>)}
        </View>)}
      </> : page === 'metadata' && field ? <>
        <Text style={styles.small}>{field.phase === 'final' ? 'Final declaration' : 'Property details'} · {metadataIndex + 1} of {metadata.length}</Text>
        <Text style={styles.title}>{active.key === 'minimum_standards' && field.key === 'coverageConfirmed' ? 'I have checked the property and recorded any areas I could not access.' : field.label}</Text>
        {field.help ? <Text style={styles.body}>{field.help}</Text> : null}
        {field.key === 'areasNotAccessed' && accessSuggestion && !String(answers[field.key] || '').trim() ? <FieldButton variant="secondary" disabled={!editable || Boolean(busy) || Boolean(queuedMetadata)} onPress={() => changeAnswer(field.key, accessSuggestion)}>Use recorded access limitations</FieldButton> : null}
        {field.type === 'checkbox' ? <FieldButton variant={answers[field.key] === true ? 'primary' : 'secondary'} disabled={!editable || Boolean(busy) || Boolean(queuedMetadata)} onPress={() => changeAnswer(field.key, answers[field.key] !== true)}>{answers[field.key] === true ? 'Confirmed' : 'I confirm'}</FieldButton>
          : field.type === 'select' ? field.options.map((option) => <Pressable key={option.value} disabled={!editable || Boolean(busy) || Boolean(queuedMetadata)} onPress={() => changeAnswer(field.key, option.value)} style={[styles.category, answers[field.key] === option.value && styles.selected]}><Text style={styles.categoryTitle}>{option.label}</Text></Pressable>)
          : field.type === 'date' ? <FieldDatePicker label="Date" value={String(answers[field.key] || '')} disabled={!editable || Boolean(busy) || Boolean(queuedMetadata)} onChange={(value) => changeAnswer(field.key, value)} />
          : <TextInput editable={editable && !busy && !queuedMetadata} style={[styles.input, field.type === 'textarea' && styles.notes]} placeholder={field.required ? 'Enter details' : 'Optional'} value={String(answers[field.key] || '')} onChangeText={(v) => changeAnswer(field.key, v)} multiline={field.type === 'textarea'} maxLength={4000} />}
      </> : page === 'review' ? <>
        <Text style={styles.title}>{report ? 'Assessment report' : 'Review and finish'}</Text>
        {(active.template.metadataFields || []).map(rentalAssessorMetadataField).filter((f) => f.source === 'team_profile').map((f) => <Text key={f.key} style={styles.body}>{f.label}: {String(active.answers[f.key] || 'Not recorded in Team profile')}</Text>)}
        {!allComplete ? <>
          {completionBlockers.map((blocker) => <FieldButton key={blocker.key} variant="secondary" disabled={Boolean(busy)} onPress={() => openCompletionIssue(blocker.key)}>{blocker.label}</FieldButton>)}
          {pendingSaves.length ? <Text style={styles.small}>Photos are saved on this phone. You can finish and leave this screen while they upload. If the app is closed, sync resumes when it can run again.</Text> : null}
          <FieldButton disabled={Boolean(busy)} loading={busy === 'complete'} onPress={() => void finishAssessment()}>{finishRequest && finishRequest.status !== 'conflict' ? 'Finish saved | Retry sync' : data.deliveryRecipient?.email && data.permissions?.canIssue ? 'Finish and email report' : 'Finish assessment'}</FieldButton>
        </> : null}
        {!report && allComplete && data.permissions?.canIssue ? <FieldButton disabled={Boolean(busy)} loading={busy === 'complete'} onPress={() => void finishAssessment()}>{data.deliveryRecipient?.email ? 'Create and email report' : 'Create report'}</FieldButton> : null}
        {report && data.permissions?.canIssue && data.deliveryRecipient?.email && data.reportDelivery?.status !== 'accepted' ? <FieldButton disabled={Boolean(busy)} loading={busy === 'complete'} onPress={() => void finishAssessment()}>{finishRequest ? 'Retry report email' : 'Email report to client'}</FieldButton> : null}
        {data.reportDelivery?.status === 'accepted' ? <Text style={styles.body}>Report email accepted for delivery{data.reportDelivery.recipientEmail ? ` to ${data.reportDelivery.recipientEmail}` : ''}.</Text> : null}
        {finishRequest ? <><Text style={styles.body}>{finishRequest.status === 'conflict' ? finishRequest.error : finishRequest.finish?.email ? `Finish is saved. The report will be emailed to ${finishRequest.finish.recipientEmail} when sync and validation finish.` : 'Finish is saved and will complete when sync and validation finish.'}</Text><FieldButton variant="secondary" disabled={Boolean(busy)} onPress={() => void leave()}>Return to job</FieldButton></> : null}
        {report ? <><Text style={styles.body}>{report.reportNumber}</Text>{report.link?.shareUrl ? <><FieldButton onPress={() => void Share.share({ message: report.link?.shareUrl || '', url: report.link?.shareUrl })}>Share report</FieldButton><FieldButton variant="secondary" onPress={() => void Linking.openURL(report.link?.shareUrl || '')}>Open report</FieldButton></> : <Text style={styles.body}>The report is retained in this job. Ask the owner to manage its sharing link.</Text>}</> : null}
      </> : draft && item && section && check ? <>
        <Text style={styles.small}>{section.title + ' | ' + (cursor.checkIndex + 1) + ' of ' + section.checks.length}</Text>
        <Text style={styles.title}>{presentation?.prompt || check.prompt}</Text>
        {presentation?.help ? <Text style={styles.small}>{presentation.help}</Text> : null}
        {page === 'answer' ? <>
          {active.key !== 'minimum_standards' && check.repeatBy !== 'property' ? <>
            {repeatInstances(section, cursor.checkIndex).length > 1 ? <FieldSelect label="Recorded appliances or items" value={cursor.instanceKey} disabled={Boolean(busy)} options={repeatInstances(section, cursor.checkIndex)} onChange={(instance) => openCheck(section, cursor.checkIndex, instance)} /> : null}
            <RentalTextField label="Appliance, circuit or alarm location" value={draft.locationLabel} editable={editable && !busy} onChange={(value) => change({ locationLabel: value })} />
          </> : null}
          {check.assessmentPhase === 'energy_readiness_2027' ? <Text style={styles.small}>2027 energy readiness · {check.trigger}</Text> : null}
          <View style={styles.options}>{(showerCheck ? RENTAL_SHOWER_CHOICES : presentation?.outcomeOptions || []).map((option) => <Pressable key={option.value} disabled={!editable || Boolean(busy)} onPress={() => change(showerCheck ? rentalShowerChoicePatch(check, option.value, draft.response, draft.publicNotes) : { ...rentalAssessorOutcomePatch(check, option.value, draft.publicNotes), ...(option.value === 'specialist_verification_required' && check.key === 'room_ventilation' ? { findingDescription: 'Ventilation requirement not verified during this assessment.' } : {}) })} style={[styles.option, (showerCheck ? rentalShowerChoiceValue(draft) : draft.outcome) === option.value && styles.selected]}><Text style={styles.categoryTitle}>{option.label}</Text></Pressable>)}</View>
          {draft.outcome === 'not_applicable' && check.key !== 'vents_2027_readiness' && !(check.key === 'window_operation_security' && rentalWindowIsFixed(draft.outcome, draft.publicNotes)) ? <RentalTextField label="Why does this not apply?" value={draft.publicNotes} editable={editable && !busy} onChange={(v) => change({ publicNotes: v })} /> : null}
          {check.credentialGate && !['assigned_assessor', 'qualified_assessor'].includes(check.credentialGate) ? <Text style={styles.small}>Record what you can see and choose Specialist verification needed when licensed verification is needed.</Text> : null}
          {check.responseType === 'outcome' && draft.outcome && draft.outcome !== 'not_applicable' ? <>
            {sharedObservation.recordedKeys.length ? <View style={styles.syncNotice}>
              <Text style={styles.small}>Equipment details already recorded{sharedObservation.recordedKeys.map((fieldKey) => String(draft.response[fieldKey] ?? '')).filter(Boolean).length ? ': ' + sharedObservation.recordedKeys.map((fieldKey) => String(draft.response[fieldKey] ?? '')).filter(Boolean).join(' · ') : '.'}</Text>
              <Pressable disabled={!editable || Boolean(busy)} onPress={() => setEditEquipmentKey(editEquipmentKey === key ? '' : key)}><Text style={styles.link}>{editEquipmentKey === key ? 'Keep recorded details' : 'Edit equipment details'}</Text></Pressable>
            </View> : null}
            {responseFields.map((responseField) => <RentalObservationInput key={responseField.key} field={responseField} value={draft.response[responseField.key]} editable={editable && !busy}
              onChange={(value) => change({ response: { ...draft.response, [responseField.key]: value } })} />)}
          </> : null}
          {check.responseType === 'outcome' && RENTAL_ADVERSE_OUTCOMES.has(draft.outcome) ? <>
            <Text style={styles.label}>{rentalFindingDescriptionLabel(draft.outcome)}</Text>
            <View style={styles.options}>{findingChoices(draft.outcome).map((choice) => <Pressable key={choice} disabled={!editable || Boolean(busy)}
              onPress={() => change({ findingDescription: choice })} style={[styles.option, draft.findingDescription === choice && styles.selected]}><Text style={styles.categoryTitle}>{choice}</Text></Pressable>)}</View>
            <RentalTextField label="Details, if needed" value={draft.findingDescription} editable={editable && !busy} onChange={(value) => change({ findingDescription: value })} />
            <FieldButton variant={draft.severity === 'immediate_safety_risk' ? 'primary' : 'secondary'} disabled={!editable || Boolean(busy)} onPress={() => change({ severity: draft.severity === 'immediate_safety_risk' ? 'required' : 'immediate_safety_risk' })}>{draft.severity === 'immediate_safety_risk' ? 'Immediate danger flagged' : 'Flag an immediate danger'}</FieldButton>
          </> : null}
          <View style={styles.photo}>
            {photoRequirement.minimumFiles || photoRequirement.minimumPhotos ? <><Text style={styles.body}>{photoRequirement.reason}</Text>{active.key !== 'minimum_standards' ? <Text style={styles.small}>{check.photoGuidance}</Text> : null}</> : <Text style={styles.small}>No photo required for this answer. Add one if it helps explain your observation.</Text>}
            <FieldButton variant="secondary" disabled={!editable || Boolean(busy)} loading={busy === 'camera'} onPress={() => void capture()}>{photoRequirement.minimumFiles || photoRequirement.minimumPhotos ? 'Take photo' : 'Add optional photo'}</FieldButton>
            {evidence.length || draft.photos.length || photoRequirement.minimumFiles || photoRequirement.minimumPhotos ? <Text style={styles.small}>{evidence.length} linked · {draft.photos.length} on this phone{photoRequirement.minimumPhotos ? ' · ' + photoRequirement.minimumPhotos + ' photos required' : photoRequirement.minimumFiles ? ' · ' + photoRequirement.minimumFiles + ' evidence file required' : ''}</Text> : null}
          {draft.photos.map((p, index) => <View key={p.uri} style={styles.pendingPhoto}>
            <Image source={{ uri: p.uri }} style={styles.thumbnail} alt={`Pending photo ${index + 1}`} accessibilityLabel={`Pending photo ${index + 1}`} />
            <Text style={styles.small}>Photo {index + 1} saved {new Date(p.capture.captureObservedAtUtc).toLocaleTimeString()} · {p.mediaId ? 'Uploaded, ready to link' : p.location?.location.state === 'captured' ? 'GPS ' + Math.round(p.location.location.accuracyMetres || 0) + ' m' : p.locationPending ? 'Recording GPS; you can press Next' : 'GPS needs review; you can keep assessing'}</Text>
            {!p.mediaId && (p.location?.location.state !== 'captured' || p.location.location.accuracyMetres === null || p.location.location.accuracyMetres > 100 || p.location.location.mocked) ? <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => void refreshPhotoGps(index)}>Retry GPS</FieldButton> : null}
            <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => void removePhoto(p.uri)}>Remove pending photo</FieldButton>
          </View>)}</View>
          <Pressable onPress={() => setGuidanceOpen(!guidanceOpen)}><Text style={styles.link}>{guidanceOpen ? 'Hide guidance' : 'Standard and guidance'}</Text></Pressable>
          {guidanceOpen ? <><Text style={styles.body}>{check.help}</Text>{check.effectiveFrom ? <Text style={styles.small}>Applies from {check.effectiveFrom}. {check.trigger}</Text> : null}{check.sourceUrl ? <Pressable onPress={() => void Linking.openURL(check.sourceUrl || '')}><Text style={styles.link}>Official source</Text></Pressable> : null}<RentalTextField label="Optional report note" value={draft.publicNotes} editable={editable && !busy} onChange={(v) => change({ publicNotes: v })} multiline /></> : null}
          {active.key !== 'minimum_standards' && check.repeatBy !== 'property' ? <FieldButton variant="quiet" disabled={!editable || Boolean(busy)} onPress={() => void addServiceItem()}>Add another {readable(check.repeatBy)}</FieldButton> : null}
          {active.key !== 'minimum_standards' && check.repeatBy !== 'property' && !storedItem && !queuedAnswer && cache.drafts[key] && !draft.photos.length && !evidence.length ? <FieldButton variant="quiet" disabled={!editable || Boolean(busy)} onPress={() => Alert.alert('Discard unsaved item?', 'This removes this unfinished item from the draft.', [{ text: 'Keep item', style: 'cancel' }, { text: 'Discard item', style: 'destructive', onPress: () => void perform('discard', async () => {
            const currentDraft = cacheRef.current.drafts[key];
            if (!currentDraft || currentDraft.photos.length || (await getRentalSaveState(workOrderId)).records.some((record) => record.draftKey === key)) return;
            const nextCache = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts } }; delete nextCache.drafts[key];
            await persist(nextCache); cacheRef.current = nextCache; setCache(nextCache); setPage('categories');
          }) }])}>Discard unsaved item</FieldButton> : null}
        </> : page === 'details' && detailField ? <>
          <Text style={styles.small}>Test details · {detailIndex + 1} of {responseFields.length}</Text>
          <RentalObservationInput field={detailField} value={draft.response[detailField.key]} editable={editable && !busy} onChange={(value) => change({ response: { ...draft.response, [detailField.key]: value } })} />
        </> : page === 'finding' ? <>
          <RentalTextField label={rentalFindingDescriptionLabel(draft.outcome)} value={draft.findingDescription} editable={editable && !busy} onChange={(v) => change({ findingDescription: v })} multiline />
          <Text style={styles.small}>A short description is enough. The photos and measurements already recorded will appear with this note in the report.</Text>
          <FieldButton variant={draft.severity === 'immediate_safety_risk' ? 'primary' : 'secondary'} disabled={!editable || Boolean(busy)} onPress={() => change({ severity: draft.severity === 'immediate_safety_risk' ? 'required' : 'immediate_safety_risk' })}>{draft.severity === 'immediate_safety_risk' ? 'Immediate danger flagged' : 'Flag an immediate danger'}</FieldButton>
        </> : page === 'safety' ? <>
          <RentalTextField label="What was done to make it safe?" value={draft.immediateAction} editable={editable && !busy} onChange={(v) => change({ immediateAction: v })} multiline />
          <FieldButton variant={draft.notified ? 'primary' : 'secondary'} disabled={!editable || Boolean(busy)} onPress={() => change({ notified: !draft.notified })}>{draft.notified ? 'Notification confirmed' : 'Confirm responsible people were notified'}</FieldButton>
        </> : null}
      </> : null}
      </>}
      {(page === 'metadata' ? queuedMetadata : queuedAnswer)?.status === 'conflict' ? <FieldButton variant="secondary" disabled={Boolean(busy)} onPress={() => void reviewQueuedAnswer()}>Review saved answer</FieldButton> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </KeyboardAwareScrollView>
    {page !== 'categories' ? <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}><FieldButton variant="secondary" style={styles.flex} disabled={Boolean(busy)} onPress={previous}>Previous</FieldButton>
      {page === 'earlier' ? <FieldButton style={styles.flex} variant="secondary" onPress={() => setPage('categories')}>Sections</FieldButton> : page === 'metadata' ? <FieldButton style={styles.flex} disabled={Boolean(busy)} loading={busy === 'metadata'} onPress={() => { if (editable) void saveMetadata(); else if (metadataIndex + 1 < metadata.length) setMetadataIndex(metadataIndex + 1); else setPage('review'); }}>Next</FieldButton> : page === 'review' ? <FieldButton style={styles.flex} variant="secondary" onPress={() => setPage('categories')}>Sections</FieldButton> : <FieldButton style={styles.flex} disabled={Boolean(busy)} loading={busy === 'save'} onPress={() => void next()}>Next</FieldButton>}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colours.cream }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderColor: colours.line },
  job: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }, reference: { flex: 1, color: colours.muted, fontSize: 12 }, status: { color: colours.muted, fontSize: 11 },
  scroll: { flex: 1 }, content: { padding: spacing.md, gap: 14, paddingBottom: 24 }, flex: { flex: 1 }, title: { color: colours.ink, fontSize: 21, fontWeight: '700', lineHeight: 28 },
  body: { color: colours.muted, fontSize: 14, lineHeight: 20 }, small: { color: colours.muted, fontSize: 12, lineHeight: 18 }, label: { color: colours.ink, fontWeight: '600' },
  field: { gap: 8 }, input: { color: colours.ink, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, padding: 12, minHeight: 48 },
  notes: { minHeight: 72, maxHeight: 120, textAlignVertical: 'top' }, category: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, padding: 14, backgroundColor: colours.surface },
  categoryTitle: { color: colours.ink, fontSize: 15, fontWeight: '600' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minWidth: '46%', flexGrow: 1, flexBasis: '46%', minHeight: 54, justifyContent: 'center', padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.surface },
  selected: { borderColor: colours.green, backgroundColor: colours.mintStrong }, link: { color: colours.green, fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  photo: { gap: 8, backgroundColor: colours.surface, padding: 12, borderRadius: radius.sm }, footer: { flexDirection: 'row', gap: 12, padding: 12, paddingBottom: 20, borderTopWidth: 1, borderColor: colours.line, backgroundColor: colours.forest },
  pendingPhoto: { gap: 4, borderTopWidth: 1, borderColor: colours.line, paddingTop: 10 }, thumbnail: { width: 120, height: 90, resizeMode: 'cover', borderRadius: radius.sm },
  syncNotice: { gap: 4, padding: 10, borderLeftWidth: 3, borderLeftColor: colours.green, backgroundColor: colours.surface },
  error: { color: colours.red, fontSize: 14, lineHeight: 20 },
});
