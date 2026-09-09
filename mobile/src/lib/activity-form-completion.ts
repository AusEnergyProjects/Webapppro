import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { activityCurrentSignatureKeys } from '@/lib/activity-field-wizard';
import { ApiError, apiRequest } from '@/lib/api';
import { getSetting, listActivityFormCacheSettings, setSetting } from '@/lib/database';
import type { FieldWorkPackSignatureDraft } from '@/lib/types';
import type { ActivityAnswers, ActivityRecord } from '../../../src/lib/trade-activity-form-types';
import {
  activityBaseFieldKey,
  activityWizardPages,
  boundActivityDeclaration,
  mergeActivityAnswers,
} from '../../../src/lib/trade-activity-form-flow';

const ENDPOINT = '/api/trade-activity-forms';
const CACHE_KEY_PREFIX = 'activity-form:';
const MAX_PREVIEW_BYTES = 1024 * 1024;

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
};

const activeCacheWorkers = new Map<string, Promise<void>>();

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

function reconcileAnswers(base: ActivityAnswers, local: ActivityAnswers, fresh: PresentedActivityRecord) {
  return mergeActivityAnswers(base, local, fresh.answers, derivedAnswerKeys(fresh));
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
    : mergeActivityAnswers(snapshot.answers, current.answers, nextRecord.answers, derivedAnswerKeys(nextRecord)).merged;
  return remember(cacheKey, { ...current, ...patch, record: nextRecord, answers });
}

async function refresh(cacheKey: string, snapshot: ActivityFormCache) {
  const fresh = await latestRecord(snapshot.record.id);
  const stored = await readCache(cacheKey);
  const current = stored?.record.id === snapshot.record.id ? stored : snapshot;
  const answers = fresh.status === 'submitted_for_creditex_review'
    ? fresh.answers
    : reconcileAnswers(snapshot.record.answers, current.answers, fresh).merged;
  return remember(cacheKey, { ...current, record: fresh, answers });
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

async function generatedPreview(uri: string) {
  for (const [width, compress] of [[1600, 0.75], [1280, 0.65], [1024, 0.55]] as const) {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width });
    const rendered = await context.renderAsync();
    const preview = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
    const previewFile = new File(preview.uri);
    if (previewFile.size <= MAX_PREVIEW_BYTES) return preview.uri;
    if (previewFile.exists) previewFile.delete();
  }
  throw new Error('A report preview could not be prepared within its size limit. The original stays on this phone.');
}

function assertCaptureMetadata(pending: PendingFile) {
  if (pending.metadata.metadataOrigin !== 'device_capture') return;
  if (!pending.metadata.capturedAt || !pending.metadata.locationObservedAt
    || !Number.isFinite(Date.parse(pending.metadata.capturedAt))
    || Math.abs(Date.parse(pending.metadata.capturedAt) - Date.parse(pending.metadata.locationObservedAt)) > 120000) {
    throw new Error('This photo has no current capture-location match. Its original remains on this phone. Remove it and retake it with location enabled.');
  }
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
  return accepted;
}

async function uploadPendingFile(cacheKey: string, snapshot: ActivityFormCache, pending: PendingFile) {
  let latest = snapshot;
  const received = latest.record.evidence.find((item) => item.id === pending.id);
  if (received) return removeReceivedPendingFile(cacheKey, latest, pending, latest.record);

  assertCaptureMetadata(pending);
  const originalFile = new File(pending.uri);
  if (!originalFile.exists || originalFile.size < 5) {
    throw new Error('This saved original is unavailable. Remove it and take the photo again.');
  }

  let previewUri = '';
  try {
    if (pending.contentType.startsWith('image/')) previewUri = await generatedPreview(pending.uri);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const form = new FormData();
      form.append('action', 'upload');
      form.append('recordId', latest.record.id);
      form.append('expectedRevision', String(latest.record.revision));
      form.append('fieldKey', pending.fieldKey);
      form.append('captureMetadata', JSON.stringify(pending.metadata));
      form.append('clientUploadId', pending.id);
      form.append('file', originalFile);
      if (previewUri) form.append('preview', new File(previewUri));
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
  } finally {
    if (previewUri) {
      const previewFile = new File(previewUri);
      if (previewFile.exists) previewFile.delete();
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

async function completeCache(cacheKey: string) {
  let cache = await readCache(cacheKey);
  if (!cache?.finishRequested) return;
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
      await remember(cacheKey, {
        ...retained,
        finishRequested: true,
        finishError: caught instanceof Error ? caught.message : 'TLink will retry this form automatically.',
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
    : (await listActivityFormCacheSettings()).flatMap((row) => activityFormCache(row.value)?.finishRequested ? [row.key] : []);
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
