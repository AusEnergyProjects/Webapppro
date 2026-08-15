import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ActivityWorkPackWizard,
  type ActivityWorkPackPromptContext,
} from '@/components/ActivityWorkPackWizard';
import { FieldButton } from '@/components/field-button';
import { Screen } from '@/components/screen';
import { firebaseAuth } from '@/lib/auth';
import {
  apiRequest,
  downloadAssignedWorkPackDocument,
  governedReferenceDocumentBytesSha256,
} from '@/lib/api';
import {
  complianceCasesForJob,
  type GovernedEvidenceSelection,
} from '@/lib/compliance';
import {
  addUpload,
  discardUpload,
  getSetting,
  listPendingWorkPackActions,
  listWorkPackProblems,
  setSetting,
} from '@/lib/database';
import { APP_VERSION } from '@/lib/config';
import { getDeviceId } from '@/lib/device';
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
  FieldComplianceIntent,
  FieldActivityWorkPack,
  FieldForm,
  FieldJob,
  FieldJobCompliance,
  FieldWorkPackCustomerContext,
  FieldWorkPackDeviceAttestation,
  FieldWorkPackReferenceDocumentProjection,
  FieldWorkPackOfficialProduct,
  FieldWorkPackOfficialProductSelection,
  FieldWorkPackSignatureAttestation,
  FieldWorkPackSignatureDraft,
  FieldWorkPackSignerIdentity,
} from '@/lib/types';
import {
  createFieldWorkPackSignaturePdf,
  fieldWorkPackFinalRecordCacheFile,
  fieldWorkPackSha256,
  fieldWorkPackReferenceDocumentCacheFile,
  FIELD_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
  FIELD_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
  FIELD_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
  FIELD_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
  signatureDraftReady,
  workPackPromptResponseKey,
  type FieldWorkPackSectionPatch,
} from '@/lib/work-packs';
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

type WorkPackUploadLink = {
  caseInstanceId: string;
  sectionKey: string;
  repeatInstanceKey: string;
  promptKey: string;
};

type PendingWorkPackPhotoCapture = PendingPhotoCapture & {
  workPackLink?: WorkPackUploadLink;
};

function readable(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

async function openVerifiedWorkPackDocument(
  cacheFile: File,
  path: string,
  expected: Readonly<{
    sha256: string;
    contentType: string;
    sizeBytes: number;
  }>,
) {
  const expectedSha256 = expected.sha256.trim().toLowerCase().replace(/^sha256:/, '');
  let verified = false;
  if (cacheFile.exists && cacheFile.size === expected.sizeBytes) {
    verified = await governedReferenceDocumentBytesSha256(await cacheFile.bytes())
      === expectedSha256;
  }
  if (!verified) {
    if (cacheFile.exists) cacheFile.delete();
    const downloaded = await downloadAssignedWorkPackDocument(path, expected);
    cacheFile.write(downloaded.bytes);
    verified = cacheFile.exists
      && cacheFile.size === expected.sizeBytes
      && await governedReferenceDocumentBytesSha256(await cacheFile.bytes())
        === expectedSha256;
  }
  if (!verified) {
    if (cacheFile.exists) cacheFile.delete();
    throw new Error('The exact approved document could not be verified on this device.');
  }
  const openUri = Platform.OS === 'android' ? cacheFile.contentUri : cacheFile.uri;
  if (!openUri) throw new Error('This device cannot open the approved document.');
  await Linking.openURL(openUri);
}

function boundSignatureStrokes(draft: FieldWorkPackSignatureDraft) {
  const origin = draft.strokes[0]?.points[0]?.capturedAtMs || Date.now();
  return draft.strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({
      x: point.x,
      y: point.y,
      pressure: point.pressure,
      capturedAtOffsetMs: Math.max(0, point.capturedAtMs - origin),
    })),
  }));
}

function plannedDateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Date not set';
}

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
    return JSON.parse(value) as PendingWorkPackPhotoCapture;
  } catch {
    return null;
  }
}

function workPackUploadLink(context: ActivityWorkPackPromptContext): WorkPackUploadLink {
  return {
    caseInstanceId: context.pack.instance.id,
    sectionKey: context.section.sectionKey,
    repeatInstanceKey: context.repeatInstanceKey,
    promptKey: context.prompt.promptKey,
  };
}

function workPackCaptureCategory(context: ActivityWorkPackPromptContext) {
  const stage = context.prompt.stageKey.toLowerCase();
  if (stage.includes('before') || stage.startsWith('pre')) return 'before' as const;
  if (stage.includes('after') || stage.startsWith('post')) return 'after' as const;
  return 'progress' as const;
}

function workPackCaption(context: ActivityWorkPackPromptContext) {
  return `${context.pack.definition.title} | ${context.prompt.label}`.slice(0, 300);
}

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    findJob,
    saveAction,
    saveUpload,
    sync,
  } = useApp();
  const [job, setJob] = useState<FieldJob | null>(null);
  const [workPackProblems, setWorkPackProblems] = useState<Record<string, string>>({});
  const [pendingWorkPackActions, setPendingWorkPackActions] = useState<Record<string, string[]>>({});
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const recoveringPhoto = useRef(false);
  const launchingCamera = useRef(false);

  const load = useCallback(async () => {
    const workOrderId = String(id);
    const [nextJob, problems, pendingActions] = await Promise.all([
      findJob(workOrderId),
      listWorkPackProblems(workOrderId),
      listPendingWorkPackActions(workOrderId),
    ]);
    setJob(nextJob);
    setWorkPackProblems(problems);
    setPendingWorkPackActions(pendingActions);
  }, [findJob, id]);

  const processPendingPhoto = useCallback(async (pending: PendingWorkPackPhotoCapture) => {
    if (!pending.asset || recoveringPhoto.current) return;
    recoveringPhoto.current = true;
    const busyKey = pendingEvidenceBusyKey(pending);
    setBusy(busyKey);
    let linkedClientUploadId = '';
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
      if (pending.workPackLink) {
        const currentJob = await findJob(pending.identifiers.jobId);
        const pack = currentJob?.activityWorkPacks?.find(
          (item) => item.instance.id === pending.workPackLink?.caseInstanceId,
        );
        if (!currentJob || !pack) {
          throw new Error('This governed work pack is no longer assigned to this device. Sync before retrying.');
        }
        const clientUploadId = `upload-${Crypto.randomUUID()}`;
        linkedClientUploadId = clientUploadId;
        await addUpload({
          id: clientUploadId,
          work_order_id: currentJob.id,
          local_uri: pending.asset.uri,
          file_name: pending.asset.fileName || `work-pack-photo-${Date.now()}.${extension}`,
          content_type: contentType,
          size_bytes: file.size,
          category: pending.category,
          caption: pending.caption,
          evidenceEnvelope: envelope,
          clearSettingKey: PENDING_PHOTO_SETTING,
        });
        await saveAction({
          type: 'work_pack_commit',
          workOrderId: currentJob.id,
          baseRevision: currentJob.revision,
          caseInstanceId: pack.instance.id,
          expectedResponseSha256: pack.instance.responseSha256,
          artifactLinks: [{
            ...pending.workPackLink,
            clientUploadId,
            deviceId: await getDeviceId(),
          }],
        });
      } else {
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
      }
      const locationMessage = location.state === 'captured'
        ? ` Location accuracy was ${location.accuracyMetres === null ? 'not reported' : `${Math.round(location.accuracyMetres)} metres`}.`
        : ` Location was recorded as ${readable(location.state)}.`;
      Alert.alert(
        'Evidence saved',
        `${sync.online ? 'The original file and capture record are uploading securely.' : 'The original file and capture record will upload when reception returns.'}${locationMessage} Compliance review is still required against the applicable scheme rules.`,
      );
      return linkedClientUploadId;
    } catch (error) {
      if (linkedClientUploadId) await discardUpload(linkedClientUploadId);
      Alert.alert(
        'Evidence is still pending',
        error instanceof Error ? error.message : 'The photo could not be secured for upload. Reopen the job and try again.',
      );
    } finally {
      setBusy('');
      recoveringPhoto.current = false;
    }
  }, [findJob, saveAction, saveUpload, sync.online]);

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

  useEffect(() => {
    if (sync.running) return undefined;
    const reload = setTimeout(() => void load(), 0);
    return () => clearTimeout(reload);
  }, [load, sync.conflicts, sync.queuedActions, sync.queuedUploads, sync.running]);

  async function advanceFieldJob() {
    if (!job) return; const action = fieldActions[job.appointmentStatus]; if (!action) return;
    const governedEvidenceIncomplete = complianceCasesForJob(job).some(
      (complianceCase) => complianceCase.requirements.some(
        (requirement) => requirement.submittedCount < requirement.minimumCount,
      ),
    );
    const complianceWorkPackMissing = (job.complianceIntents || []).some(
      (intent) => intent.status === 'planned'
        || !intent.linkedCaseReady
        || !intent.complianceCaseId
        || !(job.activityWorkPacks || []).some(
          (pack) => pack.instance.complianceIntentId === intent.id,
        ),
    );
    const complianceWorkPackIncomplete = (job.activityWorkPacks || []).some(
      (pack) => pack.instance.status !== 'completed' || !pack.finalRecord,
    );
    const localBlockers = [
      job.tasks.some((item) => item.status !== 'done') ? 'assigned tasks' : '',
      job.forms.some((item) => item.status !== 'complete') ? 'required forms' : '',
      complianceWorkPackMissing || complianceWorkPackIncomplete ? 'compliance work packs' : '',
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

  async function captureWorkPackPhoto(context: ActivityWorkPackPromptContext) {
    if (!job || launchingCamera.current) throw new Error('The camera is already open.');
    const requirement = context.prompt.fileRequirement;
    if (!requirement || context.prompt.type !== 'photo') {
      throw new Error('This governed prompt is not configured for camera capture.');
    }
    launchingCamera.current = true;
    const busyKey = `work-pack-artifact:${context.pack.instance.id}:${context.prompt.promptKey}`;
    setBusy(busyKey);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Allow camera access in device settings before taking this governed photo.');
      const preCaptureLocation = await observeLocation(requirement.gpsRequired);
      const gpsBlocker = requirement.gpsRequired
        ? gpsPreflightBlocker(preCaptureLocation.location)
        : '';
      if (gpsBlocker) throw new Error(gpsBlocker);
      let pending: PendingWorkPackPhotoCapture = {
        captureSessionId: captureSessionId(),
        ...observedTime(),
        identifiers: evidenceIdentifiers(job),
        category: workPackCaptureCategory(context),
        caption: workPackCaption(context),
        gpsRequired: requirement.gpsRequired,
        cameraPermission: cameraPermissionState(permission),
        preCaptureLocationPermission: preCaptureLocation.permission,
        preCaptureLocation: preCaptureLocation.location,
        workPackLink: workPackUploadLink(context),
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
        throw new Error('The governed photo was cancelled.');
      }
      const asset = result.assets[0];
      const contentType = asset.mimeType || 'image/jpeg';
      if (!requirement.allowedContentTypes.includes(contentType)) {
        await setSetting(PENDING_PHOTO_SETTING, '');
        throw new Error('The captured file type is not allowed by this exact governed prompt.');
      }
      pending = { ...pending, asset: serialisableAsset(asset) };
      await setSetting(PENDING_PHOTO_SETTING, JSON.stringify(pending));
      launchingCamera.current = false;
      const clientUploadId = await processPendingPhoto(pending);
      await load();
      if (!clientUploadId) throw new Error('The governed upload was not queued.');
      return clientUploadId;
    } finally {
      launchingCamera.current = false;
      setBusy('');
    }
  }

  async function chooseWorkPackDocument(context: ActivityWorkPackPromptContext) {
    if (!job) throw new Error('This job is no longer available.');
    const requirement = context.prompt.fileRequirement;
    if (!requirement || context.prompt.type !== 'document') {
      throw new Error('This governed prompt is not configured for document capture.');
    }
    const configuredTypes = requirement.allowedContentTypes.filter(
      (contentType) => ALLOWED_EVIDENCE_TYPES.has(contentType),
    );
    if (!configuredTypes.length) {
      throw new Error('This prompt has no file type supported by the installed field app.');
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: configuredTypes,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) throw new Error('The governed document was cancelled.');
    const asset = result.assets[0];
    const file = new File(asset.uri);
    const contentType = asset.mimeType || file.type || '';
    if (!file.exists || file.size < 1 || file.size > MAX_EVIDENCE_BYTES) {
      throw new Error('Choose an original file from 1 byte to 50 MB.');
    }
    if (!configuredTypes.includes(contentType)) {
      throw new Error('The selected file type is not allowed by this exact governed prompt.');
    }
    const captureId = captureSessionId();
    const envelope = await buildEvidenceEnvelope({
      captureSessionId: captureId,
      source: 'document_picker',
      identifiers: evidenceIdentifiers(job),
    });
    const clientUploadId = `upload-${Crypto.randomUUID()}`;
    const busyKey = `work-pack-artifact:${context.pack.instance.id}:${context.prompt.promptKey}`;
    setBusy(busyKey);
    try {
      await addUpload({
        id: clientUploadId,
        work_order_id: job.id,
        local_uri: asset.uri,
        file_name: asset.name,
        content_type: contentType,
        size_bytes: file.size,
        category: 'document',
        caption: workPackCaption(context),
        evidenceEnvelope: envelope,
      });
      await saveAction({
        type: 'work_pack_commit',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: context.pack.instance.id,
        expectedResponseSha256: context.pack.instance.responseSha256,
        artifactLinks: [{
          ...workPackUploadLink(context),
          clientUploadId,
          deviceId: await getDeviceId(),
        }],
      });
      return clientUploadId;
    } catch (error) {
      await discardUpload(clientUploadId);
      throw error;
    } finally {
      setBusy('');
    }
  }

  async function saveWorkPackSections(
    pack: FieldActivityWorkPack,
    patches: FieldWorkPackSectionPatch[],
  ) {
    if (!job) throw new Error('This job is no longer available.');
    setBusy(`work-pack-save:${pack.instance.id}`);
    try {
      await saveAction({
        type: 'work_pack_commit',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
        sectionPatches: patches,
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function findWorkPackOfficialProducts(
    pack: FieldActivityWorkPack,
    dependencyKey: string,
    search: string,
  ) {
    if (!sync.online) {
      throw new Error('Reconnect once to search the current approved product register. Saved form answers remain available offline.');
    }
    const query = new URLSearchParams({
      caseInstanceId: pack.instance.id,
      officialProductDependencyKey: dependencyKey,
      search: search.trim(),
      limit: '30',
    });
    const response = await apiRequest<{
      ok: true;
      officialProducts: FieldWorkPackOfficialProduct[];
    }>(`/api/trade-team/work-packs?${query.toString()}`);
    return response.officialProducts;
  }

  async function selectWorkPackOfficialProducts(
    pack: FieldActivityWorkPack,
    dependencyKey: string,
    selections: FieldWorkPackOfficialProductSelection[],
  ) {
    if (!job) throw new Error('This job is no longer available.');
    setBusy(`work-pack-products:${pack.instance.id}:${dependencyKey}`);
    try {
      await saveAction({
        type: 'work_pack_select_official_products',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
        dependencyKey,
        selections,
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function selectWorkPackScenario(
    pack: FieldActivityWorkPack,
    dependencyKey: string,
    scenarioCode: string,
  ) {
    if (!job) throw new Error('This job is no longer available.');
    setBusy(`work-pack-scenario:${pack.instance.id}:${dependencyKey}`);
    try {
      await saveAction({
        type: 'work_pack_select_scenario',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
        dependencyKey,
        scenarioCode,
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function runWorkPackCalculator(
    pack: FieldActivityWorkPack,
    dependencyKey: string,
  ) {
    if (!job) throw new Error('This job is no longer available.');
    setBusy(`work-pack-calculator:${pack.instance.id}:${dependencyKey}`);
    try {
      await saveAction({
        type: 'work_pack_run_calculator',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
        dependencyKey,
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function openWorkPackReferenceDocument(
    context: ActivityWorkPackPromptContext,
    document: FieldWorkPackReferenceDocumentProjection,
  ) {
    if (!job) throw new Error('This job is no longer available.');
    const responseKey = workPackPromptResponseKey(
      context.section,
      context.repeatInstanceKey,
      context.prompt,
    );
    if (
      context.prompt.type !== 'reference_document'
      || document.responseKey !== responseKey
      || document.sectionKey !== context.section.sectionKey
      || document.repeatInstanceKey !== context.repeatInstanceKey
      || document.promptKey !== context.prompt.promptKey
      || document.sourceBindingTargetKey
        !== context.prompt.referenceDocument?.sourceBindingTargetKey
    ) {
      throw new Error('This approved document does not belong to the selected question. Sync and try again.');
    }
    const cacheFile = fieldWorkPackReferenceDocumentCacheFile(document);
    setBusy(`work-pack-reference:${context.pack.instance.id}:${context.prompt.promptKey}`);
    try {
      await openVerifiedWorkPackDocument(
        cacheFile,
        document.openUrl,
        {
          sha256: document.sourceArtifactSha256,
          contentType: document.contentType,
          sizeBytes: document.sizeBytes,
        },
      );
    } finally {
      setBusy('');
    }
  }

  async function acknowledgeWorkPackReferenceDocument(
    context: ActivityWorkPackPromptContext,
    document: FieldWorkPackReferenceDocumentProjection,
    acknowledgedAt: string,
  ) {
    if (!job) throw new Error('This job is no longer available.');
    if (
      context.prompt.type !== 'reference_document'
      || document.sectionKey !== context.section.sectionKey
      || document.repeatInstanceKey !== context.repeatInstanceKey
      || document.promptKey !== context.prompt.promptKey
      || document.sourceBindingTargetKey
        !== context.prompt.referenceDocument?.sourceBindingTargetKey
    ) {
      throw new Error('This acknowledgement does not belong to the selected document. Sync and try again.');
    }
    setBusy(`work-pack-reference-ack:${context.pack.instance.id}:${context.prompt.promptKey}`);
    try {
      await saveAction({
        type: 'work_pack_commit',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: context.pack.instance.id,
        expectedResponseSha256: context.pack.instance.responseSha256,
        referenceAcknowledgements: [{
          sectionKey: context.section.sectionKey,
          repeatInstanceKey: context.repeatInstanceKey,
          promptKey: context.prompt.promptKey,
          sourceArtifactId: document.sourceArtifactId,
          acknowledgedAt,
        }],
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function captureWorkPackSignature(
    context: ActivityWorkPackPromptContext,
    draft: FieldWorkPackSignatureDraft,
  ) {
    if (!job || !context.prompt.attestation) {
      throw new Error('The governed signature declaration is unavailable. Sync before signing.');
    }
    if (context.pack.instance.status !== 'ready_to_sign') {
      throw new Error('Prepare and sync the exact work-pack version before capturing signatures.');
    }
    const role = context.pack.definition.schema.signerRoles.find(
      (item) => item.roleKey === context.prompt.signerRoleKey,
    );
    if (!role || !signatureDraftReady(role, draft)) {
      throw new Error('Complete the governed signer identity and draw the signature before binding it.');
    }
    const signerBinding = context.pack.signerBindings.find(
      (binding) => binding.roleKey === role.roleKey,
    );
    if (
      !signerBinding
      || signerBinding.capacity !== role.capacity
      || signerBinding.identitySource !== role.identitySource
    ) {
      throw new Error('Signer details are not available. Sync before signing.');
    }
    const signedAt = draft.capturedAt || new Date().toISOString();
    const fullPromptKey = workPackPromptResponseKey(
      context.section,
      context.repeatInstanceKey,
      context.prompt,
    );
    const signerIdentity: FieldWorkPackSignerIdentity = {
      contract: FIELD_WORK_PACK_SIGNER_IDENTITY_CONTRACT,
      roleKey: role.roleKey,
      capacity: role.capacity,
      identitySource: role.identitySource,
      signerName: signerBinding.signerName,
      signerUid: signerBinding.signerUid,
      fields: { ...signerBinding.fields },
    };
    if (
      ['assigned_worker', 'authenticated_actor'].includes(role.identitySource)
      && !signerIdentity.signerUid
    ) {
      throw new Error('The assigned technician identity is unavailable. Sync before signing.');
    }
    if (
      ['customer_context', 'manual_verified'].includes(role.identitySource)
      && signerIdentity.signerUid
    ) {
      throw new Error('Signer details no longer match this job. Sync before signing.');
    }
    const signerIdentitySha256 = await fieldWorkPackSha256(signerIdentity);
    const attestation = {
      contract: FIELD_WORK_PACK_SIGNATURE_ATTESTATION_CONTRACT,
      promptKey: fullPromptKey,
      signerRoleKey: role.roleKey,
      text: context.prompt.attestation.text,
      version: context.prompt.attestation.version,
      sourceBindingTargetKey: context.prompt.attestation.sourceBindingTargetKey,
      signerIdentity,
      signerIdentitySha256,
      definitionSha256: context.pack.signatureBindings.definitionSha256,
      prefillSha256: context.pack.signatureBindings.prefillSha256,
      responseSha256: context.pack.signatureBindings.responseSha256,
      declarationsSha256: context.pack.signatureBindings.declarationsSha256,
    } satisfies FieldWorkPackSignatureAttestation;
    const attestationSha256 = await fieldWorkPackSha256(attestation);
    const payload = {
      contract: FIELD_WORK_PACK_SIGNATURE_PAYLOAD_CONTRACT,
      instanceKey: context.pack.instance.instanceKey,
      caseInstanceId: context.pack.instance.id,
      promptKey: fullPromptKey,
      signerRoleKey: role.roleKey,
      signerName: signerBinding.signerName,
      signerCapacity: role.capacity,
      signerIdentitySha256,
      attestationSha256,
      definitionSha256: context.pack.signatureBindings.definitionSha256,
      prefillSha256: context.pack.signatureBindings.prefillSha256,
      responseSha256: context.pack.signatureBindings.responseSha256,
      declarationsSha256: context.pack.signatureBindings.declarationsSha256,
      strokes: boundSignatureStrokes(draft),
      signedAt,
    } as const;
    const signaturePayloadSha256 = await fieldWorkPackSha256(payload);
    const clientUploadId = `upload-${Crypto.randomUUID()}`;
    const signatureFile = new File(Paths.cache, `${clientUploadId}.pdf`);
    const signaturePdf = createFieldWorkPackSignaturePdf(payload);
    const sessionId = captureSessionId();
    const envelope = await buildEvidenceEnvelope({
      captureSessionId: sessionId,
      source: 'document_picker',
      identifiers: evidenceIdentifiers(job),
    });
    const deviceId = await getDeviceId();
    const capturedByUid = firebaseAuth.currentUser?.uid || '';
    const appId = Application.applicationId?.trim() || '';
    const appVersion = Application.nativeApplicationVersion?.trim() || APP_VERSION;
    const appBuild = Application.nativeBuildVersion?.trim() || '';
    if (!capturedByUid || !appId || !appBuild) {
      throw new Error('Install and sign in to the current AEA Field app before signing.');
    }
    const deviceContext = {
      appName: Application.applicationName || '',
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      isPhysicalDevice: Device.isDevice,
      manufacturer: Device.manufacturer || '',
      modelName: Device.modelName || '',
      osName: Device.osName || '',
      osVersion: Device.osVersion || '',
    };
    const deviceAttestation = {
      contract: FIELD_WORK_PACK_DEVICE_ATTESTATION_CONTRACT,
      deviceId,
      appId,
      appVersion,
      appBuild,
      sessionId,
      capturedByUid,
      signedAt,
      deviceContext,
    } satisfies FieldWorkPackDeviceAttestation;
    const deviceAttestationSha256 = await fieldWorkPackSha256(deviceAttestation);
    let actionQueued = false;
    setBusy(`work-pack-signature:${context.pack.instance.id}:${context.prompt.promptKey}`);
    try {
      signatureFile.write(signaturePdf);
      if (!signatureFile.exists || signatureFile.size < 1) {
        throw new Error('The exact signature record could not be secured on this device.');
      }
      const signatureSha256 = await governedReferenceDocumentBytesSha256(
        await signatureFile.bytes(),
      );
      await addUpload({
        id: clientUploadId,
        work_order_id: job.id,
        local_uri: signatureFile.uri,
        file_name: `governed-signature-${context.prompt.promptKey}.pdf`,
        content_type: 'application/pdf',
        size_bytes: signatureFile.size,
        category: 'document',
        caption: `Governed signature | ${context.prompt.label}`.slice(0, 300),
        evidenceEnvelope: envelope,
      });
      await saveAction({
        type: 'work_pack_capture_signatures',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: context.pack.instance.id,
        expectedResponseSha256: context.pack.instance.responseSha256,
        signaturePackets: [{
          sectionKey: context.section.sectionKey,
          repeatInstanceKey: context.repeatInstanceKey,
          promptKey: context.prompt.promptKey,
          clientUploadId,
          signerIdentity,
          signerIdentitySha256,
          attestation,
          attestationSha256,
          deviceAttestation,
          deviceAttestationSha256,
          signatureSha256,
          signaturePayloadSha256,
          signaturePayload: payload,
        }],
      });
      actionQueued = true;
      await load();
    } catch (error) {
      if (signatureFile.exists) signatureFile.delete();
      if (!actionQueued) await discardUpload(clientUploadId);
      throw error;
    } finally {
      setBusy('');
    }
  }

  async function updateWorkPackCustomerContext(
    pack: FieldActivityWorkPack,
    next: FieldWorkPackCustomerContext,
  ) {
    const binding = pack.customerContextBinding;
    if (
      !job
      || !pack.customerContext.editable
      || !binding?.editable
      || !binding.customerId
      || !binding.siteId
      || !binding.contactId
      || !/^sha256:[0-9a-f]{64}$/.test(binding.contextSha256)
    ) {
      throw new Error('Customer correction is not permitted for this protected record.');
    }
    setBusy(`work-pack-customer:${pack.instance.id}`);
    try {
      await saveAction({
        type: 'work_pack_update_customer_context',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
        customerContextBinding: binding,
        baseCustomerRevision: binding.customerRevision,
        baseSiteRevision: binding.siteRevision,
        baseContactRevision: binding.contactRevision,
        customerPatch: { firstName: next.firstName, lastName: next.lastName },
        sitePatch: {
          addressLine1: next.addressLine1,
          addressLine2: next.addressLine2,
          suburb: next.suburb,
          state: next.state,
          postcode: next.postcode,
        },
        contactPatch: { phone: next.phone, email: next.email },
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function prepareWorkPackSigning(pack: FieldActivityWorkPack) {
    if (!job) throw new Error('This job is no longer available.');
    if (!['not_started', 'in_progress'].includes(pack.instance.status)) {
      throw new Error('This work pack is not waiting for signing preparation. Sync and review its current state.');
    }
    setBusy(`work-pack-prepare-signing:${pack.instance.id}`);
    try {
      await saveAction({
        type: 'work_pack_prepare_signing',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function finalizeWorkPack(pack: FieldActivityWorkPack) {
    if (!job) throw new Error('This job is no longer available.');
    setBusy(`work-pack-finalize:${pack.instance.id}`);
    try {
      await saveAction({
        type: 'work_pack_finalize',
        workOrderId: job.id,
        baseRevision: job.revision,
        caseInstanceId: pack.instance.id,
        expectedResponseSha256: pack.instance.responseSha256,
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function openWorkPackFinalRecord(pack: FieldActivityWorkPack) {
    const record = pack.finalRecord;
    if (
      pack.instance.status !== 'completed'
      || !record
      || record.caseInstanceId !== pack.instance.id
      || record.contentType !== 'application/pdf'
    ) {
      throw new Error('The completed activity PDF is not ready. Sync this job and try again.');
    }
    const cacheFile = fieldWorkPackFinalRecordCacheFile(record);
    setBusy(`work-pack-final-record:${pack.instance.id}`);
    try {
      await openVerifiedWorkPackDocument(
        cacheFile,
        record.downloadUrl,
        {
          sha256: record.pdfSha256,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
        },
      );
    } finally {
      setBusy('');
    }
  }

  if (!job) return <Screen><View style={styles.empty}><MaterialCommunityIcons name="briefcase-remove-outline" size={42} color={colours.muted} /><Text style={styles.title}>Job is not available</Text><Text style={styles.body}>It may have been unassigned or removed during sync.</Text></View></Screen>;

  const completed = job.tasks.filter((task) => task.status === 'done').length;
  const fieldForms = job.forms || [];
  const complianceIntents = job.complianceIntents || [];
  const linkedComplianceIntents = complianceIntents.filter((intent) =>
    intent.linkedCaseReady
      && intent.complianceCaseId
      && (job.activityWorkPacks || []).some(
        (pack) => pack.instance.complianceIntentId === intent.id,
      )).length;
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

      {complianceIntents.length ? <View style={styles.card}>
        <View style={styles.cardHeading}>
          <View><Text style={styles.label}>COMPLIANCE WORK PACKS</Text><Text style={styles.cardTitle}>Selected activities</Text></View>
          <Text style={styles.progress}>{linkedComplianceIntents}/{complianceIntents.length}</Text>
        </View>
        <Text style={styles.body}>Every selected activity needs its exact governed case before regulated field work can be finished. Generic forms and general uploads do not replace the linked pack.</Text>
        {complianceIntents.map((intent, index) => {
          const pack = (job.activityWorkPacks || []).find(
            (item) => item.instance.complianceIntentId === intent.id,
          );
          return pack ? <ActivityWorkPackWizard
            key={`${pack.instance.id}:${pack.instance.responseSha256}`}
            pack={pack}
            conflict={workPackProblems[pack.instance.id]}
            pendingActions={pendingWorkPackActions[pack.instance.id] || []}
            busy={busy}
            onSaveSections={(patches) => saveWorkPackSections(pack, patches)}
            onCaptureArtifact={(context) => context.prompt.type === 'photo'
              ? captureWorkPackPhoto(context)
              : chooseWorkPackDocument(context)}
            onOpenReferenceDocument={openWorkPackReferenceDocument}
            onAcknowledgeReferenceDocument={acknowledgeWorkPackReferenceDocument}
            onCaptureSignature={captureWorkPackSignature}
            onPrepareSigning={() => prepareWorkPackSigning(pack)}
            onFinalize={() => finalizeWorkPack(pack)}
            onOpenFinalRecord={() => openWorkPackFinalRecord(pack)}
            onUpdateCustomerContext={(next) => updateWorkPackCustomerContext(pack, next)}
            onFindOfficialProducts={(dependencyKey, search) =>
              findWorkPackOfficialProducts(pack, dependencyKey, search)}
            onSelectOfficialProducts={(dependencyKey, selections) =>
              selectWorkPackOfficialProducts(pack, dependencyKey, selections)}
            onSelectScenario={(dependencyKey, scenarioCode) =>
              selectWorkPackScenario(pack, dependencyKey, scenarioCode)}
            onRunCalculator={(dependencyKey) => runWorkPackCalculator(pack, dependencyKey)}
          /> : <UnlinkedComplianceWorkPack
            key={intent.id}
            intent={intent}
            index={index}
            total={complianceIntents.length}
          />;
        })}
      </View> : null}

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

function UnlinkedComplianceWorkPack({
  intent,
  index,
  total,
}: {
  intent: FieldComplianceIntent;
  index: number;
  total: number;
}) {
  const activityLabel = [intent.activityCode, intent.activityTitle]
    .filter(Boolean)
    .join(' | ') || 'Selected government activity';
  return <View style={[styles.workPackBlock, styles.workPackSetup]}>
    <View style={styles.caseSequence}>
      <Text style={styles.caseSequenceText}>ACTIVITY {index + 1} OF {total}</Text>
    </View>
    <View style={styles.complianceHeading}>
      <MaterialCommunityIcons
        name="shield-alert-outline"
        size={25}
        color={colours.amber}
      />
      <View style={styles.flex}>
        <Text style={styles.taskTitle}>{activityLabel}</Text>
        <Text style={styles.meta}>{[intent.programCode, intent.programName].filter(Boolean).join(' | ')}</Text>
        <Text style={styles.meta}>Planned {plannedDateLabel(intent.plannedDate || intent.plannedStart)} | {readable(intent.status)}</Text>
      </View>
    </View>
    <>
      <Text style={styles.setupRequired}>CREDITEX RELEASE BLOCK</Text>
      <Text style={styles.body}>This activity does not yet have its complete approved form, documents and calculation controls. Dispatch or Creditex must resolve it before regulated work starts. Syncing alone will not clear this block.</Text>
      <Text style={styles.warningText}>Do not start the regulated activity yet. The job cannot finish until its activity form appears here.</Text>
    </>
  </View>;
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
  workPackBlock: { borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  workPackLinked: { backgroundColor: colours.mint, borderColor: colours.mintStrong },
  workPackSetup: { backgroundColor: '#fff8e7', borderColor: colours.amber },
  workPackReady: { color: colours.green, fontSize: 13, fontWeight: '800' },
  setupRequired: { color: '#674b00', fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
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
