import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

import { activityCurrentSignatureKeys } from '@/lib/activity-field-wizard';
import { ApiError, apiRequest } from '@/lib/api';
import { getSetting, listActivityFormCacheSettings, setSetting } from '@/lib/database';
import type { FieldWorkPackSignatureDraft } from '@/lib/types';
import type { ActivityAnswers, ActivityRecord } from '../../../src/lib/trade-activity-form-types';
import {
  activityBaseFieldKey,
  activityRepeatCount,
  activityWizardPages,
  activityWizardPageForStepKey,
  boundActivityDeclaration,
  mergeActivityAnswers,
} from '../../../src/lib/trade-activity-form-flow';

const ENDPOINT = '/api/trade-activity-forms';
const CACHE_KEY_PREFIX = 'activity-form:';
const MAX_ACTIVITY_IMAGE_UPLOAD_BYTES = 1024 * 1024;
const ACTIVITY_IMAGE_UPLOAD_VERSION = 1;
const ACTIVITY_IMAGE_UPLOAD_DIRECTORY = new Directory(Paths.document, 'activity-image-uploads');
const ACTIVITY_IMAGE_UPLOAD_ATTEMPTS = [
  [2560, 0.8],
  [2200, 0.75],
  [1920, 0.7],
  [1600, 0.65],
  [1280, 0.55],
] as const;

class ActivityCompletionAttentionError extends Error {
  constructor(message: string, public readonly fieldKey = '') {
    super(message);
  }
}

type PresentedActivityRecord = Omit<ActivityRecord, 'evidence'> & {
  evidence: Omit<ActivityRecord['evidence'][number], 'objectKey'>[];
  missing: { key: string; label: string; kind: string }[];
  signingScopes?: { before: string; after: string };
};

type CaptureMetadata = {
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  metadataOrigin: 'device_capture' | 'file_upload';
  locationObservedAt?: string;
  mocked?: boolean | null;
};

type PendingFile = {
  id: string;
  fieldKey: string;
  uri: string;
  name: string;
  contentType: string;
  metadata: CaptureMetadata;
  preparedUploadUri?: string;
  preparedUploadVersion?: number;
};

type PendingSignature = {
  declarationKey: string;
  declarationText: string;
  phase: 'before' | 'after';
  role: 'customer' | 'technician' | 'other';
  signerName: string;
  strokes: FieldWorkPackSignatureDraft['strokes'];
};

type ActivityFormCache = {
  record: PresentedActivityRecord;
  answers: ActivityAnswers;
  pending: PendingFile[];
  pendingSignatures?: PendingSignature[];
  stepKey: string;
  camera?: { fieldKey: string; metadata: CaptureMetadata };
  finishRequested?: boolean;
  finishError?: string;
  imageUploadRepairVersion?: number;
};

const activeCacheWorkers = new Map<string, Promise<void>>();

export function activitySignatureStrokesAreValid(strokes: FieldWorkPackSignatureDraft['strokes']) {
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > 32) return false;
  let points = 0;
  let distance = 0;
  for (const stroke of strokes) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return false;
    points += stroke.points.length;
    for (let index = 0; index < stroke.points.length; index += 1) {
      const point = stroke.points[index];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
      if (index > 0) {
        const previous = stroke.points[index - 1];
        distance += Math.hypot(point.x - previous.x, point.y - previous.y);
      }
    }
  }
  return points >= 3 && points <= 1_024 && distance >= 0.1;
}

function activityFormCache(value: string): ActivityFormCache | null {
  try {
    const parsed = JSON.parse(value) as Partial<ActivityFormCache>;
    if (!parsed || typeof parsed !== 'object' || !parsed.record || typeof parsed.record.id !== 'string'
      || !parsed.answers || typeof parsed.answers !== 'object' || !Array.isArray(parsed.pending)
      || (parsed.pendingSignatures !== undefined && !Array.isArray(parsed.pendingSignatures))) return null;
    return parsed as ActivityFormCache;
  } catch {
    return null;
  }
}

async function readCache(cacheKey: string) {
  return activityFormCache(await getSetting(cacheKey));
}

async function remember(cacheKey: string, cache: ActivityFormCache) {
  await setSetting(cacheKey, JSON.stringify(cache));
  return cache;
}

function derivedAnswerKeys(record: PresentedActivityRecord) {
  return new Set(record.form.fields.filter((field) => field.presentation === 'derived').map((field) => field.key));
}

export function sanitiseActivityAnswers(form: PresentedActivityRecord['form'], answers: ActivityAnswers) {
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  const clean: ActivityAnswers = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!key.startsWith('$repeat.')) continue;
    const group = key.slice('$repeat.'.length);
    if (form.fields.some((field) => field.repeatGroup === group)
      && typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20) {
      clean[key] = value;
    }
  }
  for (const [key, value] of Object.entries(answers)) {
    if (key.startsWith('$repeat.')) continue;
    const baseKey = activityBaseFieldKey(key);
    const field = fields.get(baseKey);
    if (!field || ['photo', 'document'].includes(field.type)) continue;
    if (key !== baseKey) {
      const repeatIndex = Number(key.match(/\[(\d+)\]$/)?.[1]);
      if (!field.repeatGroup || !Number.isInteger(repeatIndex)
        || repeatIndex >= activityRepeatCount(form, clean, field.repeatGroup)) continue;
    }
    if (value === '' || value === null || value === undefined) continue;
    if (field.type === 'boolean') {
      if (typeof value === 'boolean') clean[key] = value;
      continue;
    }
    if (field.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12) clean[key] = value;
      continue;
    }
    if (typeof value !== 'string' || value.length > 10_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) continue;
    const normalised = value.trim();
    if (!normalised) continue;
    if (field.type === 'select' && !field.options.includes(normalised)) continue;
    if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(normalised)
      || !Number.isFinite(Date.parse(normalised))
      || new Date(normalised).toISOString().slice(0, 10) !== normalised)) continue;
    clean[key] = normalised;
  }
  return clean;
}

function reconcilePendingSignatures(
  pending: readonly PendingSignature[] | undefined,
  fresh: PresentedActivityRecord,
  answers: ActivityAnswers,
) {
  const activeDeclarations = new Set(activityWizardPages(fresh.form, answers)
    .flatMap((page) => page.kind === 'signature' ? [page.declaration.key] : []));
  return (pending || []).filter((signature) => {
    const declaration = fresh.form.declarations.find((item) => item.key === signature.declarationKey);
    return declaration && activeDeclarations.has(declaration.key)
      && boundActivityDeclaration(declaration, answers) === signature.declarationText;
  });
}

function reconcileAnswers(base: ActivityAnswers, local: ActivityAnswers, fresh: PresentedActivityRecord) {
  const reconciled = mergeActivityAnswers(base, local, fresh.answers, derivedAnswerKeys(fresh));
  return { ...reconciled, merged: sanitiseActivityAnswers(fresh.form, reconciled.merged) };
}

function signingUserContentChanged(previous: PresentedActivityRecord, fresh: PresentedActivityRecord, phase: 'before' | 'after') {
  if (previous.formSha256 !== fresh.formSha256) return true;
  const fields = previous.form.fields.filter((field) => field.presentation !== 'derived'
    && (phase === 'after' || field.phase === 'before'));
  const keys = new Set(fields.map((field) => field.key));
  const repeatGroups = new Set(fields.map((field) => field.repeatGroup).filter(Boolean));
  const answers = (record: PresentedActivityRecord) => Object.fromEntries(Object.entries(record.answers)
    .filter(([key]) => keys.has(activityBaseFieldKey(key)) || (key.startsWith('$repeat.') && repeatGroups.has(key.slice('$repeat.'.length)))));
  const evidence = (record: PresentedActivityRecord) => record.evidence.filter((item) => keys.has(activityBaseFieldKey(item.fieldKey)))
    .map((item) => ({ id: item.id, fieldKey: item.fieldKey, sha256: item.sha256 })).sort((a, b) => a.id.localeCompare(b.id));
  const beforeSignatures = (record: PresentedActivityRecord) => phase === 'after' ? record.signatures.filter((item) => item.phase === 'before')
    .map((item) => ({ id: item.id, declarationSha256: item.declarationSha256, scopeSha256: item.scopeSha256 })).sort((a, b) => a.id.localeCompare(b.id)) : [];
  return JSON.stringify(answers(previous)) !== JSON.stringify(answers(fresh))
    || JSON.stringify(evidence(previous)) !== JSON.stringify(evidence(fresh))
    || JSON.stringify(beforeSignatures(previous)) !== JSON.stringify(beforeSignatures(fresh));
}

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

async function latestRecord(recordId: string) {
  const response = await apiRequest<{ record: PresentedActivityRecord }>(
    `${ENDPOINT}?recordId=${encodeURIComponent(recordId)}`,
  );
  return response.record;
}

async function acceptResponse(
  cacheKey: string,
  snapshot: ActivityFormCache,
  nextRecord: PresentedActivityRecord,
  patch: Partial<ActivityFormCache> = {},
) {
  const stored = await readCache(cacheKey);
  const current = stored?.record.id === snapshot.record.id ? stored : snapshot;
  const answers = nextRecord.status === 'submitted_for_creditex_review'
    ? nextRecord.answers
    : sanitiseActivityAnswers(nextRecord.form,
      mergeActivityAnswers(snapshot.answers, current.answers, nextRecord.answers, derivedAnswerKeys(nextRecord)).merged);
  const next = { ...current, ...patch, record: nextRecord, answers };
  return remember(cacheKey, {
    ...next,
    pendingSignatures: reconcilePendingSignatures(next.pendingSignatures, nextRecord, answers),
  });
}

async function refresh(cacheKey: string, snapshot: ActivityFormCache) {
  const fresh = await latestRecord(snapshot.record.id);
  const stored = await readCache(cacheKey);
  const current = stored?.record.id === snapshot.record.id ? stored : snapshot;
  const answers = fresh.status === 'submitted_for_creditex_review'
    ? fresh.answers
    : reconcileAnswers(snapshot.record.answers, current.answers, fresh).merged;
  return remember(cacheKey, {
    ...current,
    record: fresh,
    answers,
    pendingSignatures: reconcilePendingSignatures(current.pendingSignatures, fresh, answers),
  });
}

async function saveAnswers(cacheKey: string, snapshot: ActivityFormCache) {
  let latest = snapshot;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (latest.record.status === 'submitted_for_creditex_review'
      || JSON.stringify(latest.answers) === JSON.stringify(latest.record.answers)) return latest;
    try {
      const response = await apiRequest<{ record: PresentedActivityRecord }>(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          recordId: latest.record.id,
          expectedRevision: latest.record.revision,
          answers: latest.answers,
          baseAnswers: latest.record.answers,
        }),
      });
      return acceptResponse(cacheKey, latest, response.record);
    } catch (caught) {
      if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_REVISION_CONFLICT' || attempt === 2) throw caught;
      latest = await refresh(cacheKey, latest);
    }
  }
  return latest;
}

export function boundedActivityImageResize(width: number, height: number, maxDimension = 2560) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || maxDimension < 1) {
    throw new Error('This photo size could not be read. The original remains on this phone.');
  }
  if (Math.max(width, height) <= maxDimension) return null;
  return width >= height ? { width: maxDimension } : { height: maxDimension };
}

function preparedActivityImageFile(pending: PendingFile) {
  const safeId = pending.id.replace(/[^0-9a-z_-]/gi, '').slice(0, 80);
  if (!safeId) throw new Error('This saved photo has an invalid upload identity. The original remains on this phone.');
  return new File(ACTIVITY_IMAGE_UPLOAD_DIRECTORY, `${safeId}.v${ACTIVITY_IMAGE_UPLOAD_VERSION}.jpg`);
}

function validPreparedActivityImage(file: File) {
  return file.exists && file.size >= 5 && file.size <= MAX_ACTIVITY_IMAGE_UPLOAD_BYTES;
}

async function rememberPreparedActivityImage(
  cacheKey: string,
  snapshot: ActivityFormCache,
  pending: PendingFile,
  prepared: File,
) {
  const stored = await readCache(cacheKey);
  const current = stored?.record.id === snapshot.record.id ? stored : snapshot;
  if (!current.pending.some((item) => item.id === pending.id)) {
    throw new Error('This pending photo is no longer attached to the form.');
  }
  const next = await remember(cacheKey, {
    ...current,
    pending: current.pending.map((item) => item.id === pending.id ? {
      ...item,
      preparedUploadUri: prepared.uri,
      preparedUploadVersion: ACTIVITY_IMAGE_UPLOAD_VERSION,
    } : item),
  });
  return {
    cache: next,
    pending: next.pending.find((item) => item.id === pending.id) || pending,
    file: prepared,
  };
}

async function prepareActivityImageUpload(cacheKey: string, snapshot: ActivityFormCache, pending: PendingFile) {
  if (pending.preparedUploadVersion === ACTIVITY_IMAGE_UPLOAD_VERSION && pending.preparedUploadUri) {
    const retained = new File(pending.preparedUploadUri);
    if (validPreparedActivityImage(retained)) return { cache: snapshot, pending, file: retained };
    if (retained.exists) retained.delete();
  }

  const target = preparedActivityImageFile(pending);
  if (validPreparedActivityImage(target)) {
    return rememberPreparedActivityImage(cacheKey, snapshot, pending, target);
  }
  if (target.exists) target.delete();
  if (!ACTIVITY_IMAGE_UPLOAD_DIRECTORY.exists) {
    ACTIVITY_IMAGE_UPLOAD_DIRECTORY.create({ intermediates: true, idempotent: true });
  }

  const dimensions = await Image.getSize(pending.uri);
  for (const [maxDimension, compress] of ACTIVITY_IMAGE_UPLOAD_ATTEMPTS) {
    const context = ImageManipulator.manipulate(pending.uri);
    const resize = boundedActivityImageResize(dimensions.width, dimensions.height, maxDimension);
    if (resize) context.resize(resize);
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
    const candidate = new File(result.uri);
    try {
      if (!validPreparedActivityImage(candidate)) continue;
      await candidate.copy(target, { overwrite: true });
      if (!validPreparedActivityImage(target)) throw new Error('The prepared photo could not be retained.');
      return rememberPreparedActivityImage(cacheKey, snapshot, pending, target);
    } finally {
      if (candidate.exists) candidate.delete();
    }
  }
  throw new Error('This photo could not be prepared for upload. The original remains on this phone.');
}

function assertCaptureMetadata(pending: PendingFile) {
  if (pending.metadata.metadataOrigin !== 'device_capture') return;
  if (!pending.metadata.capturedAt || !pending.metadata.locationObservedAt
    || !Number.isFinite(Date.parse(pending.metadata.capturedAt))
    || Math.abs(Date.parse(pending.metadata.capturedAt) - Date.parse(pending.metadata.locationObservedAt)) > 120000) {
    throw new Error('This photo has no current capture-location match. Its original remains on this phone. Remove it and retake it with location enabled.');
  }
}

function pendingFileIsImage(pending: PendingFile) {
  if (pending.contentType.toLowerCase().startsWith('image/')) return true;
  if (pending.contentType && pending.contentType.toLowerCase() !== 'application/octet-stream') return false;
  const name = `${pending.name} ${pending.uri.split(/[?#]/, 1)[0]}`;
  return /\.(?:jpe?g|png)\b/i.test(name);
}

function shouldRetryLegacyFailedImageUpload(cache: ActivityFormCache) {
  return cache.finishRequested !== true
    && Boolean(cache.finishError)
    && (cache.imageUploadRepairVersion || 0) < ACTIVITY_IMAGE_UPLOAD_VERSION
    && cache.pending.some(pendingFileIsImage);
}

async function removeReceivedPendingFile(
  cacheKey: string,
  snapshot: ActivityFormCache,
  pending: PendingFile,
  record: PresentedActivityRecord,
) {
  const existing = record.evidence.find((item) => item.id === pending.id);
  if (!existing || existing.fieldKey !== pending.fieldKey) {
    throw new Error('The saved upload identity no longer matches this activity field. The original remains on this phone.');
  }
  const accepted = await acceptResponse(cacheKey, snapshot, record, {
    pending: (await readCache(cacheKey) || snapshot).pending.filter((item) => item.id !== pending.id),
  });
  const original = new File(pending.uri);
  if (original.exists) original.delete();
  if (pending.preparedUploadUri && pending.preparedUploadUri !== pending.uri) {
    const prepared = new File(pending.preparedUploadUri);
    if (prepared.exists) prepared.delete();
  }
  return accepted;
}

async function uploadPendingFile(cacheKey: string, snapshot: ActivityFormCache, queued: PendingFile) {
  let latest = snapshot;
  let pending = queued;
  const received = latest.record.evidence.find((item) => item.id === pending.id);
  if (received) return removeReceivedPendingFile(cacheKey, latest, pending, latest.record);

  assertCaptureMetadata(pending);
  const originalFile = new File(pending.uri);
  if (!originalFile.exists || originalFile.size < 5) {
    throw new Error('This saved original is unavailable. Remove it and take the photo again.');
  }

  let uploadFile = originalFile;
  if (pendingFileIsImage(pending)) {
    const prepared = await prepareActivityImageUpload(cacheKey, latest, pending);
    latest = prepared.cache;
    pending = prepared.pending;
    uploadFile = prepared.file;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const form = new FormData();
    form.append('action', 'upload');
    form.append('recordId', latest.record.id);
    form.append('expectedRevision', String(latest.record.revision));
    form.append('fieldKey', pending.fieldKey);
    form.append('captureMetadata', JSON.stringify(pending.metadata));
    form.append('clientUploadId', pending.id);
    form.append('file', uploadFile);
    try {
      const response = await apiRequest<{ record: PresentedActivityRecord }>(ENDPOINT, { method: 'POST', body: form });
      return removeReceivedPendingFile(cacheKey, latest, pending, response.record);
    } catch (caught) {
      let fresh: PresentedActivityRecord | null = null;
      try { fresh = await latestRecord(latest.record.id); } catch { /* Preserve the original upload failure. */ }
      if (fresh?.evidence.some((item) => item.id === pending.id)) {
        return removeReceivedPendingFile(cacheKey, latest, pending, fresh);
      }
      if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_REVISION_CONFLICT' || !fresh || attempt === 2) throw caught;
      latest = await acceptResponse(cacheKey, latest, fresh);
    }
  }
  return latest;
}

async function syncPendingSignatures(cacheKey: string, snapshot: ActivityFormCache) {
  let latest = snapshot;
  while (true) {
    const requiredBeforeDeclarationKeys = new Set(activityWizardPages(latest.record.form, latest.answers)
      .flatMap((page) => page.kind === 'signature' && page.declaration.phase === 'before' && page.declaration.required
        ? [page.declaration.key] : []));
    const serverSignatureKeys = activityCurrentSignatureKeys(latest.record.signatures, latest.record.missing);
    const queued = pendingSignatureToSync(latest.pendingSignatures || [], requiredBeforeDeclarationKeys, serverSignatureKeys);
    if (!queued) return latest;
    const declaration = latest.record.form.declarations.find((item) => item.key === queued.declarationKey);
    if (!declaration) throw new Error('This declaration changed. Open its signature section and sign it again.');
    if (serverSignatureKeys.has(queued.declarationKey)) {
      latest = await remember(cacheKey, {
        ...latest,
        pendingSignatures: (latest.pendingSignatures || []).filter((item) => item.declarationKey !== queued.declarationKey),
      });
      continue;
    }
    if (boundActivityDeclaration(declaration, latest.answers) !== queued.declarationText) {
      throw new Error('This declaration changed. Open its signature section and sign it again.');
    }
    if (!activitySignatureStrokesAreValid(queued.strokes)) {
      latest = await remember(cacheKey, {
        ...latest,
        pendingSignatures: (latest.pendingSignatures || []).filter((item) => item.declarationKey !== queued.declarationKey),
      });
      throw new ActivityCompletionAttentionError(
        'Open the signature section and draw the signature again. Make the signature span more of the box.',
        queued.declarationKey,
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await apiRequest<{ record: PresentedActivityRecord }>(ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({
            action: 'sign',
            recordId: latest.record.id,
            expectedRevision: latest.record.revision,
            declarationKey: queued.declarationKey,
            signerName: queued.role === 'technician' ? latest.record.signerDefaults.technician : queued.signerName,
            strokes: queued.strokes,
            acknowledged: true,
            ...(latest.record.signingScopes?.[queued.phase]
              ? { expectedScope: latest.record.signingScopes[queued.phase] }
              : {}),
          }),
        });
        latest = await acceptResponse(cacheKey, latest, response.record, {
          pendingSignatures: (latest.pendingSignatures || []).filter((item) => item.declarationKey !== queued.declarationKey),
        });
        break;
      } catch (caught) {
        let fresh: PresentedActivityRecord | null = null;
        try { fresh = await latestRecord(latest.record.id); } catch { /* Preserve the original signing failure. */ }
        if (fresh) {
          const currentSignatureKeys = activityCurrentSignatureKeys(fresh.signatures, fresh.missing);
          if (currentSignatureKeys.has(queued.declarationKey)) {
            latest = await acceptResponse(cacheKey, latest, fresh, {
              pendingSignatures: (latest.pendingSignatures || []).filter((item) => item.declarationKey !== queued.declarationKey),
            });
            break;
          }
        }
        if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_SIGNING_SCOPE_CHANGED' || !fresh || attempt === 1) throw caught;
        if (signingUserContentChanged(latest.record, fresh, queued.phase)) throw caught;
        const answers = reconcileAnswers(latest.record.answers, latest.answers, fresh).merged;
        if (boundActivityDeclaration(declaration, answers) !== queued.declarationText) throw caught;
        latest = await acceptResponse(cacheKey, latest, fresh);
      }
    }
  }
}

async function submit(cacheKey: string, snapshot: ActivityFormCache) {
  let latest = snapshot;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (latest.record.status === 'submitted_for_creditex_review') return latest;
    try {
      const response = await apiRequest<{ record: PresentedActivityRecord }>(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ action: 'submit', recordId: latest.record.id, expectedRevision: latest.record.revision }),
      });
      return acceptResponse(cacheKey, latest, response.record);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'ACTIVITY_ALREADY_SUBMITTED') {
        const fresh = await latestRecord(latest.record.id);
        if (fresh.status === 'submitted_for_creditex_review') return acceptResponse(cacheKey, latest, fresh);
      }
      if (!(caught instanceof ApiError) || caught.code !== 'ACTIVITY_REVISION_CONFLICT' || attempt === 2) throw caught;
      latest = await refresh(cacheKey, latest);
      if (latest.record.status === 'submitted_for_creditex_review') return latest;
      latest = await saveAnswers(cacheKey, latest);
    }
  }
  return latest;
}

function completionFailureNeedsAttention(caught: unknown) {
  if (caught instanceof ActivityCompletionAttentionError) return true;
  if (!(caught instanceof ApiError)) return false;
  return caught.code.startsWith('INVALID_ACTIVITY_') || [
    'ACTIVITY_APPROVED_PRODUCT_REQUIRED',
    'ACTIVITY_DECLARATION_DETAILS_REQUIRED',
    'ACTIVITY_DECLARATION_INVALID',
    'ACTIVITY_FORM_INCOMPLETE',
    'ACTIVITY_SIGNATURE_REQUIRED',
    'ACTIVITY_SIGNING_NOT_READY',
    'ACTIVITY_SIGNING_PROFILE_CHANGED',
    'ACTIVITY_SIGNING_PROFILE_NAME_REQUIRED',
    'ACTIVITY_TECHNICIAN_IDENTITY_REQUIRED',
    'ACTIVITY_TECHNICIAN_SIGNER_NOT_ASSIGNED',
  ].includes(caught.code);
}

function completionFailureStep(cache: ActivityFormCache, caught: unknown) {
  const fieldKey = caught instanceof ActivityCompletionAttentionError
    ? caught.fieldKey
    : caught instanceof ApiError && typeof caught.payload.fieldKey === 'string' ? caught.payload.fieldKey : '';
  const requested = fieldKey || cache.record.missing[0]?.key || '';
  if (!requested) return cache.stepKey;
  const pages = activityWizardPages(cache.record.form, cache.answers);
  return activityWizardPageForStepKey(pages, requested)?.key || cache.stepKey;
}

function completionFailureMessage(cache: ActivityFormCache, caught: unknown) {
  const fieldKey = caught instanceof ApiError && typeof caught.payload.fieldKey === 'string'
    ? caught.payload.fieldKey : '';
  const missing = cache.record.missing.find((item) => item.key === fieldKey) || cache.record.missing[0];
  if (caught instanceof ApiError && caught.code === 'ACTIVITY_FORM_INCOMPLETE' && missing) {
    return `Complete ${missing.label.toLowerCase()}, then tap Done once.`;
  }
  return caught instanceof Error ? caught.message : 'TLink will retry this form automatically.';
}

async function completeCache(cacheKey: string) {
  let cache = await readCache(cacheKey);
  if (!cache || (!cache.finishRequested && !shouldRetryLegacyFailedImageUpload(cache))) return;
  if ((cache.imageUploadRepairVersion || 0) < ACTIVITY_IMAGE_UPLOAD_VERSION) {
    cache = await remember(cacheKey, {
      ...cache,
      finishRequested: true,
      imageUploadRepairVersion: ACTIVITY_IMAGE_UPLOAD_VERSION,
    });
  }
  try {
    cache = await refresh(cacheKey, cache);
    if (cache.record.status === 'submitted_for_creditex_review') {
      await remember(cacheKey, { ...cache, finishRequested: false, finishError: '' });
      return;
    }
    cache = await saveAnswers(cacheKey, cache);
    for (const pending of [...cache.pending]) {
      cache = await uploadPendingFile(cacheKey, cache, pending);
    }
    cache = await syncPendingSignatures(cacheKey, cache);
    cache = await submit(cacheKey, cache);
    if (cache.record.status !== 'submitted_for_creditex_review') {
      throw new Error('Creditex did not confirm the completed form. TLink will retry it automatically.');
    }
    await remember(cacheKey, { ...cache, finishRequested: false, finishError: '' });
  } catch (caught) {
    const retained = await readCache(cacheKey);
    if (retained?.finishRequested) {
      const needsAttention = completionFailureNeedsAttention(caught);
      await remember(cacheKey, {
        ...retained,
        finishRequested: !needsAttention,
        finishError: completionFailureMessage(retained, caught),
        stepKey: needsAttention ? completionFailureStep(retained, caught) : retained.stepKey,
      });
    }
  }
}

/**
 * Completes one retained activity form, or every retained form when called by
 * the normal/background sync loop. Per-cache workers share one promise so a
 * foreground reconnect and an OS background task cannot submit the same form
 * concurrently in this process.
 */
export async function processActivityFormCompletionQueue(cacheKey?: string) {
  const keys = cacheKey
    ? [cacheKey]
    : (await listActivityFormCacheSettings()).flatMap((row) => {
      const cache = activityFormCache(row.value);
      return cache && (cache.finishRequested || shouldRetryLegacyFailedImageUpload(cache)) ? [row.key] : [];
    });
  for (const key of [...new Set(keys)]) {
    if (!key.startsWith(CACHE_KEY_PREFIX)) continue;
    const existing = activeCacheWorkers.get(key);
    if (existing) {
      await existing;
      continue;
    }
    const worker = completeCache(key).finally(() => activeCacheWorkers.delete(key));
    activeCacheWorkers.set(key, worker);
    await worker;
  }
}
