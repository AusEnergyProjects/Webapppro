import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FieldButton } from '@/components/field-button';
import { FieldSelect } from '@/components/field-select';
import { FieldDatePicker } from '@/components/field-date-picker';
import { apiRequest } from '@/lib/api';
import { getSetting, setSetting } from '@/lib/database';
import { captureSessionId, observeLocation, observedTime } from '@/lib/evidence';
import { RENTAL_ADVERSE_OUTCOMES, RENTAL_OUTCOMES, RENTAL_READINESS_OUTCOMES, newRentalItem,
  rentalObservationsComplete, rentalAdjacentQuestion, deliverRentalPhoto, rentalAccessLimitations,
  type RentalAssessmentItem, type RentalAssessmentResult,
  type RentalAssessmentModule, type RentalAssessmentSection } from '@/lib/rental-inspection';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldRentalInspectionSummary } from '@/lib/types';
import { RENTAL_QUOTATION_FIELDS, rentalQuotation, rentalQuotationGuidance } from '../../../src/lib/rental-quotation.mjs';

type Props = { workOrderId: string; summary: FieldRentalInspectionSummary; online: boolean; onChanged: () => Promise<void>; onReturnToJob?: () => void };
type Photo = { uri: string; width: number; height: number; capture: ReturnType<typeof observedTime>; location: Awaited<ReturnType<typeof observeLocation>> | null; mediaId?: string };
type Draft = { outcome: string; locationLabel: string; publicNotes: string; internalNotes: string;
  findingTitle: string; findingDescription: string; scopeSummary: string;
  quantity: string; unitLabel: string; quotation: Record<string, string>;
  severity: string; immediateAction: string; notified: boolean; response: Record<string, unknown>; photos: Photo[] };
type Cursor = { sectionKey: string; checkIndex: number; instanceKey: string };
type Page = 'categories' | 'answer' | 'details' | 'finding' | 'safety' | 'metadata' | 'review';
type Cache = { drafts: Record<string, Draft>; answers: Record<string, Record<string, unknown>> };
const emptyCache: Cache = { drafts: {}, answers: {} };
const ENDPOINT = '/api/trade-rental-inspections';
const readable = (s: string) => s.replaceAll('_', ' ');
const draftPrefix = (module: RentalAssessmentModule) => [module.id, module.template.assessmentScope || 'legacy', module.template.templateVersion || 1].join(':') + ':';
const itemKey = (module: RentalAssessmentModule, cursor: Cursor) => draftPrefix(module) + [cursor.sectionKey, cursor.checkIndex, cursor.instanceKey].join(':');
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
export function RentalInspectionWorkflow({ workOrderId, summary, online, onChanged, onReturnToJob }: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
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
  const scroll = useRef<ScrollView>(null);
  const cacheRef = useRef(cache);
  const cacheKey = 'rental-wizard:' + workOrderId;
  const pendingWrite = useRef(Promise.resolve());
  const loadedCacheKey = useRef('');
  useEffect(() => { cacheRef.current = cache; }, [cache]);
  const persist = useCallback((value = cacheRef.current) => {
    pendingWrite.current = pendingWrite.current.catch(() => undefined).then(() => setSetting(cacheKey, JSON.stringify(value)));
    return pendingWrite.current;
  }, [cacheKey]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        if (loadedCacheKey.current !== cacheKey) {
          const stored = await getSetting(cacheKey);
          if (stored) {
            const local: Cache = JSON.parse(stored);
            if (local && local.drafts && local.answers && typeof local.drafts === 'object' && !Array.isArray(local.drafts)
              && typeof local.answers === 'object' && !Array.isArray(local.answers) && live) { setCache(local); cacheRef.current = local; }
          }
          if (live) loadedCacheKey.current = cacheKey;
        }
        if (!online) return;
        const result = await apiRequest<RentalAssessmentResult>(ENDPOINT + '?workOrderId=' + encodeURIComponent(workOrderId));
        if (live) { setData(result); setModuleId((selected) => result.modules?.some((entry) => entry.id === selected) ? selected : result.modules?.[0]?.id || ''); }
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not open the assessment.'); }
      finally { if (live) setLoaded(true); }
    })();
    return () => { live = false; };
  }, [workOrderId, cacheKey, online]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { void persist().catch(() => setError('The draft could not be saved on this phone. Keep this screen open and retry.')); }, 200);
    return () => clearTimeout(timer);
  }, [cache, loaded, persist]);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [page, cursor, metadataIndex, detailIndex]);
  const hasDraft = Object.keys(cache.drafts).length > 0 || Object.keys(cache.answers).length > 0;
  usePreventRemove(Boolean(busy) || hasDraft, ({ data: navigationEvent }) => {
    if (busy) return Alert.alert('Saving', 'Wait for this action to finish before leaving.');
    void persist().then(() => navigation.dispatch(navigationEvent.action))
      .catch(() => setError('The draft could not be saved on this phone. Keep the assessment open and retry.'));
  });
  const active = data.modules?.find((m) => m.id === moduleId) || data.modules?.[0];
  const sections = active?.template.sections || [];
  const section = sections.find((s) => s.key === cursor.sectionKey);
  const check = section?.checks[cursor.checkIndex];
  const storedItem = data.items?.find((i) => i.moduleId === active?.id && i.sectionKey === cursor.sectionKey && i.checkKey === check?.key && i.instanceKey === cursor.instanceKey);
  const item = active && section && check ? storedItem || newRentalItem(active, section, check, cursor.instanceKey) : undefined;
  const key = active ? itemKey(active, cursor) : '';
  const draft = item ? cache.drafts[key] || initialDraft(item, data) : undefined;
  const responseFields = draft && ['meets', 'does_not_meet'].includes(draft.outcome) ? check?.responseFields || [] : [];
  const detailField = responseFields[detailIndex];
  const editable = online && data.permissions?.canEdit === true && active?.status !== 'complete';
  const activeHasDraft = active ? Object.keys(cache.drafts).some((entry) => entry.startsWith(draftPrefix(active))) : false;
  const observationsReady = active ? rentalObservationsComplete(data, active.id) && !activeHasDraft : false;
  const metadata = active?.template.metadataFields.filter((f) => f.phase !== 'profile' && f.source !== 'team_profile'
    && (f.phase !== 'final' || observationsReady)) || [];
  const answers = active ? cache.answers[active.id] || active.answers : {};
  const accessSuggestion = active ? rentalAccessLimitations(data.items || [], active.id) : '';
  const field = metadata[metadataIndex];
  const report = data.reports?.find((r) => r.status === 'issued');
  const allComplete = data.modules?.every((m) => m.status === 'complete') === true;
  const evidence = item ? data.evidence?.filter((e) => e.itemId === item.id && e.status === 'active') || [] : [];
  function change(values: Partial<Draft>) {
    if (!draft) return;
    const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...(cacheRef.current.drafts[key] || draft), ...values } } };
    cacheRef.current = next; setCache(next);
  }
  async function request(body: Record<string, unknown>) {
    if (!online) throw new Error('Reconnect to save this assessment. Your draft stays on this phone.');
    const result = await apiRequest<RentalAssessmentResult>(ENDPOINT, { method: 'POST', body: JSON.stringify({ workOrderId, ...body }) });
    if (!result.ok) throw new Error(result.error || 'The assessment could not be saved.');
    setData(result);
    if (active && ['save_item', 'link_evidence', 'unlink_evidence', 'reopen_module', 'set_assessment_scope'].includes(String(body.action)) && cacheRef.current.answers[active.id]) {
      const pendingAnswers = { ...cacheRef.current.answers[active.id], coverageConfirmed: false, assessorDeclaration: false, credentialConfirmed: false };
      const nextCache = { ...cacheRef.current, answers: { ...cacheRef.current.answers, [active.id]: pendingAnswers } };
      setCache(nextCache); cacheRef.current = nextCache; await persist(nextCache);
    }
    return result;
  }
  async function perform(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError('');
    try { await action(); } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
      if (online) {
        try { const latest = await apiRequest<RentalAssessmentResult>(ENDPOINT + '?workOrderId=' + encodeURIComponent(workOrderId)); if (latest.ok) setData(latest); }
        catch { /* The local draft remains available while the connection is unavailable. */ }
      }
    }
    finally { setBusy(''); }
  }
  async function leave() {
    await perform('leave', async () => { await persist(); onReturnToJob?.(); });
  }
  function openCheck(s: RentalAssessmentSection, index = 0, instanceKey?: string) {
    const target = s.checks[index];
    const prior = data.items?.find((i) => i.moduleId === active?.id && i.sectionKey === s.key && i.checkKey === target.key);
    setCursor({ sectionKey: s.key, checkIndex: index, instanceKey: instanceKey || prior?.instanceKey || (target.repeatBy === 'property' ? 'property' : 'first') });
    setGuidanceOpen(false);
    setPage('answer');
  }
  function repeatInstances(s: RentalAssessmentSection, index: number) {
    if (!active) return [];
    const prefix = draftPrefix(active) + [s.key, index].join(':') + ':';
    const saved = (data.items || []).filter((entry) => entry.moduleId === active.id && entry.sectionKey === s.key && entry.checkKey === s.checks[index].key)
      .map((entry) => ({ value: entry.instanceKey, label: entry.locationLabel || 'Recorded item' }));
    for (const [draftKey, local] of Object.entries(cache.drafts)) {
      if (!draftKey.startsWith(prefix)) continue;
      const value = draftKey.slice(prefix.length);
      if (!saved.some((entry) => entry.value === value)) saved.push({ value, label: local.locationLabel || 'Unsaved item' });
    }
    return saved;
  }
  function advanceQuestion() {
    if (!section || !check) return;
    if (check.repeatBy !== 'property') {
      const entries = repeatInstances(section, cursor.checkIndex);
      const index = entries.findIndex((entry) => entry.value === cursor.instanceKey);
      if (index >= 0 && entries[index + 1]) return openCheck(section, cursor.checkIndex, entries[index + 1].value);
    }
    const target = rentalAdjacentQuestion(sections, section.key, cursor.checkIndex, 1);
    if (target) openCheck(target.section, target.checkIndex);
    else { setMetadataIndex(0); setPage(editable && metadata.length ? 'metadata' : 'review'); }
  }
  function changeAnswer(fieldKey: string, value: unknown) {
    if (!active) return;
    const nextCache = { ...cacheRef.current, answers: { ...cacheRef.current.answers, [active.id]: { ...answers, [fieldKey]: value } } };
    cacheRef.current = nextCache; setCache(nextCache);
  }
  async function capture() {
    if (!editable || !draft) return;
    await perform('camera', async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow TLink to use the camera in Settings.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => void Linking.openSettings() }]);
        return;
      }
      const captured = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: true, cameraType: ImagePicker.CameraType.back });
      if (captured.canceled || !captured.assets[0]) return;
      const asset = captured.assets[0];
      const suffix = asset.mimeType === 'image/heic' ? '.heic' : asset.mimeType === 'image/png' ? '.png' : '.jpg';
      const retained = new File(Paths.document, 'rental-photo-' + Crypto.randomUUID() + suffix);
      new File(asset.uri).copy(retained);
      // Retain the captured bytes before asking for location; a failed GPS fix must not lose the photo.
      const photo: Photo = { uri: retained.uri, width: asset.width, height: asset.height, capture: observedTime(), location: null };
      const currentDraft = cacheRef.current.drafts[key] || draft;
      const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...currentDraft, photos: [...currentDraft.photos, photo] } } };
      setCache(next); cacheRef.current = next; await persist(next);
      const location = await observeLocation(true);
      await updatePhoto(photo.uri, { location });
      if (location.location.state !== 'captured') setError('Photo saved on this phone. Enable location, then retry its GPS before continuing.');
    });
  }
  async function updatePhoto(uri: string, values: Partial<Photo>) {
    const currentDraft = cacheRef.current.drafts[key];
    if (!currentDraft) throw new Error('The photo draft is no longer available.');
    const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...currentDraft,
      photos: currentDraft.photos.map((photo) => photo.uri === uri ? { ...photo, ...values } : photo) } } };
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
      await updatePhoto(photo.uri, { location });
    });
  }
  async function uploadPhoto(photo: Photo, saved: RentalAssessmentItem, current: RentalAssessmentResult) {
    return deliverRentalPhoto({ mediaId: photo.mediaId,
      remember: (mediaId) => updatePhoto(photo.uri, { mediaId }),
      link: (mediaId) => current.evidence?.some((entry) => entry.itemId === saved.id && entry.jobMediaId === mediaId && entry.status === 'active')
        ? Promise.resolve(current) : request({ action: 'link_evidence', itemId: saved.id, jobMediaId: mediaId, purpose: check?.prompt,
          expectedModuleRevision: current.modules?.find((m) => m.id === active?.id)?.revision }),
      upload: async () => {
    const observation = photo.location;
    const location = observation?.location;
    if (!location || location.state !== 'captured' || location.mocked === true || location.accuracyMetres === null || location.accuracyMetres > 100
      || Math.abs(Date.parse(location.observedAtUtc) - Date.parse(photo.capture.captureObservedAtUtc)) > 120000) throw new Error('Photo saved locally. A capture-time location within 100 m accuracy is required; retry GPS or remove and retake it.');
    const image = ImageManipulator.manipulate(photo.uri);
    if (photo.width > 1600) image.resize({ width: 1600, height: null });
    const rendered = await image.renderAsync();
    const prepared = await rendered.saveAsync({ compress: 0.62, format: SaveFormat.JPEG });
    const file = new File(prepared.uri);
    if (file.size > 8 * 1024 * 1024 || file.size + (current.evidenceBudget?.usedBytes || 0) > (current.evidenceBudget?.maxBytes || 32 * 1024 * 1024)) throw new Error('The report photo limit has been reached. This photo remains on the phone.');
    const form = new FormData();
    form.append('workOrderId', workOrderId); form.append('category', 'progress'); form.append('caption', check?.prompt.slice(0, 300) || '');
    form.append('evidenceEnvelope', JSON.stringify({ schemaVersion: 1, kind: 'tlink-rental-inspection-photo', captureSessionId: captureSessionId(), source: 'in_app_camera',
      capture: photo.capture, locationPermission: observation.permission, location,
      processing: { privacySafeDerivative: true, exifCopied: false, outputFormat: 'image/jpeg', widthPixels: prepared.width, heightPixels: prepared.height, maximumWidthPixels: 1600 } }));
    form.append('file', file);
    const uploaded = await apiRequest<{ media?: { id: string }[] }>('/api/trade-field-work', { method: 'POST', body: form });
    return uploaded.media?.[0]?.id || '';
      },
    });
  }
  async function saveAnswer() {
    if (!active || !item || !draft || !section || !check) return;
    if (!draft.outcome) throw new Error('Choose an answer.');
    if (check.repeatBy !== 'property' && !draft.locationLabel.trim()) throw new Error('Add the room or item location.');
    if (draft.outcome === 'not_applicable' && !draft.publicNotes.trim()) throw new Error('Explain why this check does not apply.');
    const adverse = RENTAL_ADVERSE_OUTCOMES.has(draft.outcome);
    if (adverse && (!Number.isFinite(Number(draft.quantity || 0)) || Number(draft.quantity || 0) < 0 || Number(draft.quantity || 0) > 1000000)) throw new Error('Enter a valid quantity, or leave it blank when not measured.');
    if (adverse && (!draft.findingDescription.trim() || !draft.scopeSummary.trim())) throw new Error('Complete the finding and recommended work.');
    if (adverse && draft.severity === 'immediate_safety_risk' && (!draft.immediateAction.trim() || !draft.notified)) throw new Error('Record the make-safe action and notification.');
    const existingFinding = data.findings?.find((finding) => finding.itemId === item.id);
    let current = await request({ action: 'save_item', moduleId: active.id, expectedModuleRevision: active.revision,
      expectedItemRevision: item.revision, sectionKey: section.key, checkKey: check.key, instanceKey: item.instanceKey,
      locationLabel: draft.locationLabel.trim(), outcome: draft.outcome, response: draft.response, publicNotes: draft.publicNotes.trim(), internalNotes: draft.internalNotes.trim(), sortOrder: item.sortOrder,
      finding: adverse ? { ...existingFinding, title: draft.findingTitle.trim() || section.title + ': ' + readable(draft.outcome), description: draft.findingDescription.trim(),
        scopeSummary: draft.scopeSummary.trim(), severity: draft.severity, recommendedAction: draft.scopeSummary.trim(),
        quantityMilli: Math.round(Number(draft.quantity || 0) * 1000), unitLabel: draft.unitLabel || 'each',
        details: { ...existingFinding?.details, quotation: draft.quotation, immediateAction: draft.immediateAction.trim(), responsiblePeopleNotified: draft.notified } } : undefined });
    const saved = current.items?.find((i) => i.moduleId === active.id && i.sectionKey === section.key && i.checkKey === check.key && i.instanceKey === item.instanceKey);
    if (!saved) throw new Error('The saved answer was not returned.');
    let remaining = [...draft.photos];
    for (const photo of draft.photos) {
      current = await uploadPhoto(photo, saved, current);
      remaining = remaining.slice(1);
      const partial = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts, [key]: { ...draft, photos: remaining } } };
      setCache(partial); cacheRef.current = partial; await persist(partial);
    }
    const photos = current.evidence?.filter((e) => e.itemId === saved.id && e.status === 'active').length || 0;
    if (photos < check.requiredEvidenceCount) throw new Error('Answer saved. Add the required photo before moving on.');
    if (adverse && (current.evidence?.filter((e) => e.itemId === saved.id && e.status === 'active' && e.contentType.startsWith('image/')).length || 0) < 2) throw new Error('Answer saved. Add an overview and close photo of the proposed work before moving on.');
    const next = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts } }; delete next.drafts[key];
    setCache(next); cacheRef.current = next; await persist(next); await onChanged();
    advanceQuestion();
  }
  async function next() {
    if (!draft || !check) return;
    if (!draft.outcome) { if (!editable) return advanceQuestion(); return setError('Choose an answer.'); }
    if (page === 'answer' && responseFields.length) { setDetailIndex(0); setPage('details'); return; }
    if (page === 'details') {
      if (editable && detailField?.required && !String(draft.response[detailField.key] || '').trim()) return setError('Record this result before continuing.');
      if (check.responseType !== 'outcome' && detailIndex + 1 < responseFields.length) { setDetailIndex(detailIndex + 1); return; }
    }
    if ((page === 'answer' || page === 'details') && RENTAL_ADVERSE_OUTCOMES.has(draft.outcome)) {
      change({ findingDescription: draft.findingDescription.trim() ? draft.findingDescription : draft.publicNotes,
        quotation: { ...rentalQuotation(draft.quotation), measurements: draft.quotation?.measurements || String(draft.response.measurement || ''), specification: draft.quotation?.specification || [draft.response.make, draft.response.model].filter(Boolean).join(' ') },
        quantity: draft.quantity ?? String((data.findings?.find((finding) => finding.itemId === item?.id)?.quantityMilli || 0) / 1000),
        unitLabel: draft.unitLabel || data.findings?.find((finding) => finding.itemId === item?.id)?.unitLabel || 'each' });
      setPage('finding'); return;
    }
    if (page === 'finding') {
      if (editable && (!draft.findingDescription.trim() || !draft.scopeSummary.trim())) return setError('Add the observed problem and recommended work.');
      if (draft.severity === 'immediate_safety_risk') { setPage('safety'); return; }
    }
    if (editable) await perform('save', saveAnswer); else advanceQuestion();
  }
  async function saveMetadata() {
    if (!active) return;
    if (field?.required && (field.type === 'checkbox' ? answers[field.key] !== true : !String(answers[field.key] || '').trim())) return setError('Complete this answer before continuing.');
    await perform('metadata', async () => {
      await request({ action: 'save_module_answers', moduleId: active.id, expectedRevision: active.revision, answers });
      const nextCache = { ...cacheRef.current, answers: { ...cacheRef.current.answers } }; delete nextCache.answers[active.id];
      setCache(nextCache); cacheRef.current = nextCache; await persist(nextCache);
      if (metadataIndex + 1 < metadata.length) setMetadataIndex(metadataIndex + 1); else setPage('review');
    });
  }
  function previous() {
    setError('');
    if (page === 'safety') return setPage('finding');
    if (page === 'finding') { if (responseFields.length) { setDetailIndex(responseFields.length - 1); return setPage('details'); } return setPage('answer'); }
    if (page === 'details') { if (detailIndex > 0) return setDetailIndex(detailIndex - 1); return setPage('answer'); }
    if (page === 'metadata' && metadataIndex > 0) return setMetadataIndex(metadataIndex - 1);
    if (page === 'answer' && section) {
      const entries = repeatInstances(section, cursor.checkIndex);
      const index = entries.findIndex((entry) => entry.value === cursor.instanceKey);
      if (index > 0) return openCheck(section, cursor.checkIndex, entries[index - 1].value);
      const prior = rentalAdjacentQuestion(sections, section.key, cursor.checkIndex, -1);
      if (prior) return openCheck(prior.section, prior.checkIndex);
    }
    setPage('categories');
  }
  return <View style={styles.shell}>
    <View style={styles.header}><Pressable disabled={Boolean(busy)} onPress={() => void leave()} style={styles.job}><MaterialCommunityIcons name="arrow-left" size={22} color={colours.green} /><Text style={styles.link}>Job</Text></Pressable><Text style={styles.reference}>{data.inspection?.inspectionNumber || summary.inspectionNumber}</Text><Text style={styles.status}>{busy ? 'Saving...' : hasDraft ? 'Draft on phone' : 'Saved'}</Text></View>
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content}
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
      onFocus={(event) => scroll.current?.scrollResponderScrollNativeHandleToKeyboard(event.target, 96, true)}>
      {!loaded ? <Text style={styles.body}>Opening assessment...</Text> : !online ? <Text style={styles.body}>Reconnect to load the assessment. Your draft is saved on this phone.</Text> : !active ? <Text style={styles.body}>{error || 'This assessment is not available.'}</Text> : <>
      {page === 'categories' ? <>
        <Text style={styles.title}>{active.title}</Text>
        {data.modules && data.modules.length > 1 ? <FieldSelect label="Assessment" value={active.id} disabled={Boolean(busy)} options={data.modules.map((m) => ({ value: m.id, label: m.title }))} onChange={setModuleId} /> : null}
        {active.key === 'minimum_standards' && active.status !== 'complete' ? <FieldSelect label="Assessment scope" value={active.template.assessmentScope || 'current_minimum_standards'} disabled={!editable || Boolean(busy)} options={[{ value: 'current_minimum_standards', label: 'Full minimum standards + 2027 readiness' }, { value: 'energy_readiness_2027', label: '2027 energy readiness only' }]} onChange={(scope) => {
          Alert.alert('Change assessment scope?', 'Saved observations remain in the job history. This changes the checklist for this unissued assessment.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Use this scope', onPress: () => void perform('scope', async () => {
            await request({ action: 'set_assessment_scope', moduleId: active.id, scope, expectedInspectionRevision: data.inspection?.revision, expectedModuleRevision: active.revision }); setPage('categories');
          }) }]);
        }} /> : null}
        {editable && active.key === 'minimum_standards' && (active.template.assessmentScope !== 'current_minimum_standards' || Number(active.template.templateVersion || 1) < 3) ? <FieldButton disabled={Boolean(busy) || activeHasDraft} onPress={() => void perform('scope', async () => { await request({ action: 'set_assessment_scope', moduleId: active.id, scope: 'current_minimum_standards', expectedInspectionRevision: data.inspection?.revision, expectedModuleRevision: active.revision }); })}>Expand to full assessment + 2027 readiness</FieldButton> : null}
        <Text style={styles.body}>Choose a category. Answer, take the photo, then tap Next.</Text>
        {sections.map((s) => { const count = s.checks.filter((c, checkIndex) => {
          const entries = data.items?.filter((i) => i.moduleId === active.id && i.sectionKey === s.key && i.checkKey === c.key) || [];
          const pending = Object.keys(cache.drafts).some((draftKey) => draftKey.startsWith(draftPrefix(active) + [s.key, checkIndex].join(':') + ':'));
          return !pending && entries.length > 0 && entries.every((entry) => entry.outcome && (data.evidence?.filter((e) => e.itemId === entry.id && e.status === 'active').length || 0) >= c.requiredEvidenceCount
            && (!RENTAL_ADVERSE_OUTCOMES.has(entry.outcome) || (data.evidence?.filter((e) => e.itemId === entry.id && e.status === 'active' && e.contentType.startsWith('image/')).length || 0) >= 2));
        }).length;
          return <Pressable key={s.key} disabled={Boolean(busy)} onPress={() => openCheck(s)} style={styles.category}><MaterialCommunityIcons name={count === s.checks.length ? 'check-circle-outline' : 'camera-outline'} size={23} color={colours.green} /><View style={styles.flex}><Text style={styles.categoryTitle}>{s.title}</Text><Text style={styles.small}>{count}/{s.checks.length} checked</Text></View><MaterialCommunityIcons name="chevron-right" size={24} color={colours.green} /></Pressable>; })}
        <FieldButton variant="secondary" disabled={Boolean(busy)} onPress={() => { setMetadataIndex(0); setPage(active.status === 'complete' || !metadata.length ? 'review' : 'metadata'); }}>Review and finish</FieldButton>
        {!observationsReady && active.status !== 'complete' ? <Text style={styles.small}>The final declaration appears after all answers and required photos are saved.</Text> : null}
      </> : page === 'metadata' && field ? <>
        <Text style={styles.small}>{field.phase === 'final' ? 'Final declaration' : 'Property details'} · {metadataIndex + 1} of {metadata.length}</Text>
        <Text style={styles.title}>{field.label}</Text>
        {field.help ? <Text style={styles.body}>{field.help}</Text> : null}
        {field.key === 'areasNotAccessed' && accessSuggestion && !String(answers[field.key] || '').trim() ? <FieldButton variant="secondary" disabled={!editable || Boolean(busy)} onPress={() => changeAnswer(field.key, accessSuggestion)}>Use recorded access limitations</FieldButton> : null}
        {field.type === 'checkbox' ? <FieldButton variant={answers[field.key] === true ? 'primary' : 'secondary'} disabled={!editable || Boolean(busy)} onPress={() => changeAnswer(field.key, answers[field.key] !== true)}>{answers[field.key] === true ? 'Confirmed' : 'I confirm'}</FieldButton>
          : field.type === 'select' ? field.options.map((option) => <Pressable key={option.value} disabled={!editable || Boolean(busy)} onPress={() => changeAnswer(field.key, option.value)} style={[styles.category, answers[field.key] === option.value && styles.selected]}><Text style={styles.categoryTitle}>{option.label}</Text></Pressable>)
          : field.type === 'date' ? <FieldDatePicker label="Date" value={String(answers[field.key] || '')} disabled={!editable || Boolean(busy)} onChange={(value) => changeAnswer(field.key, value)} />
          : <TextInput editable={editable && !busy} style={[styles.input, field.type === 'textarea' && styles.notes]} placeholder={field.required ? 'Enter details' : 'Optional'} value={String(answers[field.key] || '')} onChangeText={(v) => changeAnswer(field.key, v)} multiline={field.type === 'textarea'} maxLength={4000} />}
      </> : page === 'review' ? <>
        <Text style={styles.title}>{report ? 'Assessment report' : 'Review and finish'}</Text>
        {(active.template.metadataFields || []).filter((f) => f.source === 'team_profile').map((f) => <Text key={f.key} style={styles.body}>{f.label}: {String(active.answers[f.key] || 'Not recorded in Team profile')}</Text>)}
        {!allComplete ? <>
          {(data.completion?.[active.id]?.blockers || []).map((b) => <Text key={b.key} style={styles.error}>{b.label}</Text>)}
          <FieldButton disabled={active.status === 'complete' || !data.completion?.[active.id]?.complete || activeHasDraft || Boolean(cache.answers[active.id]) || Boolean(busy)} loading={busy === 'complete'} onPress={() => void perform('complete', async () => { if (active.status === 'complete') return; await request({ action: 'complete_module', moduleId: active.id, expectedRevision: active.revision }); await onChanged(); })}>{active.status === 'complete' ? 'Module complete' : 'Complete assessment'}</FieldButton>
        </> : null}
        {!report && data.permissions?.canIssue ? <FieldButton disabled={!allComplete || Boolean(busy)} loading={busy === 'issue'} onPress={() => void perform('issue', async () => { await request({ action: 'issue_report' }); await onChanged(); })}>Create report</FieldButton> : null}
        {report ? <><Text style={styles.body}>{report.reportNumber}</Text>{report.link?.shareUrl ? <><FieldButton onPress={() => void Share.share({ message: report.link?.shareUrl || '', url: report.link?.shareUrl })}>Share report</FieldButton><FieldButton variant="secondary" onPress={() => void Linking.openURL(report.link?.shareUrl || '')}>Open report</FieldButton></> : <Text style={styles.body}>The report is retained in this job. Ask the owner to manage its sharing link.</Text>}</> : null}
      </> : draft && item && section && check ? <>
        <Text style={styles.small}>{section.title} · {cursor.checkIndex + 1} of {section.checks.length}</Text>
        <Text style={styles.title}>{check.prompt}</Text>
        {page === 'answer' ? <>
          {check.repeatBy !== 'property' ? <>
            {repeatInstances(section, cursor.checkIndex).length > 0 ? <FieldSelect label="Recorded items" value={cursor.instanceKey} disabled={Boolean(busy)} options={repeatInstances(section, cursor.checkIndex)} onChange={(instance) => openCheck(section, cursor.checkIndex, instance)} /> : null}
            <RentalTextField label="Room or item location" value={draft.locationLabel} editable={editable && !busy} onChange={(v) => change({ locationLabel: v })} />
          </> : null}
          {check.assessmentPhase === 'energy_readiness_2027' ? <Text style={styles.small}>2027 energy readiness · {check.trigger}</Text> : null}
          <View style={styles.options}>{(check.assessmentPhase === 'energy_readiness_2027' || (!check.assessmentPhase && active.template.assessmentScope === 'energy_readiness_2027') ? RENTAL_READINESS_OUTCOMES : RENTAL_OUTCOMES).map((option) => <Pressable key={option.value} disabled={!editable || Boolean(busy)} onPress={() => change({ outcome: option.value })} style={[styles.option, draft.outcome === option.value && styles.selected]}><Text style={styles.categoryTitle}>{option.label}</Text></Pressable>)}</View>
          {draft.outcome === 'not_applicable' ? <RentalTextField label="Why does this not apply?" value={draft.publicNotes} editable={editable && !busy} onChange={(v) => change({ publicNotes: v })} multiline /> : null}
          <View style={styles.photo}><Text style={styles.body}>{check.photoGuidance}</Text>{RENTAL_ADVERSE_OUTCOMES.has(draft.outcome) ? <Text style={styles.small}>Include an overview and close detail with a scale or readable label so the work can be quoted.</Text> : null}<FieldButton variant="secondary" disabled={!editable || Boolean(busy)} loading={busy === 'camera'} onPress={() => void capture()}>Take photo</FieldButton><Text style={styles.small}>{evidence.length} linked · {draft.photos.length} on this phone · {Math.max(check.requiredEvidenceCount, RENTAL_ADVERSE_OUTCOMES.has(draft.outcome) ? 2 : 0)} required{RENTAL_ADVERSE_OUTCOMES.has(draft.outcome) ? ' (at least 2 photos)' : ''}</Text>
          {draft.photos.map((p, index) => <View key={p.uri} style={styles.pendingPhoto}>
            <Image source={{ uri: p.uri }} style={styles.thumbnail} alt={`Pending photo ${index + 1}`} accessibilityLabel={`Pending photo ${index + 1}`} />
            <Text style={styles.small}>Photo {index + 1} saved {new Date(p.capture.captureObservedAtUtc).toLocaleTimeString()} · {p.mediaId ? 'Uploaded, ready to link' : p.location?.location.state === 'captured' ? 'GPS ' + Math.round(p.location.location.accuracyMetres || 0) + ' m' : 'GPS needed'}</Text>
            {!p.mediaId && (p.location?.location.state !== 'captured' || p.location.location.accuracyMetres === null || p.location.location.accuracyMetres > 100 || p.location.location.mocked) ? <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => void refreshPhotoGps(index)}>Retry GPS</FieldButton> : null}
            <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => void removePhoto(p.uri)}>Remove pending photo</FieldButton>
          </View>)}</View>
          <Pressable onPress={() => setGuidanceOpen(!guidanceOpen)}><Text style={styles.link}>{guidanceOpen ? 'Hide guidance' : 'Standard and guidance'}</Text></Pressable>
          {guidanceOpen ? <><Text style={styles.body}>{check.help}</Text>{check.effectiveFrom ? <Text style={styles.small}>Applies from {check.effectiveFrom}. {check.trigger}</Text> : null}{check.sourceUrl ? <Pressable onPress={() => void Linking.openURL(check.sourceUrl || '')}><Text style={styles.link}>Official source</Text></Pressable> : null}<RentalTextField label="Optional report note" value={draft.publicNotes} editable={editable && !busy} onChange={(v) => change({ publicNotes: v })} multiline /></> : null}
          {check.repeatBy !== 'property' ? <FieldButton variant="quiet" disabled={!editable || Boolean(busy)} onPress={() => void perform('draft', async () => {
            await persist();
            const nextCursor = { sectionKey: section.key, checkIndex: cursor.checkIndex, instanceKey: Crypto.randomUUID() };
            const nextKey = itemKey(active, nextCursor);
            const nextCache = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts,
              [nextKey]: initialDraft(newRentalItem(active, section, check, nextCursor.instanceKey), data) } };
            setCache(nextCache); cacheRef.current = nextCache; await persist(nextCache);
            openCheck(section, cursor.checkIndex, nextCursor.instanceKey);
          })}>Add another {readable(check.repeatBy)}</FieldButton> : null}
          {check.repeatBy !== 'property' && !item.id && cache.drafts[key] ? <FieldButton variant="quiet" disabled={Boolean(busy)} onPress={() => Alert.alert('Discard unsaved item?', 'This removes this item from the draft. Saved job records are retained.', [{ text: 'Keep item', style: 'cancel' }, { text: 'Discard item', style: 'destructive', onPress: () => void perform('discard', async () => {
            const nextCache = { ...cacheRef.current, drafts: { ...cacheRef.current.drafts } }; delete nextCache.drafts[key];
            setCache(nextCache); cacheRef.current = nextCache; await persist(nextCache); setPage('categories');
          }) }])}>Discard unsaved item</FieldButton> : null}
        </> : page === 'details' && detailField ? <>
          <Text style={styles.small}>{check.responseType === 'outcome' ? 'Measurements and equipment' : `Test details · ${detailIndex + 1} of ${responseFields.length}`}</Text>
          {(check.responseType === 'outcome' ? responseFields : [detailField]).map((field) => <RentalTextField key={field.key} label={field.label} value={String(draft.response[field.key] || '')} editable={editable && !busy} onChange={(value) => change({ response: { ...draft.response, [field.key]: value } })} multiline maxLength={500} />)}
        </> : page === 'finding' ? <>
          <RentalTextField label="Observed problem" value={draft.findingDescription} editable={editable && !busy} onChange={(v) => change({ findingDescription: v })} multiline />
          <RentalTextField label="Recommended next step" value={draft.scopeSummary} editable={editable && !busy} onChange={(v) => change({ scopeSummary: v })} multiline />
          <FieldSelect label="Priority" value={draft.severity} disabled={!editable || Boolean(busy)} options={['required', 'urgent', 'immediate_safety_risk', 'recommended', 'information'].map((value) => ({ value, label: readable(value) }))} onChange={(v) => change({ severity: v })} />
          <Text style={styles.body}>Record what you can see and measure safely. Photograph labels and connections; leave design, sizing and concealed services for the qualified trade.</Text>
          <Text style={styles.small}>{rentalQuotationGuidance(check.key)}</Text>
          <RentalTextField label="Quantity for the work" value={draft.quantity || ''} editable={editable && !busy} onChange={(v) => change({ quantity: v })} />
          <RentalTextField label="Unit, for example m2, metres or each" value={draft.unitLabel || 'each'} editable={editable && !busy} onChange={(v) => change({ unitLabel: v })} />
          {RENTAL_QUOTATION_FIELDS.map((field) => <View key={field.key}><RentalTextField label={`${field.label} *`} value={draft.quotation?.[field.key] || ''} editable={editable && !busy} onChange={(v) => change({ quotation: { ...rentalQuotation(draft.quotation), [field.key]: v } })} multiline maxLength={field.maxLength || 4000} /><Text style={styles.small}>{field.help}</Text></View>)}
        </> : page === 'safety' ? <>
          <RentalTextField label="What was done to make it safe?" value={draft.immediateAction} editable={editable && !busy} onChange={(v) => change({ immediateAction: v })} multiline />
          <FieldButton variant={draft.notified ? 'primary' : 'secondary'} disabled={!editable || Boolean(busy)} onPress={() => change({ notified: !draft.notified })}>{draft.notified ? 'Notification confirmed' : 'Confirm responsible people were notified'}</FieldButton>
        </> : null}
      </> : null}
      </>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
    {page !== 'categories' ? <View style={[styles.footer, { paddingBottom: Math.max(12, insets.bottom) }]}><FieldButton variant="secondary" style={styles.flex} disabled={Boolean(busy)} onPress={previous}>Previous</FieldButton>
      {page === 'metadata' ? <FieldButton style={styles.flex} disabled={Boolean(busy)} loading={busy === 'metadata'} onPress={() => { if (editable) void saveMetadata(); else if (metadataIndex + 1 < metadata.length) setMetadataIndex(metadataIndex + 1); else setPage('review'); }}>Next</FieldButton> : page === 'review' ? <FieldButton style={styles.flex} variant="secondary" disabled={Boolean(busy)} onPress={() => setPage('categories')}>Categories</FieldButton> : <FieldButton style={styles.flex} disabled={Boolean(busy)} loading={busy === 'save'} onPress={() => void next()}>Next</FieldButton>}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colours.cream }, header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderColor: colours.line },
  job: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }, reference: { flex: 1, color: colours.muted, fontSize: 12 }, status: { color: colours.muted, fontSize: 11 },
  scroll: { flex: 1 }, content: { padding: spacing.md, gap: 14, paddingBottom: 24 }, flex: { flex: 1 }, title: { color: colours.ink, fontSize: 21, fontWeight: '700', lineHeight: 28 },
  body: { color: colours.muted, fontSize: 14, lineHeight: 20 }, small: { color: colours.muted, fontSize: 12, lineHeight: 18 }, label: { color: colours.ink, fontWeight: '600' },
  field: { gap: 8 }, input: { color: colours.ink, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, padding: 12, minHeight: 48 },
  notes: { minHeight: 110, textAlignVertical: 'top' }, category: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, padding: 14, backgroundColor: colours.surface },
  categoryTitle: { color: colours.ink, fontSize: 15, fontWeight: '600' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minWidth: '46%', flexGrow: 1, flexBasis: '46%', minHeight: 54, justifyContent: 'center', padding: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.surface },
  selected: { borderColor: colours.green, backgroundColor: colours.mintStrong }, link: { color: colours.green, fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  photo: { gap: 8, backgroundColor: colours.surface, padding: 12, borderRadius: radius.sm }, footer: { flexDirection: 'row', gap: 12, padding: 12, paddingBottom: 20, borderTopWidth: 1, borderColor: colours.line, backgroundColor: colours.forest },
  pendingPhoto: { gap: 4, borderTopWidth: 1, borderColor: colours.line, paddingTop: 10 }, thumbnail: { width: 120, height: 90, resizeMode: 'cover', borderRadius: radius.sm },
  error: { color: colours.red, fontSize: 14, lineHeight: 20 },
});
