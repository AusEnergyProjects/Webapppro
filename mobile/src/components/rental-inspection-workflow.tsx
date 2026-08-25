import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FieldButton } from '@/components/field-button';
import { apiRequest } from '@/lib/api';
import { captureSessionId, observeLocation, observedTime } from '@/lib/evidence';
import {
  RENTAL_ADVERSE_OUTCOMES,
  RENTAL_OUTCOMES,
  RENTAL_TRADES,
  newRentalItem,
  type RentalAssessmentCheck,
  type RentalAssessmentFinding,
  type RentalAssessmentEvidence,
  type RentalAssessmentItem,
  type RentalAssessmentModule,
  type RentalAssessmentResult,
  type RentalAssessmentSection,
  type RentalMetadataField,
} from '@/lib/rental-inspection';
import { colours, radius, spacing } from '@/lib/theme';
import type { FieldRentalInspectionSummary } from '@/lib/types';

const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_EVIDENCE_BYTES = 32 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function readable(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  if (!value) return 'Not recorded';
  const dateOnly = value.length === 10;
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('en-AU', dateOnly
      ? { dateStyle: 'medium', timeZone: 'UTC' }
      : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Melbourne' })
    : value;
}

function formatBytes(value: number) {
  return value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;
}

type WorkflowProps = {
  workOrderId: string;
  summary: FieldRentalInspectionSummary;
  online: boolean;
  onChanged: () => Promise<void>;
};

type UploadResponse = {
  ok?: boolean;
  media?: Array<{ id: string; fileName: string }>;
  error?: string;
};

type RentalItemDraft = { item: RentalAssessmentItem; body: Record<string, unknown> };
type RentalItemDraftProvider = () => RentalItemDraft;

function MetadataEditor({
  module,
  readOnly,
  busy,
  onSave,
}: {
  module: RentalAssessmentModule;
  readOnly: boolean;
  busy: boolean;
  onSave: (answers: Record<string, unknown>) => Promise<void>;
}) {
  const fields = module.template.metadataFields || [];
  const [answers, setAnswers] = useState<Record<string, unknown>>({ ...module.answers });
  if (!fields.length) return null;
  function setValue(field: RentalMetadataField, value: unknown) {
    setAnswers((current) => ({ ...current, [field.key]: value }));
  }
  return <View style={styles.detailsCard}>
    <Text style={styles.label}>ASSESSMENT DETAILS</Text>
    <Text style={styles.cardTitle}>Issuer details and declaration</Text>
    {fields.map((field) => <View style={styles.field} key={field.key}>
      <Text style={styles.inputLabel}>{field.label}{field.required ? ' *' : ''}</Text>
      {field.type === 'checkbox'
        ? <Pressable disabled={readOnly} accessibilityRole="checkbox" accessibilityState={{ checked: answers[field.key] === true }} onPress={() => setValue(field, answers[field.key] !== true)} style={[styles.choice, answers[field.key] === true && styles.choiceSelected]}>
          <MaterialCommunityIcons name={answers[field.key] === true ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={24} color={colours.green} />
          <Text style={styles.choiceText}>{answers[field.key] === true ? 'Confirmed' : 'Tap to confirm'}</Text>
        </Pressable>
        : field.type === 'select'
          ? <View style={styles.choiceList}>{field.options.map((option) => <Pressable disabled={readOnly} key={option.value} onPress={() => setValue(field, option.value)} style={[styles.option, answers[field.key] === option.value && styles.optionSelected]}><Text style={styles.optionText}>{option.label}</Text></Pressable>)}</View>
          : <TextInput editable={!readOnly} style={[styles.input, field.type === 'textarea' && styles.textarea]} multiline={field.type === 'textarea'} value={String(answers[field.key] || '')} onChangeText={(value) => setValue(field, value)} placeholder={field.placeholder || (field.type === 'date' ? 'YYYY-MM-DD' : 'Enter details')} maxLength={field.type === 'textarea' ? 4000 : 500} />}
      {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
    </View>)}
    {!readOnly ? <FieldButton loading={busy} onPress={() => void onSave(answers)}>Save assessment details</FieldButton> : null}
  </View>;
}

function ItemEditor({
  module,
  section,
  check,
  item,
  finding,
  evidence,
  readOnly,
  busy,
  onSave,
  onPhoto,
  onDirtyChange,
  onRegisterDraft,
}: {
  module: RentalAssessmentModule;
  section: RentalAssessmentSection;
  check: RentalAssessmentCheck;
  item: RentalAssessmentItem;
  finding?: RentalAssessmentFinding;
  evidence: RentalAssessmentEvidence[];
  readOnly: boolean;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onPhoto: (item: RentalAssessmentItem, check: RentalAssessmentCheck) => Promise<void>;
  onDirtyChange: (itemKey: string, dirty: boolean) => void;
  onRegisterDraft: (itemKey: string, provider: RentalItemDraftProvider | null) => void;
}) {
  const [outcome, setOutcome] = useState(item.outcome || '');
  const [locationLabel, setLocationLabel] = useState(item.locationLabel || '');
  const [publicNotes, setPublicNotes] = useState(item.publicNotes || '');
  const [internalNotes, setInternalNotes] = useState(item.internalNotes || '');
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [response, setResponse] = useState<Record<string, unknown>>({ ...item.response });
  const [findingTitle, setFindingTitle] = useState(finding?.title || '');
  const [findingDescription, setFindingDescription] = useState(finding?.description || '');
  const [severity, setSeverity] = useState(finding?.severity || 'required');
  const [tradeCategory, setTradeCategory] = useState(finding?.tradeCategory || '');
  const [scopeSummary, setScopeSummary] = useState(finding?.scopeSummary || '');
  const [recommendedAction, setRecommendedAction] = useState(finding?.recommendedAction || '');
  const [immediateAction, setImmediateAction] = useState(String(finding?.details.immediateAction || ''));
  const [notified, setNotified] = useState(finding?.details.responsiblePeopleNotified === true);
  const adverse = RENTAL_ADVERSE_OUTCOMES.has(outcome);
  const repeated = check.repeatBy !== 'property';
  const dirtyKey = item.id || `${module.id}:${section.key}:${check.key}:${item.instanceKey}`;
  const dirty = outcome !== (item.outcome || '')
    || locationLabel !== (item.locationLabel || '')
    || publicNotes !== (item.publicNotes || '')
    || internalNotes !== (item.internalNotes || '')
    || JSON.stringify(response) !== JSON.stringify(item.response || {})
    || findingTitle !== (finding?.title || '')
    || findingDescription !== (finding?.description || '')
    || severity !== (finding?.severity || 'required')
    || tradeCategory !== (finding?.tradeCategory || '')
    || scopeSummary !== (finding?.scopeSummary || '')
    || recommendedAction !== (finding?.recommendedAction || '')
    || immediateAction !== String(finding?.details.immediateAction || '')
    || notified !== (finding?.details.responsiblePeopleNotified === true);

  useEffect(() => {
    onDirtyChange(dirtyKey, dirty);
    return () => onDirtyChange(dirtyKey, false);
  }, [dirty, dirtyKey, onDirtyChange]);

  function draft(): RentalItemDraft {
    if (!outcome) throw new Error('Choose the assessment result before saving.');
    if (repeated && !locationLabel.trim()) throw new Error('Add the exact room, door, window or item location before saving.');
    if (outcome === 'not_applicable' && !publicNotes.trim()) throw new Error('Add the public reason this standard does not apply at this property.');
    if (adverse && (!findingTitle.trim() || !findingDescription.trim() || !tradeCategory || !scopeSummary.trim())) {
      throw new Error('Add a finding title, description, responsible trade and quote-ready scope.');
    }
    if (severity === 'immediate_safety_risk' && (!immediateAction.trim() || !notified)) {
      throw new Error('Record what was made safe and confirm the responsible people were notified.');
    }
    return { item, body: {
      action: 'save_item',
      moduleId: module.id,
      expectedModuleRevision: module.revision,
      expectedItemRevision: item.revision,
      sectionKey: section.key,
      checkKey: check.key,
      instanceKey: item.instanceKey,
      locationLabel: locationLabel.trim(),
      outcome,
      response,
      publicNotes: publicNotes.trim(),
      internalNotes: internalNotes.trim(),
      sortOrder: item.sortOrder,
      finding: adverse ? {
        title: findingTitle.trim(),
        description: findingDescription.trim(),
        status: outcome === 'does_not_meet' ? 'non_compliant' : 'not_tested',
        severity,
        tradeCategory,
        recommendedAction: recommendedAction.trim(),
        scopeSummary: scopeSummary.trim(),
        quantityMilli: finding?.quantityMilli || 1000,
        unitLabel: finding?.unitLabel || 'each',
        internalNotes: finding?.internalNotes || '',
        details: {
          immediateAction: immediateAction.trim(),
          responsiblePeopleNotified: notified,
        },
      } : undefined,
    } };
  }

  useEffect(() => {
    const provider = () => draft();
    onRegisterDraft(dirtyKey, provider);
    return () => onRegisterDraft(dirtyKey, null);
  });

  async function save() {
    try {
      await onSave(draft().body);
    } catch (saveError) {
      Alert.alert('Finish this answer', saveError instanceof Error ? saveError.message : 'The answer is not ready to save.');
    }
  }

  function technicalField(key: string, label: string, placeholder = '') {
    return <View style={styles.field} key={key}><Text style={styles.inputLabel}>{label}</Text><TextInput editable={!readOnly} style={styles.input} value={String(response[key] || '')} onChangeText={(value) => setResponse((current) => ({ ...current, [key]: value }))} placeholder={placeholder} maxLength={500} /></View>;
  }

  return <View style={[styles.itemCard, outcome ? styles.itemAnswered : null]}>
    <View style={styles.itemHeading}>
      <View style={styles.flex}><Text style={styles.itemSequence}>{repeated ? 'REPEATABLE CHECK' : 'PROPERTY CHECK'}</Text><Text style={styles.itemTitle}>{check.prompt}</Text></View>
      <Text style={styles.saved}>{item.id ? `Saved v${item.revision}` : 'Not saved'}</Text>
    </View>
    {repeated ? <View style={styles.field}><Text style={styles.inputLabel}>Exact location *</Text><TextInput editable={!readOnly} style={styles.input} value={locationLabel} onChangeText={setLocationLabel} placeholder="For example, Bedroom 2 north window" maxLength={300} /></View> : null}
    <Text style={styles.inputLabel}>Result *</Text>
    <View style={styles.choiceList}>{RENTAL_OUTCOMES.map((option) => <Pressable disabled={readOnly} key={option.value} onPress={() => setOutcome(option.value)} style={[styles.option, outcome === option.value && styles.optionSelected]}><MaterialCommunityIcons name={outcome === option.value ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={colours.green} /><Text style={styles.optionText}>{option.label}</Text></Pressable>)}</View>
    <View style={styles.guidance}>
      <MaterialCommunityIcons name="camera-outline" size={23} color={colours.green} />
      <View style={styles.flex}><Text style={styles.guidanceTitle}>What to photograph</Text><Text style={styles.body}>{check.photoGuidance}</Text>{check.help ? <Text style={styles.help}>{check.help}</Text> : null}</View>
    </View>
    <View style={styles.field}><Text style={styles.inputLabel}>Report detail{outcome === 'not_applicable' ? ' *' : ''}</Text><TextInput editable={!readOnly} style={[styles.input, styles.textarea]} multiline value={publicNotes} onChangeText={setPublicNotes} placeholder={outcome === 'not_applicable' ? 'Explain why this standard does not apply at this property.' : 'Describe what was observed, tested or measured. This appears in the final report.'} maxLength={4000} /><Text style={styles.help}>Visible to the agent, rental provider and trades using the issued report.</Text></View>

    <Pressable onPress={() => setTechnicalOpen((value) => !value)} style={styles.disclosure}><Text style={styles.disclosureText}>Measurements, equipment and credentials</Text><MaterialCommunityIcons name={technicalOpen ? 'chevron-up' : 'chevron-down'} size={22} color={colours.green} /></Pressable>
    {technicalOpen ? <View style={styles.technicalFields}>
      {technicalField('make', 'Make')}
      {technicalField('model', 'Model')}
      {technicalField('serialNumber', 'Serial number')}
      {technicalField('measurement', 'Measurement')}
      {technicalField('measurementUnit', 'Measurement unit', 'mm, ohm, seconds')}
      {technicalField('testMethod', 'Test method')}
      {technicalField('testInstrument', 'Test instrument')}
      {technicalField('testResult', 'Test result')}
      {technicalField('credentialType', 'Specialist credential type')}
      {technicalField('credentialNumber', 'Specialist credential number')}
      <Pressable disabled={readOnly} onPress={() => setResponse((current) => ({ ...current, credentialVerified: current.credentialVerified !== true }))} style={[styles.choice, response.credentialVerified === true && styles.choiceSelected]}><MaterialCommunityIcons name={response.credentialVerified === true ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={24} color={colours.green} /><Text style={styles.choiceText}>Specialist credential checked</Text></Pressable>
    </View> : null}

    {adverse ? <View style={styles.findingCard}>
      <Text style={styles.label}>FINDING AND WORK SCOPE</Text>
      <Text style={styles.findingNotice}>Required before this module can be completed</Text>
      <View style={styles.field}><Text style={styles.inputLabel}>Finding title *</Text><TextInput editable={!readOnly} style={styles.input} value={findingTitle} onChangeText={setFindingTitle} placeholder="Short description a trade can scan" maxLength={240} /></View>
      <View style={styles.field}><Text style={styles.inputLabel}>What is wrong or still unverified *</Text><TextInput editable={!readOnly} style={[styles.input, styles.textarea]} multiline value={findingDescription} onChangeText={setFindingDescription} maxLength={8000} /></View>
      <Text style={styles.inputLabel}>Severity *</Text>
      <View style={styles.compactChoices}>{['required', 'urgent', 'immediate_safety_risk', 'recommended', 'information'].map((value) => <Pressable disabled={readOnly} key={value} onPress={() => setSeverity(value)} style={[styles.compactOption, severity === value && styles.optionSelected]}><Text style={styles.optionText}>{readable(value)}</Text></Pressable>)}</View>
      <Text style={styles.inputLabel}>Responsible trade *</Text>
      <View style={styles.compactChoices}>{RENTAL_TRADES.map((trade) => <Pressable disabled={readOnly} key={trade} onPress={() => setTradeCategory(trade)} style={[styles.compactOption, tradeCategory === trade && styles.optionSelected]}><Text style={styles.optionText}>{trade}</Text></Pressable>)}</View>
      <View style={styles.field}><Text style={styles.inputLabel}>Recommended action</Text><TextInput editable={!readOnly} style={[styles.input, styles.textareaSmall]} multiline value={recommendedAction} onChangeText={setRecommendedAction} maxLength={4000} /></View>
      <View style={styles.field}><Text style={styles.inputLabel}>Quote-ready scope *</Text><TextInput editable={!readOnly} style={[styles.input, styles.textarea]} multiline value={scopeSummary} onChangeText={setScopeSummary} placeholder="Describe the work, location, quantity and expected result so the responsible trade can quote it." maxLength={8000} /></View>
      {severity === 'immediate_safety_risk' ? <View style={styles.safetyStop}>
        <Text style={styles.safetyTitle}>Stop and make the situation safe</Text>
        <Text style={styles.body}>Do not leave this as a quote item only. Record the immediate action and who was told.</Text>
        <TextInput editable={!readOnly} style={[styles.input, styles.textarea]} multiline value={immediateAction} onChangeText={setImmediateAction} placeholder="Make-safe or isolation action" maxLength={2000} />
        <Pressable disabled={readOnly} onPress={() => setNotified((value) => !value)} style={[styles.choice, notified && styles.choiceSelected]}><MaterialCommunityIcons name={notified ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={24} color={colours.red} /><Text style={styles.choiceText}>Responsible people were notified</Text></Pressable>
      </View> : null}
    </View> : null}

    <View style={[styles.field, styles.internalField]}><Text style={styles.inputLabel}>Internal assessment note</Text><TextInput editable={!readOnly} style={[styles.input, styles.textareaSmall]} multiline value={internalNotes} onChangeText={setInternalNotes} placeholder="Private coordination, costing or follow-up notes" maxLength={4000} /><Text style={styles.help}>Private to your business. Never included in the public report or PDF.</Text></View>
    {!readOnly ? <FieldButton loading={busy} disabled={!outcome} onPress={() => void save()}>{item.id ? 'Save changes' : 'Save this answer'}</FieldButton> : null}
    <View style={styles.evidenceRow}>
      <View style={styles.flex}><Text style={styles.inputLabel}>Evidence</Text><Text style={styles.help}>{evidence.length} of {item.requiredEvidenceCount || check.requiredEvidenceCount} required files linked</Text></View>
      {!readOnly && item.id ? <FieldButton variant="secondary" loading={busy} onPress={() => void onPhoto(item, check)}>Take photo</FieldButton> : null}
    </View>
    {evidence.map((entry) => <View style={styles.evidenceMeta} key={entry.id}>
      <Text style={styles.evidenceName}>{entry.fileName}</Text>
      <Text style={styles.help}>{entry.capture ? `${entry.capture.source === 'in_app_camera' ? 'Captured' : 'Added'} ${formatDate(entry.capture.capturedAtUtc)}` : 'Capture metadata unavailable'}</Text>
      {entry.capture?.locationCaptured && entry.capture.latitude !== null && entry.capture.longitude !== null && entry.capture.accuracyMetres !== null
        ? <Text style={styles.help}>Device-reported GPS {entry.capture.latitude.toFixed(6)}, {entry.capture.longitude.toFixed(6)} | accuracy {Math.round(entry.capture.accuracyMetres)} m</Text>
        : null}
    </View>)}
    {!item.id ? <Text style={styles.help}>Save the answer first, then add its photo.</Text> : null}
    {item.id && !readOnly ? <Text style={styles.help}>Each photo records a fresh device-reported GPS position, capture time and accuracy for the issued report.</Text> : null}
  </View>;
}

export function RentalInspectionWorkflow({ workOrderId, summary, online, onChanged }: WorkflowProps) {
  const [data, setData] = useState<RentalAssessmentResult>({ modules: [], items: [], evidence: [], findings: [], completion: {} });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [activeModuleId, setActiveModuleId] = useState('');
  const [activeSectionKey, setActiveSectionKey] = useState('');
  const [localItems, setLocalItems] = useState<Record<string, RentalAssessmentItem[]>>({});
  const [dirtyItems, setDirtyItems] = useState<Set<string>>(() => new Set());
  const itemDraftProviders = useRef(new Map<string, RentalItemDraftProvider>());

  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest<RentalAssessmentResult>(`/api/trade-rental-inspections?workOrderId=${encodeURIComponent(workOrderId)}`);
      if (!result.ok) throw new Error(result.error || 'The rental assessment could not be loaded.');
      setData(result);
      setActiveModuleId((current) => current && result.modules?.some((module) => module.id === current) ? current : result.modules?.[0]?.id || '');
      return result;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The rental assessment could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [online, workOrderId]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const activeModule = data.modules?.find((candidate) => candidate.id === activeModuleId) || data.modules?.[0];
  const sections = useMemo(() => activeModule?.template.sections || [], [activeModule]);
  const section = sections.find((candidate) => candidate.key === activeSectionKey);
  const latestReport = data.reports?.find((report) => report.status === 'issued');
  const canEdit = online && data.permissions?.canEdit === true && activeModule?.status !== 'complete';

  async function mutate(body: Record<string, unknown>, key: string, success: string) {
    if (!online) return Alert.alert('Reconnect to save', 'Assessment answers and final issue are verified online. Your existing synced job details remain available offline.');
    setBusy(key);
    try {
      const result = await apiRequest<RentalAssessmentResult>('/api/trade-rental-inspections', {
        method: 'POST',
        body: JSON.stringify({ workOrderId, ...body }),
      });
      if (!result.ok) throw new Error(result.error || 'The assessment could not be saved.');
      setData(result);
      setError('');
      await onChanged();
      Alert.alert('Saved', success);
      return result;
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : 'The assessment could not be saved.';
      setError(message);
      Alert.alert('Action required', message);
      return undefined;
    } finally {
      setBusy('');
    }
  }

  async function saveItem(item: RentalAssessmentItem, body: Record<string, unknown>) {
    const result = await mutate(body, `item:${item.instanceKey}`, 'Assessment answer saved.');
    if (result && !item.id) {
      const key = `${item.moduleId}:${item.sectionKey}:${item.checkKey}`;
      setLocalItems((current) => ({ ...current, [key]: (current[key] || []).filter((candidate) => candidate.instanceKey !== item.instanceKey) }));
    }
  }

  const markItemDirty = useCallback((itemKey: string, dirty: boolean) => {
    setDirtyItems((current) => {
      const next = new Set(current);
      if (dirty) next.add(itemKey);
      else next.delete(itemKey);
      return next;
    });
  }, []);

  const registerItemDraft = useCallback((itemKey: string, provider: RentalItemDraftProvider | null) => {
    if (provider) itemDraftProviders.current.set(itemKey, provider);
    else itemDraftProviders.current.delete(itemKey);
  }, []);

  function showSectionOverview() {
    const leave = () => {
      setDirtyItems(new Set());
      setActiveSectionKey('');
    };
    if (!dirtyItems.size) return leave();
    Alert.alert(
      'Leave this section?',
      'Changes still open on this screen have not been saved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Leave without saving', style: 'destructive', onPress: leave },
      ],
    );
  }

  async function saveSectionAndContinue() {
    if (!section) return;
    setBusy('section-continue');
    let savedCount = 0;
    try {
      let current = data;
      const drafts = [...dirtyItems].map((itemKey) => {
        const provider = itemDraftProviders.current.get(itemKey);
        if (!provider) throw new Error('One changed answer could not be prepared. Reopen the section and try again.');
        return { dirtyKey: itemKey, ...provider() };
      });
      for (const draft of drafts) {
        const currentModule = current.modules?.find((candidate) => candidate.id === draft.item.moduleId);
        if (!currentModule) throw new Error('The assessment module changed. Reload the job and try again.');
        const currentItem = current.items?.find((candidate) => draft.item.id
          ? candidate.id === draft.item.id
          : candidate.moduleId === draft.item.moduleId
            && candidate.sectionKey === draft.item.sectionKey
            && candidate.checkKey === draft.item.checkKey
            && candidate.instanceKey === draft.item.instanceKey);
        const result = await apiRequest<RentalAssessmentResult>('/api/trade-rental-inspections', {
          method: 'POST',
          body: JSON.stringify({
            workOrderId,
            ...draft.body,
            expectedModuleRevision: currentModule.revision,
            expectedItemRevision: currentItem?.revision || 0,
          }),
        });
        if (!result.ok) throw new Error(result.error || 'The section could not be saved.');
        current = result;
        savedCount += 1;
        setData(result);
        setDirtyItems((existing) => {
          const next = new Set(existing);
          next.delete(draft.dirtyKey);
          return next;
        });
        itemDraftProviders.current.delete(draft.dirtyKey);
        if (!draft.item.id) {
          setLocalItems((existing) => Object.fromEntries(Object.entries(existing)
            .map(([key, entries]) => [key, entries.filter((entry) => entry.instanceKey !== draft.item.instanceKey)])));
        }
      }
      if (!drafts.length) {
        const refreshed = await load();
        if (!refreshed) return;
        current = refreshed;
      } else {
        await onChanged();
      }
      const currentIndex = sections.findIndex((candidate) => candidate.key === section.key);
      const nextSection = sections[currentIndex + 1];
      setActiveSectionKey(nextSection?.key || '');
      Alert.alert('Progress saved', nextSection ? `Opening ${nextSection.title}.` : 'All sections are available from the main assessment screen.');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'The section could not be saved.';
      if (savedCount > 0) await onChanged().catch(() => undefined);
      const recoveryMessage = savedCount > 0
        ? `${savedCount} answer${savedCount === 1 ? ' was' : 's were'} saved before this stopped. ${message}`
        : message;
      setError(recoveryMessage);
      Alert.alert('Finish this section', recoveryMessage);
    } finally {
      setBusy('');
    }
  }

  async function takePhoto(item: RentalAssessmentItem, check: RentalAssessmentCheck) {
    if (!activeModule || !online) return Alert.alert('Reconnect to add evidence', 'This photo must be uploaded and linked to the exact assessment answer before it can count.');
    setBusy(`photo:${item.id}`);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Allow camera access in device settings to add an assessment photo.');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.45,
        exif: false,
        cameraType: ImagePicker.CameraType.back,
      });
      if (result.canceled || !result.assets[0]) return;
      const photoObservedTime = observedTime();
      const locationObservation = await observeLocation(true);
      if (locationObservation.location.state !== 'captured') {
        throw new Error('A current GPS location is required for rental-assessment photos. Enable precise location and try again.');
      }
      if (locationObservation.location.mocked === true) {
        throw new Error('Mocked device locations cannot be used for rental-assessment evidence. Turn off location simulation and try again.');
      }
      if (locationObservation.location.accuracyMetres === null
        || !Number.isFinite(locationObservation.location.accuracyMetres)
        || locationObservation.location.accuracyMetres < 0
        || locationObservation.location.accuracyMetres > 100) {
        throw new Error('The GPS position is not accurate enough. Move to a clearer location and try again (100 m maximum).');
      }
      const asset = result.assets[0];
      const contentType = asset.mimeType || 'image/jpeg';
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error('Use a JPEG, PNG or WebP photo.');
      const imageContext = ImageManipulator.manipulate(asset.uri);
      if (asset.width > 1600) imageContext.resize({ width: 1600, height: null });
      const renderedImage = await imageContext.renderAsync();
      const prepared = await renderedImage.saveAsync({ compress: 0.62, format: SaveFormat.JPEG });
      const preparedFile = new File(prepared.uri);
      if (!preparedFile.exists || preparedFile.size < 1) throw new Error('The privacy-safe photo copy could not be prepared.');
      if (preparedFile.size > MAX_EVIDENCE_BYTES) throw new Error('The prepared photo is larger than the 8 MB per-file limit. Retake it at a lower camera resolution.');
      const usedBytes = data.evidenceBudget?.usedBytes || 0;
      const packageLimit = data.evidenceBudget?.maxBytes || MAX_REPORT_EVIDENCE_BYTES;
      if (usedBytes + preparedFile.size > packageLimit) {
        throw new Error('This assessment has reached its 32 MB issued-report evidence limit. Remove another file or retake this photo at a lower resolution.');
      }
      const form = new FormData();
      form.append('workOrderId', workOrderId);
      form.append('category', 'progress');
      form.append('caption', check.prompt.slice(0, 300));
      form.append('evidenceEnvelope', JSON.stringify({
        schemaVersion: 1,
        kind: 'tlink-rental-inspection-photo',
        captureSessionId: captureSessionId(),
        source: 'in_app_camera',
        capture: photoObservedTime,
        locationPermission: locationObservation.permission,
        location: locationObservation.location,
        processing: {
          privacySafeDerivative: true,
          exifCopied: false,
          outputFormat: 'image/jpeg',
          widthPixels: prepared.width,
          heightPixels: prepared.height,
          maximumWidthPixels: 1600,
        },
      }));
      form.append('file', { uri: prepared.uri, name: `rental-photo-${Date.now()}.jpg`, type: 'image/jpeg' } as unknown as Blob);
      const upload = await apiRequest<UploadResponse>('/api/trade-field-work', { method: 'POST', body: form });
      const jobMediaId = upload.media?.[0]?.id;
      if (!jobMediaId) throw new Error(upload.error || 'The assessment photo could not be uploaded.');
      let linked: RentalAssessmentResult;
      try {
        linked = await apiRequest<RentalAssessmentResult>('/api/trade-rental-inspections', {
          method: 'POST',
          body: JSON.stringify({ workOrderId, action: 'link_evidence', itemId: item.id,
            jobMediaId, purpose: check.prompt, expectedModuleRevision: activeModule.revision }),
        });
      } catch (linkError) {
        await apiRequest(`/api/trade-field-work?id=${encodeURIComponent(jobMediaId)}`, { method: 'DELETE' }).catch(() => undefined);
        throw linkError;
      }
      setData(linked);
      await onChanged();
      Alert.alert('Photo linked', `A privacy-safe copy is attached with its device-reported time and GPS location (${Math.round(locationObservation.location.accuracyMetres || 0)} m accuracy).`);
    } catch (photoError) {
      Alert.alert('Photo not linked', photoError instanceof Error ? photoError.message : 'The assessment photo could not be saved.');
    } finally {
      setBusy('');
    }
  }

  async function issueReport() {
    const result = await mutate({ action: 'issue_report' }, 'issue', 'The immutable report and 60-day link are ready.');
    const shareUrl = result?.issuedReport?.shareUrl;
    if (shareUrl) await Share.share({ title: result.issuedReport?.reportNumber || 'Rental assessment', message: shareUrl, url: shareUrl });
  }

  function stopSharing() {
    if (!latestReport?.link?.id) return;
    Alert.alert('Stop public access?', 'Anyone using this link will immediately lose access. The issued report stays in TLink.', [
      { text: 'Keep sharing', style: 'cancel' },
      { text: 'Stop sharing', style: 'destructive', onPress: () => { void mutate({ action: 'revoke_report_link', linkId: latestReport.link?.id }, 'revoke', 'Public report access was stopped.'); } },
    ]);
  }

  if (!online) return <View style={styles.offlineCard}><MaterialCommunityIcons name="cloud-off-outline" size={28} color={colours.green} /><View style={styles.flex}><Text style={styles.cardTitle}>Rental assessment</Text><Text style={styles.body}>{summary.progress.completeModules} of {summary.progress.moduleTotal} modules complete. Reconnect to open the full frozen form and save verified answers.</Text></View></View>;
  if (loading && !activeModule) return <View style={styles.offlineCard}><MaterialCommunityIcons name="progress-clock" size={28} color={colours.green} /><Text style={styles.body}>Opening the frozen rental assessment...</Text></View>;
  if (!activeModule) return <View style={styles.offlineCard}><MaterialCommunityIcons name="alert-circle-outline" size={28} color={colours.red} /><View style={styles.flex}><Text style={styles.cardTitle}>Rental assessment unavailable</Text><Text style={styles.body}>{error || 'Pull down to sync this job and try again.'}</Text><FieldButton variant="secondary" onPress={() => void load()}>Try again</FieldButton></View></View>;

  const allModulesComplete = data.modules?.every((candidate) => candidate.status === 'complete') === true;
  const moduleCompletion = data.completion?.[activeModule.id];
  return <View style={styles.workflow}>
    <View style={styles.hero}>
      <View style={styles.flex}><Text style={styles.label}>VICTORIAN RENTAL ASSESSMENT</Text><Text style={styles.heroTitle}>{data.inspection?.inspectionNumber || summary.inspectionNumber}</Text><Text style={styles.body}>Rules effective {formatDate(data.inspection?.rulesEffectiveFrom || summary.rulesEffectiveFrom)} | Frozen form version {summary.templateVersion}</Text></View>
      <View style={styles.statusPill}><Text style={styles.statusText}>{readable(data.inspection?.status || summary.status)}</Text></View>
    </View>

    {!section ? <>
      <View style={styles.moduleList}>{data.modules?.map((candidate) => <Pressable key={candidate.id} onPress={() => { setActiveModuleId(candidate.id); setActiveSectionKey(''); setDirtyItems(new Set()); }} style={[styles.moduleButton, candidate.id === activeModule.id && styles.moduleButtonActive]}><Text style={styles.moduleTag}>{candidate.required ? 'INCLUDED' : 'OPTIONAL'}</Text><Text style={styles.moduleTitle}>{candidate.title}</Text><Text style={styles.help}>{candidate.status === 'complete' ? 'Complete and locked' : `${data.completion?.[candidate.id]?.blockers.length || 0} items to finish`}</Text></Pressable>)}</View>

      <View style={styles.boundary}><Text style={styles.cardTitle}>{activeModule.template.title}</Text><Text style={styles.body}>{activeModule.template.reportBoundary}</Text><Text style={styles.help}>Required issuer capability: {readable(activeModule.requiredCapability)}</Text></View>
      <MetadataEditor key={`${activeModule.id}:${activeModule.revision}`} module={activeModule} readOnly={!canEdit} busy={busy === `metadata:${activeModule.id}`} onSave={(answers) => mutate({ action: 'save_module_answers', moduleId: activeModule.id, expectedRevision: activeModule.revision, answers }, `metadata:${activeModule.id}`, 'Assessment details saved.').then(() => undefined)} />

      <View style={styles.sectionOverview}>
        <Text style={styles.label}>ASSESSMENT WORKFLOW</Text>
        <Text style={styles.cardTitle}>Choose a section</Text>
        <Text style={styles.body}>Each section opens on its own screen. Back always returns here, and saved answers stay attached to this job.</Text>
        <View style={styles.sectionList}>{sections.map((candidate, index) => {
          const assessed = candidate.checks.filter((check) => data.items?.some((item) => item.moduleId === activeModule.id && item.sectionKey === candidate.key && item.checkKey === check.key && item.outcome)).length;
          const complete = assessed === candidate.checks.length;
          return <Pressable key={candidate.key} onPress={() => { setDirtyItems(new Set()); setActiveSectionKey(candidate.key); }} style={styles.sectionButton}>
            <Text style={styles.sectionNumber}>{index + 1}</Text>
            <View style={styles.flex}><Text style={styles.sectionTitle}>{candidate.title}</Text><Text style={styles.help}>{assessed} of {candidate.checks.length} checks saved</Text></View>
            <MaterialCommunityIcons name={complete ? 'check-circle' : 'chevron-right'} size={25} color={colours.green} />
          </Pressable>;
        })}</View>
      </View>

      <View style={styles.completionCard}>
        <View style={styles.hero}><View style={styles.flex}><Text style={styles.label}>SERVER-CHECKED COMPLETION</Text><Text style={styles.cardTitle}>{activeModule.title}</Text></View><Text style={styles.progress}>{activeModule.status === 'complete' ? 'Complete' : moduleCompletion?.complete ? 'Ready' : 'Not ready'}</Text></View>
        {moduleCompletion?.blockers.length ? <View>{moduleCompletion.blockers.slice(0, 8).map((blocker) => <Text style={styles.blocker} key={blocker.key}>• {blocker.label}</Text>)}</View> : <Text style={styles.body}>All required answers, evidence, findings, work scopes and declarations pass the current rules.</Text>}
        {data.permissions?.canEdit ? <FieldButton variant={activeModule.status === 'complete' ? 'secondary' : 'primary'} loading={busy === `module:${activeModule.id}`} disabled={activeModule.status !== 'complete' && !moduleCompletion?.complete} onPress={() => void mutate({ action: activeModule.status === 'complete' ? 'reopen_module' : 'complete_module', moduleId: activeModule.id, expectedRevision: activeModule.revision }, `module:${activeModule.id}`, activeModule.status === 'complete' ? 'Module reopened for correction.' : 'Module completed and locked.')}>{activeModule.status === 'complete' ? 'Reopen module' : 'Complete and lock module'}</FieldButton> : null}
      </View>

      <View style={styles.issueCard}>
        <Text style={styles.label}>FINAL ASSESSOR ISSUE</Text><Text style={styles.cardTitle}>{latestReport?.reportNumber || 'Issue the complete rental report'}</Text>
        {latestReport?.link?.status === 'active' && latestReport.link.shareUrl ? <>
          <Text style={styles.body}>No account is required. Anyone with the link can view the full issued report until {formatDate(latestReport.link.expiresAt)}.</Text>
          <FieldButton onPress={() => void Share.share({ title: latestReport.reportNumber, message: latestReport.link?.shareUrl || '', url: latestReport.link?.shareUrl || '' })}>Share secure report link</FieldButton>
          <FieldButton variant="secondary" onPress={() => void Linking.openURL(latestReport.link?.shareUrl || '')}>Open report</FieldButton>
          {data.permissions?.canRevokeLink ? <FieldButton variant="secondary" loading={busy === 'revoke'} onPress={stopSharing}>Stop sharing</FieldButton> : null}
        </> : <>
          <Text style={styles.body}>{latestReport
            ? latestReport.link?.status === 'active'
              ? 'The issued report is available, but only the owner or assigned assessor can reveal its secure sharing link.'
              : `The issued report is retained, but its public link is ${latestReport.link?.status || 'not active'}.`
            : allModulesComplete
              ? 'The assigned assessor can now create the immutable PDF and no-account 60-day link.'
              : 'Complete and lock every selected module before issuing.'}</Text>
          {!latestReport && data.permissions?.canIssue ? <FieldButton loading={busy === 'issue'} disabled={!allModulesComplete} onPress={() => void issueReport()}>Issue report and create 60-day link</FieldButton> : null}
        </>}
        <Text style={styles.body}>Evidence package: {formatBytes(data.evidenceBudget?.usedBytes || 0)} of {formatBytes(data.evidenceBudget?.maxBytes || MAX_REPORT_EVIDENCE_BYTES)}.</Text>
      </View>
    </> : <>
      <Pressable accessibilityRole="button" onPress={showSectionOverview} style={styles.backButton}><MaterialCommunityIcons name="arrow-left" size={20} color={colours.green} /><Text style={styles.backButtonText}>Back to all sections</Text></Pressable>
      <View style={styles.sectionHeaderCard}>
        <Text style={styles.label}>SECTION {sections.findIndex((candidate) => candidate.key === section.key) + 1} OF {sections.length}</Text>
        <Text style={styles.heroTitle}>{section.title}</Text>
        <Text style={styles.body}>{section.summary}</Text>
      </View>
      <View style={styles.sectionContent}>
        {section.checks.map((check, checkIndex) => {
          const key = `${activeModule.id}:${section.key}:${check.key}`;
          const stored = data.items?.filter((item) => item.moduleId === activeModule.id && item.sectionKey === section.key && item.checkKey === check.key) || [];
          const working = [...(stored.length ? stored : [newRentalItem(activeModule, section, check)]), ...(localItems[key] || [])];
          return <View key={check.key} style={styles.checkGroup}>{working.map((item, itemIndex) => <ItemEditor key={`${item.id || item.instanceKey}:${item.revision}`} module={activeModule} section={section} check={check} item={{ ...item, sortOrder: (sections.findIndex((candidate) => candidate.key === section.key) + 1) * 100 + checkIndex * 10 + itemIndex }} finding={data.findings?.find((candidate) => candidate.itemId === item.id)} evidence={(data.evidence || []).filter((entry) => entry.itemId === item.id && entry.status === 'active')} readOnly={!canEdit} busy={busy === `item:${item.instanceKey}` || busy === `photo:${item.id}`} onSave={(body) => saveItem(item, body)} onPhoto={takePhoto} onDirtyChange={markItemDirty} onRegisterDraft={registerItemDraft} />)}
            {check.repeatBy !== 'property' && canEdit ? <FieldButton variant="secondary" onPress={() => setLocalItems((current) => ({ ...current, [key]: [...(current[key] || []), newRentalItem(activeModule, section, check, Crypto.randomUUID())] }))}>Add another {readable(check.repeatBy).toLowerCase()}</FieldButton> : null}
          </View>;
        })}
      </View>
      <View style={styles.sectionActions}>
        <FieldButton variant="secondary" onPress={showSectionOverview}>Back to all sections</FieldButton>
        <FieldButton loading={busy === 'section-continue'} onPress={() => void saveSectionAndContinue()}>{sections.findIndex((candidate) => candidate.key === section.key) < sections.length - 1 ? 'Save section and continue' : 'Save section and return'}</FieldButton>
        <Text style={styles.help}>This saves every changed answer on the screen before moving forward. The smaller Save button remains available when you want to save one answer immediately.</Text>
      </View>
    </>}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  workflow: { gap: spacing.md },
  flex: { flex: 1 },
  hero: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  heroTitle: { color: colours.ink, fontSize: 22, fontWeight: '800', lineHeight: 28 },
  label: { color: colours.green, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  body: { color: colours.muted, lineHeight: 21 },
  help: { color: colours.muted, fontSize: 12, lineHeight: 17 },
  cardTitle: { color: colours.ink, fontSize: 18, fontWeight: '800', lineHeight: 24 },
  statusPill: { backgroundColor: colours.mint, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  statusText: { color: colours.ink, fontSize: 11, fontWeight: '800' },
  moduleList: { gap: spacing.sm },
  moduleButton: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.md, borderWidth: 1, gap: 3, padding: spacing.md },
  moduleButtonActive: { backgroundColor: colours.mint, borderColor: colours.green },
  moduleTag: { color: colours.green, fontSize: 10, fontWeight: '900', letterSpacing: .7 },
  moduleTitle: { color: colours.ink, fontSize: 16, fontWeight: '800' },
  boundary: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  detailsCard: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  field: { gap: 6 },
  inputLabel: { color: colours.ink, fontWeight: '700' },
  input: { backgroundColor: '#fbfdfc', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, color: colours.ink, fontSize: 16, minHeight: 50, paddingHorizontal: spacing.md },
  textarea: { minHeight: 100, paddingTop: spacing.md, textAlignVertical: 'top' },
  textareaSmall: { minHeight: 76, paddingTop: spacing.md, textAlignVertical: 'top' },
  choice: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
  choiceSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  choiceText: { color: colours.ink, flex: 1, fontWeight: '700' },
  choiceList: { gap: 7 },
  option: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 47, paddingHorizontal: spacing.md },
  optionSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  optionText: { color: colours.ink, fontSize: 13, fontWeight: '700' },
  sectionOverview: { backgroundColor: '#f7fbfa', borderColor: colours.line, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  sectionList: { gap: 7 },
  sectionButton: { alignItems: 'center', backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 68, padding: spacing.sm },
  sectionButtonActive: { backgroundColor: colours.mint, borderColor: colours.green },
  sectionNumber: { backgroundColor: colours.mint, borderRadius: 999, color: colours.green, fontSize: 12, fontWeight: '900', minWidth: 34, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center' },
  sectionTitle: { color: colours.ink, fontSize: 15, fontWeight: '800' },
  backButton: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 7, minHeight: 44, paddingVertical: 5 },
  backButtonText: { color: colours.green, fontSize: 15, fontWeight: '800' },
  sectionHeaderCard: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  sectionContent: { gap: spacing.md },
  sectionActions: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  checkGroup: { gap: spacing.sm },
  itemCard: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  itemAnswered: { borderColor: colours.mintStrong },
  itemHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  itemSequence: { color: colours.green, fontSize: 10, fontWeight: '900', letterSpacing: .7 },
  itemTitle: { color: colours.ink, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  saved: { color: colours.muted, fontSize: 11, fontWeight: '700' },
  guidance: { backgroundColor: colours.mint, borderRadius: radius.sm, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  guidanceTitle: { color: colours.ink, fontWeight: '800' },
  disclosure: { alignItems: 'center', borderBottomColor: colours.line, borderBottomWidth: 1, borderTopColor: colours.line, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50 },
  disclosureText: { color: colours.ink, flex: 1, fontWeight: '800' },
  technicalFields: { gap: spacing.sm },
  findingCard: { backgroundColor: '#fff8e7', borderColor: colours.amber, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  findingNotice: { color: colours.ink, fontSize: 12, fontWeight: '800' },
  compactChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  compactOption: { borderColor: colours.line, borderRadius: 999, borderWidth: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  safetyStop: { backgroundColor: '#fff0ed', borderColor: colours.red, borderRadius: radius.sm, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  safetyTitle: { color: colours.red, fontSize: 17, fontWeight: '900' },
  internalField: { backgroundColor: '#f4f5f5', borderRadius: radius.sm, padding: spacing.sm },
  evidenceRow: { alignItems: 'center', borderTopColor: colours.line, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  evidenceMeta: { backgroundColor: colours.cream, borderRadius: radius.sm, gap: 2, padding: spacing.sm },
  evidenceName: { color: colours.ink, fontSize: 13, fontWeight: '800' },
  completionCard: { backgroundColor: colours.surface, borderColor: colours.line, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  progress: { color: colours.green, fontSize: 15, fontWeight: '900' },
  blocker: { color: colours.red, lineHeight: 20 },
  issueCard: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  offlineCard: { alignItems: 'flex-start', backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  error: { backgroundColor: '#fff0ed', borderRadius: radius.sm, color: colours.red, fontWeight: '700', lineHeight: 20, padding: spacing.md },
});
