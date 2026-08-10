import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import {
  complianceCasesForJob,
  type GovernedEvidenceSelection,
} from '@/lib/compliance';
import { getSetting, setSetting } from '@/lib/database';
import {
  buildEvidenceEnvelope,
  cameraPermissionState,
  captureSessionId,
  evidenceIdentifiers,
  observeLocation,
  observedTime,
  serialisableAsset,
  type PendingPhotoCapture,
} from '@/lib/evidence';
import { colours, radius, spacing } from '@/lib/theme';
import type {
  ComplianceEvidenceRequirement,
  FieldForm,
  FieldJob,
  FieldJobCompliance,
} from '@/lib/types';
import { useApp } from '@/providers/app-provider';

const fieldActions: Record<string, { transition: 'start_travel' | 'arrive' | 'start_work' | 'finish'; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  scheduled: { transition: 'start_travel', label: 'Start travel', icon: 'car-arrow-right' },
  en_route: { transition: 'arrive', label: 'Arrive', icon: 'map-marker-check-outline' },
  arrived: { transition: 'start_work', label: 'Start work', icon: 'play-circle-outline' },
  in_progress: { transition: 'finish', label: 'Finish', icon: 'check-circle-outline' },
};

const PENDING_PHOTO_SETTING = 'pending_evidence_photo_v1';
const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const DEFAULT_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function readable(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function maximumReached(requirement: ComplianceEvidenceRequirement) {
  return requirement.maximumCount > 0 && requirement.submittedCount >= requirement.maximumCount;
}

function captureBlocker(requirement: ComplianceEvidenceRequirement, mode: 'camera' | 'document') {
  const configuredBlocker = requirement.compatibility?.blockers?.[0];
  if (!requirement.compatibility?.captureSupported || configuredBlocker) {
    return configuredBlocker || 'This governed evidence requirement is not supported by this field app version.';
  }
  if (!requirement.captureModes?.includes(mode)) {
    return mode === 'camera'
      ? 'This requirement must be supplied as an original document.'
      : 'This requirement must be captured with the in-app camera.';
  }
  if (maximumReached(requirement)) {
    return `The policy maximum of ${requirement.maximumCount} submitted file${requirement.maximumCount === 1 ? '' : 's'} has been reached.`;
  }
  return '';
}

function evidenceCategory(selection?: GovernedEvidenceSelection) {
  const requirement = selection?.requirement;
  const timing = requirement?.captureTiming.toLowerCase() || '';
  if (timing.includes('before') || timing.startsWith('pre_')) return 'before' as const;
  if (timing.includes('after') || timing.startsWith('post_')) return 'after' as const;
  return 'progress' as const;
}

function evidenceCaption(selection?: GovernedEvidenceSelection) {
  if (!selection) return '';
  const { complianceCase, requirement } = selection;
  return `${complianceCase.activityCode} | ${requirement.code}: ${requirement.title}`.slice(0, 300);
}

function evidenceBusyKey(
  mode: 'photo' | 'document',
  selection?: GovernedEvidenceSelection,
) {
  return selection
    ? `${mode}:${selection.complianceCase.caseId}:${selection.requirement.id}`
    : `${mode}:general`;
}

function pendingEvidenceBusyKey(pending: PendingPhotoCapture) {
  const { complianceCaseId, evidenceRequirementId } = pending.identifiers;
  return evidenceRequirementId
    ? `photo:${complianceCaseId || 'unbound'}:${evidenceRequirementId}`
    : 'photo:general';
}

function gpsPreflightBlocker(location: PendingPhotoCapture['preCaptureLocation']) {
  if (location.state !== 'captured') {
    return 'Allow precise location and turn on location services before taking the photo.';
  }
  if (location.mocked === true) {
    return 'Mocked device locations cannot be used for governed evidence. Use the physical device at the installation site.';
  }
  if (
    location.accuracyMetres === null
    || !Number.isFinite(location.accuracyMetres)
    || location.accuracyMetres < 0
    || location.accuracyMetres > 100
  ) {
    return 'Location accuracy must be reported within 100 metres before taking the photo. Move to a clearer area and try again.';
  }
  return '';
}

function pendingPhoto(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as PendingPhotoCapture;
  } catch {
    return null;
  }
}

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { findJob, saveAction, saveUpload, sync } = useApp();
  const [job, setJob] = useState<FieldJob | null>(null);
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const recoveringPhoto = useRef(false);
  const launchingCamera = useRef(false);

  const load = useCallback(async () => setJob(await findJob(String(id))), [findJob, id]);

  const processPendingPhoto = useCallback(async (pending: PendingPhotoCapture) => {
    if (!pending.asset || recoveringPhoto.current) return;
    recoveringPhoto.current = true;
    const busyKey = pendingEvidenceBusyKey(pending);
    setBusy(busyKey);
    try {
      const location = pending.preCaptureLocation;
      const locationPermission = pending.preCaptureLocationPermission;
      const gpsBlocker = pending.gpsRequired
        ? gpsPreflightBlocker(location)
        : '';
      if (gpsBlocker) {
        Alert.alert(
          'Location evidence is required',
          `${gpsBlocker} This photo remains pending on this device and its original pre-capture observation will not be replaced.`,
        );
        return;
      }
      const file = new File(pending.asset.uri);
      if (!file.exists || file.size < 1) throw new Error('The captured photo is no longer available on this device.');
      if (file.size > MAX_EVIDENCE_BYTES) throw new Error('The captured photo is larger than the 50 MB evidence limit.');
      const contentType = pending.asset.mimeType || file.type || 'image/jpeg';
      if (!ALLOWED_EVIDENCE_TYPES.has(contentType) || !contentType.startsWith('image/')) {
        throw new Error('The original camera file is not a supported JPEG, PNG or WebP image.');
      }
      const envelope = await buildEvidenceEnvelope({
        captureSessionId: pending.captureSessionId,
        source: 'in_app_camera',
        identifiers: pending.identifiers,
        cameraPermission: pending.cameraPermission,
        locationPermission,
        location,
        asset: pending.asset,
        observedTime: {
          captureObservedAtUtc: pending.captureObservedAtUtc,
          utcOffsetMinutes: pending.utcOffsetMinutes,
          timeZone: pending.timeZone,
        },
      });
      const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      await saveUpload({
        workOrderId: pending.identifiers.jobId,
        uri: pending.asset.uri,
        fileName: pending.asset.fileName || `job-photo-${Date.now()}.${extension}`,
        contentType,
        sizeBytes: file.size,
        category: pending.category,
        caption: pending.caption,
        evidenceEnvelope: envelope,
        clearSettingKey: PENDING_PHOTO_SETTING,
      });
      const locationMessage = location.state === 'captured'
        ? ` Location accuracy was ${location.accuracyMetres === null ? 'not reported' : `${Math.round(location.accuracyMetres)} metres`}.`
        : ` Location was recorded as ${readable(location.state)}.`;
      Alert.alert(
        'Evidence saved',
        `${sync.online ? 'The original file and capture record are uploading securely.' : 'The original file and capture record will upload when reception returns.'}${locationMessage} Compliance review is still required against the applicable scheme rules.`,
      );
    } catch (error) {
      Alert.alert(
        'Evidence is still pending',
        error instanceof Error ? error.message : 'The photo could not be secured for upload. Reopen the job and try again.',
      );
    } finally {
      setBusy('');
      recoveringPhoto.current = false;
    }
  }, [saveUpload, sync.online]);

  const recoverPendingPhoto = useCallback(async () => {
    if (recoveringPhoto.current) return;
    let pending = pendingPhoto(await getSetting(PENDING_PHOTO_SETTING));
    if (!pending) return;
    if (!pending.asset) {
      const result = await ImagePicker.getPendingResultAsync();
      if (!result) {
        await setSetting(PENDING_PHOTO_SETTING, '');
        return;
      }
      if (!('canceled' in result)) {
        await setSetting(PENDING_PHOTO_SETTING, '');
        Alert.alert('Camera result unavailable', result.message || 'The camera did not return a usable photo.');
        return;
      }
      if (result.canceled || !result.assets?.[0]) {
        await setSetting(PENDING_PHOTO_SETTING, '');
        return;
      }
      pending = {
        ...pending,
        asset: serialisableAsset(result.assets[0]),
      };
      await setSetting(PENDING_PHOTO_SETTING, JSON.stringify(pending));
    }
    await processPendingPhoto(pending);
  }, [processPendingPhoto]);

  useFocusEffect(useCallback(() => {
    void load();
    void recoverPendingPhoto();
  }, [load, recoverPendingPhoto]));

  async function advanceFieldJob() {
    if (!job) return; const action = fieldActions[job.appointmentStatus]; if (!action) return;
    const governedEvidenceIncomplete = complianceCasesForJob(job).some(
      (complianceCase) => complianceCase.requirements.some(
        (requirement) => requirement.submittedCount < requirement.minimumCount,
      ),
    );
    const localBlockers = [
      job.tasks.some((item) => item.status !== 'done') ? 'assigned tasks' : '',
      job.forms.some((item) => item.status !== 'complete') ? 'required forms' : '',
      governedEvidenceIncomplete ? 'governed evidence' : '',
      job.openIssues ? 'open issues' : '',
    ].filter(Boolean);
    if (action.transition === 'finish' && !sync.online) return Alert.alert('Reconnect before finishing', 'Finish must check current forms, evidence, issues and unsynchronised changes. Other field updates remain safely queued offline.');
    if (action.transition === 'finish' && localBlockers.length) return Alert.alert('Finish the required work', `Complete ${localBlockers.join(', ')} first.`);
    setBusy(`field:${action.transition}`);
    try { await saveAction({ type: 'advance_field_job', workOrderId: job.id, baseRevision: job.revision, transition: action.transition }); await load(); }
    catch { Alert.alert('Action required', 'The field action remains saved on this device. Open Sync to review it or try again when the connection is stable.'); }
    finally { setBusy(''); }
  }

  async function toggleTask(taskId: string) {
    if (!job) return;
    const task = job.tasks.find((item) => item.id === taskId);
    if (!task) return;
    setBusy(`task:${taskId}`);
    await saveAction({ type: 'set_task_status', workOrderId: job.id, taskId, baseRevision: task.revision, status: task.status === 'done' ? 'pending' : 'done' });
    await load(); setBusy('');
  }

  async function addTime() {
    if (!job) return;
    if (job.fieldLane === 'creditex_manual') {
      return Alert.alert(
        'Time entry unavailable',
        'Manual compliance test jobs do not support time entries.',
      );
    }
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return Alert.alert('Check the time', 'Enter the number of minutes worked, from 1 to 1440.');
    setBusy('time');
    const today = new Date().toISOString().slice(0, 10);
    await saveAction({ type: 'add_time_entry', workOrderId: job.id, baseRevision: job.revision, workDate: today, durationMinutes: minutes, notes: notes.trim() });
    setDuration(''); setNotes(''); setBusy('');
    Alert.alert('Time saved', sync.online ? 'The entry is syncing now.' : 'The entry is secure on this device and will sync later.');
  }

  async function saveForm(form: FieldForm, answers: Record<string, string | boolean>, complete: boolean) {
    if (!job) return;
    const missing = form.template.fields.filter((field) => field.required && (field.type === 'checkbox' ? answers[field.key] !== true : !String(answers[field.key] || '').trim())).map((field) => field.label);
    if (complete && missing.length) return Alert.alert('Finish the required fields', missing.join('\n'));
    setBusy(`form:${form.id}`);
    await saveAction({ type: 'save_job_form', workOrderId: job.id, formId: form.id, baseRevision: form.revision, answers, complete });
    await load(); setBusy('');
    Alert.alert(complete ? 'Form completed' : 'Draft saved', sync.online ? 'The field record is syncing now.' : 'The field record is secure on this device and will sync when reception returns.');
  }

  async function capturePhoto(selection?: GovernedEvidenceSelection) {
    if (!job || launchingCamera.current) return;
    const requirement = selection?.requirement;
    let identifiers;
    try {
      identifiers = evidenceIdentifiers(job, selection);
    } catch (error) {
      return Alert.alert(
        'Sync this requirement',
        error instanceof Error ? error.message : 'This governed evidence requirement is not ready for capture.',
      );
    }
    if (requirement) {
      const blocker = captureBlocker(requirement, 'camera');
      if (blocker) return Alert.alert('Camera capture is unavailable', blocker);
    }
    launchingCamera.current = true;
    setBusy(evidenceBusyKey('photo', selection));
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in device settings to add a job photo.');
        return;
      }
      const preCaptureLocation = await observeLocation(true);
      const gpsBlocker = requirement?.gpsRequired
        ? gpsPreflightBlocker(preCaptureLocation.location)
        : '';
      if (gpsBlocker) {
        Alert.alert(
          'Location evidence is required',
          gpsBlocker,
        );
        return;
      }
      let pending: PendingPhotoCapture = {
        captureSessionId: captureSessionId(),
        ...observedTime(),
        identifiers,
        category: evidenceCategory(selection),
        caption: evidenceCaption(selection),
        gpsRequired: requirement?.gpsRequired || false,
        cameraPermission: cameraPermissionState(permission),
        preCaptureLocationPermission: preCaptureLocation.permission,
        preCaptureLocation: preCaptureLocation.location,
      };
      await setSetting(PENDING_PHOTO_SETTING, JSON.stringify(pending));
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        exif: true,
        cameraType: ImagePicker.CameraType.back,
      });
      if (result.canceled || !result.assets[0]) {
        await setSetting(PENDING_PHOTO_SETTING, '');
        return;
      }
      pending = {
        ...pending,
        asset: serialisableAsset(result.assets[0]),
      };
      await setSetting(PENDING_PHOTO_SETTING, JSON.stringify(pending));
      launchingCamera.current = false;
      await processPendingPhoto(pending);
    } catch (error) {
      Alert.alert('Camera evidence is pending', error instanceof Error ? error.message : 'The camera did not return a usable photo.');
    } finally {
      launchingCamera.current = false;
      setBusy('');
    }
  }

  async function chooseDocument(selection?: GovernedEvidenceSelection) {
    if (!job) return;
    const requirement = selection?.requirement;
    let identifiers;
    try {
      identifiers = evidenceIdentifiers(job, selection);
    } catch (error) {
      return Alert.alert(
        'Sync this requirement',
        error instanceof Error ? error.message : 'This governed evidence requirement is not ready for capture.',
      );
    }
    if (requirement) {
      const blocker = captureBlocker(requirement, 'document');
      if (blocker) return Alert.alert('Document capture is unavailable', blocker);
    }
    const configuredTypes = requirement?.allowedContentTypes?.filter((contentType) => ALLOWED_EVIDENCE_TYPES.has(contentType)) || [];
    const result = await DocumentPicker.getDocumentAsync({
      type: configuredTypes.length ? configuredTypes : DEFAULT_DOCUMENT_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const file = new File(asset.uri);
    if (!file.exists || file.size < 1) return Alert.alert('File is unavailable', 'Choose the original file again.');
    if (file.size > MAX_EVIDENCE_BYTES) return Alert.alert('File is too large', 'Choose a photo or PDF no larger than 50 MB.');
    const contentType = asset.mimeType || file.type || 'application/pdf';
    if (!ALLOWED_EVIDENCE_TYPES.has(contentType)) return Alert.alert('File type is not supported', 'Choose the original JPEG, PNG, WebP or PDF file.');
    if (configuredTypes.length && !configuredTypes.includes(contentType)) {
      return Alert.alert('File type is not allowed', 'Choose a file type listed for this governed evidence requirement.');
    }
    const envelope = await buildEvidenceEnvelope({
      captureSessionId: captureSessionId(),
      source: 'document_picker',
      identifiers,
    });
    setBusy(evidenceBusyKey('document', selection));
    try {
      await saveUpload({
        workOrderId: job.id,
        uri: asset.uri,
        fileName: asset.name,
        contentType,
        sizeBytes: file.size,
        category: requirement ? evidenceCategory(selection) : 'document',
        caption: evidenceCaption(selection),
        evidenceEnvelope: envelope,
      });
      Alert.alert(
        'Original file saved',
        `${sync.online ? 'The file and SHA-256 capture record are uploading securely.' : 'The file and SHA-256 capture record will upload when reception returns.'} Compliance review is still required against the applicable scheme rules.`,
      );
    } catch (error) {
      Alert.alert('File was not saved', error instanceof Error ? error.message : 'Choose the original file and try again.');
    } finally {
      setBusy('');
    }
  }

  if (!job) return <Screen><View style={styles.empty}><MaterialCommunityIcons name="briefcase-remove-outline" size={42} color={colours.muted} /><Text style={styles.title}>Job is not available</Text><Text style={styles.body}>It may have been unassigned or removed during sync.</Text></View></Screen>;

  const completed = job.tasks.filter((task) => task.status === 'done').length;
  const fieldForms = job.forms || [];
  const complianceCases = complianceCasesForJob(job);
  const complianceRequirements = complianceCases.flatMap(
    (complianceCase) => complianceCase.requirements,
  );
  const acceptedComplianceRequirements = complianceRequirements.filter(
    (requirement) => requirement.acceptedCount >= requirement.minimumCount,
  ).length;
  const submittedComplianceRequirements = complianceRequirements.filter(
    (requirement) => requirement.submittedCount >= requirement.minimumCount,
  ).length;
  const fieldAction = fieldActions[job.appointmentStatus];
  const syncLabel = !sync.online ? 'Offline' : sync.conflicts ? 'Action required' : sync.running || sync.queuedActions || sync.queuedUploads ? 'Syncing' : 'Saved';
  const creditexManual = job.fieldLane === 'creditex_manual';
  const syntheticManual = job.recordMode === 'synthetic_test' && creditexManual;
  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.badges}><View style={styles.jobNumber}><Text style={styles.jobNumberText}>{job.workNumber}</Text></View><View style={styles.stage}><Text style={styles.stageText}>{readable(job.stage)}</Text></View>{syntheticManual ? <View style={styles.syntheticBadge}><Text style={styles.syntheticBadgeText}>SYNTHETIC TEST ONLY</Text></View> : null}</View>
        <Text style={styles.title}>{job.title || 'Field job'}</Text>
        <Text style={styles.body}>{job.customerName} | {job.protectedJob ? job.siteArea || 'Protected service area' : job.serviceAddress || job.siteArea || 'Service site not added'}</Text>
        {job.appointmentStartsAt ? <Text style={styles.meta}>{new Date(job.appointmentStartsAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</Text> : null}
      </View>

      <View style={[styles.privacy, job.protectedJob && styles.protected]}>
        <MaterialCommunityIcons name={job.protectedJob ? 'shield-lock-outline' : 'map-marker-check-outline'} size={26} color={colours.green} />
        <View style={styles.flex}><Text style={styles.cardTitle}>{syntheticManual ? 'Manual compliance workflow test' : job.protectedJob ? 'Australian Energy Assessments protected job' : 'Direct customer job'}</Text><Text style={styles.body}>{syntheticManual ? 'Use only the supplied test alias and synthetic postcode. This lane cannot create certificates, registry submissions, trades or settlements.' : job.protectedJob ? 'Customer name, phone, email and street address stay protected. Use the Australian Energy Assessments platform for communication.' : job.serviceAddress || `${job.siteArea || 'Service area'} | Address is not stored offline yet.`}</Text></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>NEXT ACTION</Text>
        {fieldAction ? <Pressable accessibilityRole="button" accessibilityLabel={fieldAction.label} disabled={busy !== ''} onPress={() => void advanceFieldJob()} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><MaterialCommunityIcons name={fieldAction.icon} size={28} color={colours.white} /><Text style={styles.primaryActionText}>{busy === `field:${fieldAction.transition}` ? 'Saving...' : fieldAction.label}</Text></Pressable> : <Text style={styles.body}>{job.appointmentStatus === 'completed' && job.stage === 'completed' ? 'Field work is complete. Invoice and handover are ready in TLink.' : job.appointmentStatus === 'completed' ? 'This appointment was completed outside the field workflow. Ask dispatch to reopen or reschedule it.' : 'Schedule this job before starting travel.'}</Text>}
        {!job.protectedJob && (job.customerPhone || job.serviceAddress) ? <View style={styles.row}>{job.customerPhone ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`tel:${job.customerPhone.replace(/[^+\d]/g, '')}`)} style={[styles.contactAction, styles.flex]}><Text style={styles.contactActionText}>Call</Text></Pressable> : null}{job.serviceAddress ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.serviceAddress)}`)} style={[styles.contactAction, styles.flex]}><Text style={styles.contactActionText}>Get directions</Text></Pressable> : null}</View> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}><View><Text style={styles.label}>TODAY</Text><Text style={styles.cardTitle}>What must happen</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={job.description ? 'check-circle-outline' : 'alert-circle-outline'} size={25} color={job.description ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Scope and instructions</Text><Text style={styles.meta}>{job.description || 'Open Notes in TLink before starting.'}</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={completed === job.tasks.length ? 'check-circle-outline' : 'clipboard-check-outline'} size={25} color={completed === job.tasks.length ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Assigned tasks</Text><Text style={styles.meta}>{completed}/{job.tasks.length} complete</Text></View></View>
        {job.tasks.length ? job.tasks.map((task) => <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.status === 'done' }} key={task.id} disabled={busy !== ''} onPress={() => void toggleTask(task.id)} style={({ pressed }) => [styles.task, pressed && styles.pressed]}><MaterialCommunityIcons name={task.status === 'done' ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={28} color={task.status === 'done' ? colours.green : colours.muted} /><View style={styles.flex}><Text style={[styles.taskTitle, task.status === 'done' && styles.taskDone]}>{task.title}</Text>{task.dueAt ? <Text style={styles.meta}>Due {new Date(task.dueAt).toLocaleDateString('en-AU')}</Text> : null}</View></Pressable>) : <Text style={styles.body}>No checklist has been added by the office.</Text>}
        <View style={styles.todayItem}><MaterialCommunityIcons name={fieldForms.every((form) => form.status === 'complete') ? 'check-circle-outline' : 'file-document-edit-outline'} size={25} color={fieldForms.every((form) => form.status === 'complete') ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Required forms</Text><Text style={styles.meta}>{fieldForms.filter((form) => form.status === 'complete').length}/{fieldForms.length} complete</Text></View></View>
        {complianceCases.length ? <View style={styles.todayItem}><MaterialCommunityIcons name={submittedComplianceRequirements === complianceRequirements.length ? 'check-circle-outline' : 'certificate-outline'} size={25} color={submittedComplianceRequirements === complianceRequirements.length ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Government program evidence</Text><Text style={styles.meta}>{submittedComplianceRequirements}/{complianceRequirements.length} requirements submitted, {acceptedComplianceRequirements} accepted, across {complianceCases.length} activit{complianceCases.length === 1 ? 'y' : 'ies'}</Text></View></View> : null}
        <View style={styles.todayItem}><MaterialCommunityIcons name={job.media.length ? 'check-circle-outline' : 'camera-outline'} size={25} color={job.media.length ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Required photo proof</Text><Text style={styles.meta}>{job.media.length} field file{job.media.length === 1 ? '' : 's'} synced</Text></View></View>
        <View style={styles.todayItem}><MaterialCommunityIcons name={!job.openIssues ? 'check-circle-outline' : 'alert-circle-outline'} size={25} color={!job.openIssues ? colours.green : colours.muted} /><View style={styles.flex}><Text style={styles.taskTitle}>Open issues or blockers</Text><Text style={styles.meta}>{job.openIssues ? `${job.openIssues} need attention in TLink Notes` : 'None open'}</Text></View></View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeading}><View><Text style={styles.label}>FIELD FORMS</Text><Text style={styles.cardTitle}>Technical records</Text></View><Text style={styles.progress}>{fieldForms.filter((form) => form.status === 'complete').length}/{fieldForms.length}</Text></View>
        <Text style={styles.body}>Complete these short technical records with or without reception. Drafts stay encrypted on this device until sync succeeds.</Text>
        {fieldForms.length ? fieldForms.map((form) => <JobFieldForm key={`${form.id}:${form.updatedAt}`} form={form} busy={busy === `form:${form.id}`} onSave={saveForm} />) : <Text style={styles.body}>No field forms have been assigned to this job.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>FIELD EVIDENCE</Text><Text style={styles.cardTitle}>Photos and documents</Text>
        <Text style={styles.body}>The app preserves the exact file returned by the camera picker without further editing or recompression, requests available EXIF, adds independent time and location observations, and hashes the exact queued bytes with SHA-256. Files save encrypted on this device first and resume automatically after a connection drops.</Text>
        {syntheticManual ? <Text style={styles.warningText}>Manual program testing only. A physical-device report and server-verified retained bytes are required before a prompt counts as complete. Compliance review is still separate.</Text> : null}
        <Text style={styles.meta}>These records support audit review. They are not a government or scheme acceptance decision.</Text>
        {complianceCases.length > 1 ? <Text style={styles.multiCaseNotice}>This job has {complianceCases.length} governed activities. Capture each requirement inside its matching case below.</Text> : null}
        {complianceCases.map((complianceCase, index) => (
          <ComplianceCaseEvidence
            key={complianceCase.caseId}
            complianceCase={complianceCase}
            index={index}
            total={complianceCases.length}
            busy={busy}
            onPhoto={(selection) => void capturePhoto(selection)}
            onDocument={(selection) => void chooseDocument(selection)}
          />
        ))}
        {!syntheticManual ? <><Text style={styles.inputLabel}>{complianceCases.length ? 'General job files' : 'Job files'}</Text>
        <View style={styles.row}><FieldButton variant="secondary" loading={busy === 'photo:general'} style={styles.flex} onPress={() => void capturePhoto()}>Take photo</FieldButton><FieldButton variant="secondary" loading={busy === 'document:general'} style={styles.flex} onPress={() => void chooseDocument()}>Add document</FieldButton></View></> : null}
        {complianceCases.length ? <Text style={styles.meta}>General job files remain separate and are not submitted against a governed requirement.</Text> : null}
        <Text style={styles.meta}>{job.media.length} field file{job.media.length === 1 ? '' : 's'} already synced</Text>
      </View>

      {!creditexManual ? <View style={styles.card}>
        <Text style={styles.label}>TIME ENTRY</Text><Text style={styles.cardTitle}>Record today&apos;s work</Text>
        <Text style={styles.inputLabel}>Minutes worked</Text><TextInput style={styles.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="For example, 90" />
        <Text style={styles.inputLabel}>Work note, optional</Text><TextInput style={[styles.input, styles.notes]} multiline value={notes} onChangeText={setNotes} placeholder={job.protectedJob ? 'Describe the work only. Do not add customer contact details.' : 'Briefly describe completed work'} maxLength={500} />
        <FieldButton loading={busy === 'time'} disabled={!duration} onPress={() => void addTime()}>Save time entry</FieldButton>
      </View> : null}

      <View style={styles.syncLine}><MaterialCommunityIcons name={sync.online ? sync.conflicts ? 'cloud-alert-outline' : 'cloud-check-outline' : 'cloud-off-outline'} size={20} color={colours.green} /><Text style={styles.body}>{syncLabel}</Text></View>
    </Screen>
  );
}

function ComplianceCaseEvidence({
  complianceCase,
  index,
  total,
  busy,
  onPhoto,
  onDocument,
}: {
  complianceCase: FieldJobCompliance;
  index: number;
  total: number;
  busy: string;
  onPhoto: (selection: GovernedEvidenceSelection) => void;
  onDocument: (selection: GovernedEvidenceSelection) => void;
}) {
  return <View style={styles.complianceBlock}>
    <View style={styles.caseSequence}>
      <Text style={styles.caseSequenceText}>GOVERNED ACTIVITY {index + 1} OF {total}</Text>
    </View>
    <View style={styles.complianceHeading}>
      <MaterialCommunityIcons name="certificate-outline" size={25} color={colours.green} />
      <View style={styles.flex}>
        <Text style={styles.taskTitle}>{complianceCase.activityCode} | {complianceCase.activityTitle}</Text>
        <Text style={styles.meta}>Case {complianceCase.caseNumber || complianceCase.caseId} | Evidence policy {complianceCase.evidencePolicyVersionId || 'not assigned'}</Text>
        <Text style={styles.meta}>Case {readable(complianceCase.status || 'not started')} | Evidence {readable(complianceCase.evidenceStatus || 'not started')}</Text>
      </View>
    </View>
    {complianceCase.requirements.length ? complianceCase.requirements.map((requirement) => {
      const selection = { complianceCase, requirement };
      const atMaximum = maximumReached(requirement);
      const captureModes = requirement.captureModes || [];
      const compatibilityBlockers = requirement.compatibility?.blockers || [
        'This requirement was saved by an older field contract. Sync the job before capturing evidence.',
      ];
      const maximumLabel = requirement.maximumCount > 0
        ? `Maximum ${requirement.maximumCount}`
        : 'No policy maximum';
      return (
        <View key={requirement.id} style={styles.requirement}>
          <View style={styles.requirementHeading}>
            <View style={styles.flex}>
              <Text style={styles.taskTitle}>{requirement.code} | {requirement.title}</Text>
              <Text style={styles.meta}>
                {readable(requirement.captureTiming || 'timing not specified')} | Accepted {requirement.acceptedCount || 0}/{requirement.minimumCount} | Submitted {requirement.submittedCount || 0} | {maximumLabel} | {readable(requirement.status || 'pending')}
              </Text>
            </View>
            {requirement.gpsRequired ? <View style={styles.gpsBadge}><Text style={styles.gpsBadgeText}>GPS required</Text></View> : null}
          </View>
          {requirement.description ? <Text style={styles.body}>{requirement.description}</Text> : null}
          <Text style={styles.meta}>
            {requirement.originalRequired ? 'Original file required. ' : ''}
            {requirement.metadataRequired ? 'Camera metadata required. ' : ''}
            {requirement.dateStampRequired ? 'Capture date and time required. ' : ''}
            {readable(requirement.evidenceType || 'evidence')} evidence. Compliance review remains required.
          </Text>
          {requirement.allowedContentTypes?.length
            ? <Text style={styles.meta}>Allowed file types: {requirement.allowedContentTypes.join(', ')}</Text>
            : <Text style={styles.meta}>Allowed file types: standard field JPEG, PNG, WebP or PDF as compatible with this evidence type.</Text>}
          {compatibilityBlockers.map((blocker) => (
            <Text key={blocker} style={styles.warningText}>{blocker}</Text>
          ))}
          {atMaximum
            ? <Text style={styles.warningText}>The policy maximum has been submitted. Wait for compliance review before adding another file.</Text>
            : null}
          {!compatibilityBlockers.length && !atMaximum && captureModes.length ? (
            <View style={styles.row}>
              {captureModes.includes('camera') ? (
                <FieldButton
                  variant="secondary"
                  loading={busy === evidenceBusyKey('photo', selection)}
                  style={styles.flex}
                  onPress={() => onPhoto(selection)}
                >
                  Take {requirement.code} photo
                </FieldButton>
              ) : null}
              {captureModes.includes('document') ? (
                <FieldButton
                  variant="secondary"
                  loading={busy === evidenceBusyKey('document', selection)}
                  style={styles.flex}
                  onPress={() => onDocument(selection)}
                >
                  Add {requirement.code} file
                </FieldButton>
              ) : null}
            </View>
          ) : null}
          {!compatibilityBlockers.length && captureModes.includes('camera') && (requirement.gpsRequired || requirement.metadataRequired)
            ? <Text style={styles.meta}>Use the requirement photo button so the app can capture the required location or camera metadata.</Text>
            : null}
        </View>
      );
    }) : <Text style={styles.body}>No governed evidence requirements have been assigned to this case. Do not treat general uploads as compliance evidence.</Text>}
  </View>;
}

function JobFieldForm({ form, busy, onSave }: { form: FieldForm; busy: boolean; onSave: (form: FieldForm, answers: Record<string, string | boolean>, complete: boolean) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(form.answers || {});
  const [open, setOpen] = useState(form.status !== 'complete');
  function change(key: string, value: string | boolean) { setAnswers((current) => ({ ...current, [key]: value })); }
  return <View style={styles.formBlock}>
    <Pressable onPress={() => setOpen((value) => !value)} style={styles.formRow} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <MaterialCommunityIcons name={form.status === 'complete' ? 'check-decagram-outline' : 'clipboard-text-outline'} size={25} color={form.status === 'complete' ? colours.green : colours.muted} />
      <View style={styles.flex}><Text style={styles.taskTitle}>{form.name}</Text><Text style={styles.meta}>{form.jurisdiction} | Version {form.templateVersion} | {form.status === 'complete' ? 'Complete and locked' : form.ready ? 'Ready to complete' : `${form.missing.length} required`}</Text></View>
      <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colours.muted} />
    </Pressable>
    {open && <View style={styles.formBody}><Text style={styles.body}>{form.template.guidance}</Text>{form.template.fields.map((field) => <View key={field.key} style={styles.formField}>
      <Text style={styles.inputLabel}>{field.label}{field.required ? ' *' : ''}</Text>
      {field.type === 'checkbox' ? <Pressable disabled={form.status === 'complete'} accessibilityRole="checkbox" accessibilityState={{ checked: answers[field.key] === true }} onPress={() => change(field.key, answers[field.key] !== true)} style={[styles.checkbox, answers[field.key] === true && styles.checkboxSelected]}><MaterialCommunityIcons name={answers[field.key] === true ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={25} color={colours.green} /><Text style={styles.body}>{answers[field.key] === true ? 'Confirmed' : 'Tap to confirm'}</Text></Pressable>
        : field.type === 'select' ? <View style={styles.optionList}>{(field.options || []).map((option) => <Pressable key={option} disabled={form.status === 'complete'} onPress={() => change(field.key, option)} style={[styles.option, answers[field.key] === option && styles.optionSelected]}><Text style={styles.optionText}>{option}</Text></Pressable>)}</View>
        : field.type === 'signature' ? <View style={styles.signatureBlocked}><MaterialCommunityIcons name="alert-circle-outline" size={20} color={colours.amber} /><Text style={styles.body}>Signature capture is not available in this tested AEA Field build. This required item remains blocked and cannot be marked complete.</Text></View>
        : <TextInput editable={form.status !== 'complete'} style={[styles.input, field.type === 'textarea' && styles.notes]} multiline={field.type === 'textarea'} keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'} value={String(answers[field.key] || '')} onChangeText={(value) => change(field.key, value)} maxLength={field.maxLength || 240} placeholder={field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'number' ? 'Enter a number' : 'Enter technical job information'} />}
    </View>)}{form.status !== 'complete' && <View style={styles.formActions}><FieldButton variant="secondary" loading={busy} style={styles.flex} onPress={() => void onSave(form, answers, false)}>Save draft</FieldButton><FieldButton loading={busy} style={styles.flex} onPress={() => void onSave(form, answers, true)}>Complete</FieldButton></View>}</View>}
  </View>;
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs },
  badges: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  jobNumber: { backgroundColor: colours.forest, borderRadius: 7, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  jobNumberText: { color: colours.white, fontSize: 12, fontWeight: '800' },
  stage: { backgroundColor: colours.mint, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  stageText: { color: colours.ink, fontSize: 12, fontWeight: '700' },
  signatureBlocked: { alignItems: 'center', backgroundColor: '#fff4d6', borderColor: '#d99000', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  syntheticBadge: { backgroundColor: '#fff0bf', borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  syntheticBadgeText: { color: '#674b00', fontSize: 11, fontWeight: '900' },
  title: { color: colours.ink, fontSize: 28, lineHeight: 34, fontWeight: '800' },
  body: { color: colours.muted, lineHeight: 21 },
  privacy: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colours.white, borderWidth: 1, borderColor: colours.line },
  protected: { backgroundColor: colours.mint, borderColor: colours.mintStrong },
  flex: { flex: 1 },
  card: { backgroundColor: colours.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colours.line, gap: spacing.sm },
  cardTitle: { color: colours.ink, fontSize: 19, fontWeight: '800' },
  cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  progress: { color: colours.green, fontSize: 18, fontWeight: '800' },
  primaryAction: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colours.green, borderRadius: radius.md },
  primaryActionText: { color: colours.white, fontSize: 18, fontWeight: '800' },
  contactAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colours.green, borderRadius: radius.sm },
  contactActionText: { color: colours.green, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  task: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingVertical: spacing.sm },
  todayItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingVertical: spacing.sm },
  taskTitle: { color: colours.ink, fontSize: 16, fontWeight: '600' },
  taskDone: { color: colours.muted, textDecorationLine: 'line-through' },
  formRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colours.line, paddingVertical: spacing.sm },
  formBlock: { borderTopWidth: 1, borderTopColor: colours.line },
  formBody: { backgroundColor: '#fbfdfc', borderRadius: radius.sm, gap: spacing.sm, padding: spacing.md },
  formField: { gap: 6 },
  checkbox: { alignItems: 'center', borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
  checkboxSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  optionList: { gap: 7 },
  option: { borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, minHeight: 46, justifyContent: 'center', paddingHorizontal: spacing.md },
  optionSelected: { backgroundColor: colours.mint, borderColor: colours.green },
  optionText: { color: colours.ink, fontWeight: '700' },
  formActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  complianceBlock: { backgroundColor: colours.mint, borderColor: colours.mintStrong, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  complianceHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  caseSequence: { alignSelf: 'flex-start', backgroundColor: colours.forest, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  caseSequenceText: { color: colours.white, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  multiCaseNotice: { backgroundColor: '#fff8e7', borderColor: colours.amber, borderRadius: radius.sm, borderWidth: 1, color: colours.ink, fontSize: 13, fontWeight: '700', lineHeight: 19, padding: spacing.sm },
  requirement: { backgroundColor: colours.white, borderColor: colours.line, borderRadius: radius.sm, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  requirementHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  gpsBadge: { backgroundColor: colours.forest, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  gpsBadgeText: { color: colours.white, fontSize: 11, fontWeight: '800' },
  meta: { color: colours.muted, fontSize: 12, lineHeight: 17 },
  warningText: { color: colours.red, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  inputLabel: { color: colours.ink, fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 50, borderWidth: 1, borderColor: colours.line, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontSize: 16, color: colours.ink, backgroundColor: '#fbfdfc' },
  notes: { minHeight: 90, textAlignVertical: 'top', paddingTop: spacing.md },
  syncLine: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
});
