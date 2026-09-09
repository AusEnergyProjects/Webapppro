import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { ApiError, apiRequest } from '@/lib/api';
import { firebaseAuth } from '@/lib/auth';
import { assertLocalDataOwner, getLocalDataOwner, readRentalSetting, rentalQueueSettings,
  subscribeLocalDataOwner, writeRentalSetting, type LocalDataOwner } from '@/lib/database';
import { captureSessionId, type observeLocation, type observedTime } from '@/lib/evidence';
import { getFieldPrincipal } from '@/lib/field-session';
import { RENTAL_ADVERSE_OUTCOMES, type RentalAssessmentFinding, type RentalAssessmentItem,
  type RentalAssessmentModule, type RentalAssessmentResult } from '@/lib/rental-inspection';

const ENDPOINT = '/api/trade-rental-inspections';
const PREFIX = 'rental-save:';
const PHOTO_DIRECTORY = new Directory(Paths.document, 'rental-save-photos');
// Fifty new photos remain below 25 MiB, leaving room within the existing 32 MiB report limit.
const MAX_RENTAL_PHOTO_BYTES = 500 * 1024;
const RENTAL_IMAGE_ATTEMPTS = [[1600, 0.68], [1600, 0.56], [1400, 0.64], [1200, 0.64], [1000, 0.60]] as const;

export type RentalQueuedPhoto = {
  uri: string; width: number; height: number;
  capture: ReturnType<typeof observedTime>;
  location: Awaited<ReturnType<typeof observeLocation>> | null;
  mediaId?: string;
  clientUploadId?: string;
  captureSessionId?: string;
  prepared?: { uri: string; name: string; envelope: string; size: number };
};
type PhotoCheckpoint = RentalQueuedPhoto & {
  clientUploadId: string;
  captureSessionId: string;
  prepared?: { uri: string; name: string; envelope: string; size: number };
  linked?: boolean;
};
export type RentalSaveInput = {
  workOrderId: string;
  body: Record<string, unknown>;
  module: RentalAssessmentModule;
  baseItem?: RentalAssessmentItem | null;
  baseFinding?: RentalAssessmentFinding | null;
  draftKey: string;
  draftSnapshot: unknown;
  photos?: RentalQueuedPhoto[];
  purpose?: string;
};
export type RentalSaveRecord = Omit<RentalSaveInput, 'photos'> & {
  schemaVersion: 1;
  id: string;
  ownerKey: string;
  createdAt: number;
  status: 'queued' | 'syncing' | 'retry' | 'conflict' | 'succeeded';
  error: string;
  photos: PhotoCheckpoint[];
  savedItem?: RentalAssessmentItem;
  savedFinding?: RentalAssessmentFinding | null;
  answerSaved?: boolean;
};
export type RentalSaveState = {
  records: RentalSaveRecord[];
  pending: number;
  conflicts: number;
  result: RentalAssessmentResult | null;
};

export class RentalSaveQueueError extends Error {
  constructor(message: string, public readonly code: string) { super(message); }
}

const listeners = new Map<string, Set<() => void>>();
const localGates = new Map<string, Promise<unknown>>();
const jobGates = new Map<string, Promise<unknown>>();
const imagePreparationGate = new Map<string, Promise<unknown>>();
const workers = new Map<string, Promise<void>>();
const finalizing = new Set<string>();
const requests = new Set<AbortController>();

subscribeLocalDataOwner(() => {
  for (const controller of requests) controller.abort();
  for (const subscribers of listeners.values()) for (const listener of subscribers) listener();
});

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function jobKey(owner: LocalDataOwner, workOrderId: string) { return `${owner.epoch}:${owner.key}:${workOrderId}`; }
function resultKey(owner: LocalDataOwner, workOrderId: string) { return `rental-result:${encodeURIComponent(owner.key)}:${workOrderId}`; }
function recordKey(record: RentalSaveRecord) { return `${PREFIX}${encodeURIComponent(record.ownerKey)}:${record.id}`; }

async function serial<T>(gates: Map<string, Promise<unknown>>, key: string, task: () => Promise<T>): Promise<T> {
  const previous = gates.get(key) || Promise.resolve();
  const running = previous.catch(() => undefined).then(task);
  gates.set(key, running);
  try { return await running; }
  finally { if (gates.get(key) === running) gates.delete(key); }
}

async function ownerNow() {
  const owner = await getLocalDataOwner();
  await checkOwner(owner);
  return owner;
}

async function checkOwner(owner: LocalDataOwner) {
  assertLocalDataOwner(owner);
  const principal = await getFieldPrincipal();
  assertLocalDataOwner(owner);
  const current = principal?.localOwnerKey || (firebaseAuth.currentUser ? `firebase:${firebaseAuth.currentUser.uid}` : '');
  if (!current || current !== owner.key) throw new RentalSaveQueueError('The signed-in account changed. Your save has stopped.', 'RENTAL_OWNER_CHANGED');
}

function emit(workOrderId: string) {
  for (const listener of listeners.get(workOrderId) || []) listener();
}

export function subscribeRentalSaves(workOrderId: string, listener: () => void) {
  const subscribers = listeners.get(workOrderId) || new Set<() => void>();
  subscribers.add(listener);
  listeners.set(workOrderId, subscribers);
  return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(workOrderId); };
}

async function recordsFor(owner: LocalDataOwner, workOrderId?: string): Promise<RentalSaveRecord[]> {
  const rows = await rentalQueueSettings(owner);
  return rows.map(({ value }) => {
    const record = JSON.parse(value) as RentalSaveRecord;
    if (record.schemaVersion !== 1 || !record.id || !record.workOrderId || !record.draftKey || !record.ownerKey || !Array.isArray(record.photos)) {
      throw new RentalSaveQueueError('A saved rental answer could not be read. Keep this device and contact support.', 'RENTAL_QUEUE_INVALID');
    }
    return record;
  }).filter((record) => record.ownerKey === owner.key && (!workOrderId || record.workOrderId === workOrderId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

async function persist(owner: LocalDataOwner, record: RentalSaveRecord) {
  await checkOwner(owner);
  await writeRentalSetting(owner, recordKey(record), JSON.stringify(record));
  emit(record.workOrderId);
}

async function cachedResult(owner: LocalDataOwner, workOrderId: string) {
  const raw = await readRentalSetting(owner, resultKey(owner, workOrderId));
  return raw ? JSON.parse(raw) as RentalAssessmentResult : null;
}

async function cacheResult(owner: LocalDataOwner, workOrderId: string, result: RentalAssessmentResult) {
  if (!result.inspection) return;
  await serial(localGates, jobKey(owner, workOrderId), async () => {
    await checkOwner(owner);
    const previous = await cachedResult(owner, workOrderId);
    if (previous?.inspection && previous.inspection.id === result.inspection!.id
      && previous.inspection.revision > result.inspection!.revision) return;
    await writeRentalSetting(owner, resultKey(owner, workOrderId), JSON.stringify(result));
  });
  emit(workOrderId);
}

export async function cacheRentalResult(workOrderId: string, result: RentalAssessmentResult) {
  const snapshot = copy(result);
  const owner = await ownerNow();
  await cacheResult(owner, workOrderId, snapshot);
}

export async function loadRentalResult(workOrderId: string) {
  const owner = await ownerNow();
  const result = await request(owner, workOrderId);
  const latest = await cachedResult(owner, workOrderId);
  await checkOwner(owner);
  return latest || result;
}

export async function getRentalSaveState(workOrderId: string): Promise<RentalSaveState> {
  const owner = await ownerNow();
  const records = await recordsFor(owner, workOrderId);
  const result = await cachedResult(owner, workOrderId);
  await checkOwner(owner);
  return { records, result, pending: records.filter((r) => r.status !== 'succeeded').length,
    conflicts: records.filter((r) => r.status === 'conflict').length };
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && equal(left[key], right[key]));
}

export async function enqueueRentalSave(input: RentalSaveInput): Promise<RentalSaveRecord> {
  // Capture before the first await. Later UI edits cannot change queued answers, photos or their identities.
  const snapshot = copy(input);
  if (!snapshot.workOrderId || !snapshot.draftKey || !snapshot.module?.id || snapshot.body.moduleId !== snapshot.module.id
    || !['save_item', 'save_module_answers'].includes(String(snapshot.body.action))) {
    throw new RentalSaveQueueError('This answer cannot be queued without its assessment identity.', 'RENTAL_SAVE_INVALID');
  }
  if (snapshot.body.action === 'save_module_answers') {
    const fields = Object.keys(object(snapshot.body.answers));
    if (!fields.length || fields.some((key) => !snapshot.module.template.metadataFields.some((field) => field.key === key && field.phase !== 'final' && field.source !== 'team_profile'))) {
      throw new RentalSaveQueueError('Final declarations must be saved after the assessment has synced.', 'RENTAL_FINAL_ANSWERS_REQUIRE_SYNC');
    }
  }
  const owner = await ownerNow();
  const record = await serial(localGates, jobKey(owner, snapshot.workOrderId), async () => {
    await checkOwner(owner);
    if (finalizing.has(jobKey(owner, snapshot.workOrderId))) throw pendingError();
    const existing = await recordsFor(owner, snapshot.workOrderId);
    const pending = existing.find((entry) => entry.draftKey === snapshot.draftKey && entry.status !== 'succeeded');
    if (pending) {
      if (equal(pending.body, snapshot.body) && equal(pending.draftSnapshot, snapshot.draftSnapshot)) return pending;
      throw new RentalSaveQueueError('This answer is already saved on the phone. Let it sync before changing it.', 'RENTAL_ANSWER_PENDING');
    }
    const created: RentalSaveRecord = { ...snapshot, schemaVersion: 1, id: Crypto.randomUUID(), ownerKey: owner.key,
      createdAt: Math.max(Date.now(), ...existing.map((entry) => entry.createdAt + 1)), status: 'queued', error: '',
      photos: (snapshot.photos || []).map((photo) => ({ ...photo, clientUploadId: photo.clientUploadId || Crypto.randomUUID(), captureSessionId: photo.captureSessionId || captureSessionId() })) };
    await persist(owner, created);
    return created;
  });
  void processRentalSaveQueue(snapshot.workOrderId).catch(() => undefined);
  return copy(record);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function conflict(message = 'This answer changed elsewhere. Review the saved answer before retrying.') {
  return new RentalSaveQueueError(message, 'RENTAL_SAVE_CONFLICT');
}
function pendingError() {
  return new RentalSaveQueueError('Answers or photos are still saving. Let them sync before completing or changing this assessment.', 'RENTAL_SAVES_PENDING');
}

async function request(owner: LocalDataOwner, workOrderId: string, body?: Record<string, unknown>) {
  await checkOwner(owner);
  const controller = new AbortController();
  requests.add(controller);
  try {
    const result = await apiRequest<RentalAssessmentResult>(body ? ENDPOINT : `${ENDPOINT}?workOrderId=${encodeURIComponent(workOrderId)}`,
      body ? { method: 'POST', body: JSON.stringify({ ...body, workOrderId }), signal: controller.signal }
        : { signal: controller.signal });
    await checkOwner(owner);
    await cacheResult(owner, workOrderId, result);
    return result;
  } finally { requests.delete(controller); }
}

function currentModule(record: RentalSaveRecord, result: RentalAssessmentResult) {
  const assessmentModule = result.modules?.find((entry) => entry.id === record.module.id);
  if (!assessmentModule || assessmentModule.key !== record.module.key || !equal(assessmentModule.template, record.module.template)) throw conflict('The assessment template changed. Review this locally saved answer before continuing.');
  if (!['draft', 'not_started'].includes(assessmentModule.status)) throw conflict('This assessment is completed or locked. Reopen it before changing this answer.');
  return assessmentModule;
}

function currentItem(record: RentalSaveRecord, result: RentalAssessmentResult) {
  return result.items?.find((item) => item.moduleId === record.module.id && item.sectionKey === record.body.sectionKey
    && item.checkKey === record.body.checkKey && item.instanceKey === record.body.instanceKey);
}

function matchesFields(current: unknown, expected: unknown, keys: string[]) {
  const left = object(current), right = object(expected);
  return keys.every((key) => equal(left[key] ?? '', right[key] ?? ''));
}

function answerMatches(record: RentalSaveRecord, item: RentalAssessmentItem | undefined, finding: RentalAssessmentFinding | undefined) {
  if (!item || !matchesFields(item, record.body, ['locationLabel', 'outcome', 'publicNotes', 'internalNotes', 'sortOrder'])) return false;
  // Credential details are supplied by the server, never inferred by the offline worker.
  const response = { ...object(record.body.response) }, savedResponse = { ...item.response };
  for (const key of ['credentialVerified', 'credentialNumber', 'credentialType']) { delete response[key]; delete savedResponse[key]; }
  if (!equal(response, savedResponse)) return false;
  if (!RENTAL_ADVERSE_OUTCOMES.has(item.outcome)) return !finding || finding.status === 'compliant';
  const desired = object(record.body.finding);
  if (!finding || !matchesFields(finding, desired, ['title', 'description', 'standardReference', 'severity', 'tradeCategory', 'recommendedAction', 'scopeSummary', 'quantityMilli', 'unitLabel', 'internalNotes'])) return false;
  const details = object(desired.details);
  return Object.keys(details).every((key) => equal(finding.details[key], details[key]));
}

async function saveAnswer(owner: LocalDataOwner, record: RentalSaveRecord, result: RentalAssessmentResult) {
  const assessmentModule = currentModule(record, result);
  if (record.body.action === 'save_module_answers') {
    const patch = object(record.body.answers);
    const keys = Object.keys(patch);
    if (!keys.every((key) => equal(assessmentModule.answers[key], patch[key]))) {
      if (keys.some((key) => !equal(assessmentModule.answers[key], record.module.answers[key]) && !equal(assessmentModule.answers[key], patch[key]))) throw conflict('An assessment detail changed elsewhere. Review it before saving.');
      result = await request(owner, record.workOrderId, { ...record.body, answers: { ...assessmentModule.answers, ...patch }, expectedRevision: assessmentModule.revision });
    }
    record.answerSaved = true;
    await persist(owner, record);
    return result;
  }
  let item = currentItem(record, result);
  let finding = result.findings?.find((entry) => entry.itemId === item?.id);
  if (record.answerSaved) {
    if (!item || item.revision !== record.savedItem?.revision || (finding?.revision || 0) !== (record.savedFinding?.revision || 0)) throw conflict();
  } else {
    if (!answerMatches(record, item, finding)) {
      if ((item?.revision || 0) !== (record.baseItem?.revision || 0) || (finding?.revision || 0) !== (record.baseFinding?.revision || 0)
        || (record.baseItem?.id && item?.id !== record.baseItem.id) || (record.baseFinding?.id && finding?.id !== record.baseFinding.id)) throw conflict();
      result = await request(owner, record.workOrderId, { ...record.body, expectedModuleRevision: assessmentModule.revision,
        expectedItemRevision: item?.revision || 0 });
      item = currentItem(record, result);
      finding = result.findings?.find((entry) => entry.itemId === item?.id);
      if (!item) throw new Error('The saved answer was not returned. It remains queued for verification.');
    }
    record.savedItem = item;
    record.savedFinding = finding || null;
    record.answerSaved = true;
    await persist(owner, record);
  }
  return result;
}

async function preparePhoto(owner: LocalDataOwner, record: RentalSaveRecord, photo: PhotoCheckpoint) {
  // Image decoding is memory intensive. Other jobs can upload while one native image is prepared.
  return serial(imagePreparationGate, 'rental-images', () => preparePhotoCheckpoint(owner, record, photo));
}

async function preparePhotoCheckpoint(owner: LocalDataOwner, record: RentalSaveRecord, photo: PhotoCheckpoint) {
  await checkOwner(owner);
  if (photo.prepared) {
    if (!new File(photo.prepared.uri).exists) throw conflict('A prepared photo is missing on this phone. Retake it after reviewing the saved answer.');
    return photo.prepared;
  }
  const observation = photo.location;
  const location = observation?.location;
  const captureTime = Date.parse(photo.capture.captureObservedAtUtc);
  const locationTime = Date.parse(location?.observedAtUtc || '');
  if (!observation || !location || location.state !== 'captured' || location.mocked === true || location.accuracyMetres === null
    || location.accuracyMetres > 100 || !Number.isFinite(captureTime) || !Number.isFinite(locationTime)
    || Math.abs(locationTime - captureTime) > 120000) throw conflict('The photo needs a capture-time location within 100 m accuracy. Review it and take a new photo.');
  if (!Number.isFinite(photo.width) || !Number.isFinite(photo.height) || photo.width <= 0 || photo.height <= 0) {
    throw conflict('The photo dimensions are unavailable. The original remains on this phone; review and retake the photo.');
  }
  for (const [maximumEdge, compress] of RENTAL_IMAGE_ATTEMPTS) {
    await checkOwner(owner);
    const image = ImageManipulator.manipulate(photo.uri);
    let rendered: Awaited<ReturnType<typeof image.renderAsync>> | undefined;
    let candidate: File | undefined;
    try {
      if (Math.max(photo.width, photo.height) > maximumEdge) {
        image.resize(photo.width >= photo.height ? { width: maximumEdge, height: null } : { width: null, height: maximumEdge });
      }
      rendered = await image.renderAsync();
      await checkOwner(owner);
      const prepared = await rendered.saveAsync({ compress, format: SaveFormat.JPEG });
      candidate = new File(prepared.uri);
      await checkOwner(owner);
      if (!candidate.exists || candidate.size < 1 || candidate.size > MAX_RENTAL_PHOTO_BYTES) continue;
      PHOTO_DIRECTORY.create({ intermediates: true, idempotent: true });
      const retained = new File(PHOTO_DIRECTORY, `${photo.clientUploadId}.jpg`);
      // No upload can start before its checkpoint. A leftover uncheckpointed target can safely be replaced.
      try {
        await candidate.copy(retained, { overwrite: true });
        await checkOwner(owner);
        if (retained.size !== candidate.size) throw new Error('The prepared photo could not be retained. The original remains on this phone.');
      } catch (error) {
        if (retained.exists) retained.delete();
        throw error;
      }
      photo.prepared = { uri: retained.uri, name: `${photo.clientUploadId}.jpg`, size: retained.size,
        envelope: JSON.stringify({ schemaVersion: 1, kind: 'tlink-rental-inspection-photo', captureSessionId: photo.captureSessionId,
          source: 'in_app_camera', capture: photo.capture, locationPermission: observation.permission, location,
          processing: { privacySafeDerivative: true, exifCopied: false, outputFormat: 'image/jpeg', widthPixels: prepared.width,
            heightPixels: prepared.height, maximumWidthPixels: 1600 } }) };
      // This durable checkpoint precedes the first request. Retries send the exact JPEG and envelope again.
      await persist(owner, record);
      return photo.prepared;
    } finally {
      if (candidate?.exists) candidate.delete();
      rendered?.release();
      image.release();
    }
  }
  throw conflict('This photo could not fit the report size limit at readable quality. The original remains on this phone. Take a closer overview or label photo.');
}

async function uploadPhoto(owner: LocalDataOwner, record: RentalSaveRecord, photo: PhotoCheckpoint) {
  const prepared = await preparePhoto(owner, record, photo);
  await checkOwner(owner);
  const form = new FormData();
  form.append('workOrderId', record.workOrderId);
  form.append('category', 'progress');
  form.append('caption', (record.purpose || '').slice(0, 300));
  form.append('clientUploadId', photo.clientUploadId);
  form.append('evidenceEnvelope', prepared.envelope);
  form.append('file', new File(prepared.uri), prepared.name);
  const controller = new AbortController();
  requests.add(controller);
  try {
    const uploaded = await apiRequest<{ uploadedMediaId?: string }>('/api/trade-field-work', { method: 'POST', body: form, signal: controller.signal });
    await checkOwner(owner);
    if (!uploaded.uploadedMediaId) throw new Error('The photo upload did not return its file reference. It remains queued.');
    photo.mediaId = uploaded.uploadedMediaId;
    await persist(owner, record);
  } finally { requests.delete(controller); }
}

async function processRecord(owner: LocalDataOwner, record: RentalSaveRecord) {
  record.status = 'syncing'; record.error = '';
  await persist(owner, record);
  let result = await request(owner, record.workOrderId);
  result = await saveAnswer(owner, record, result);
  for (const photo of record.photos) {
    if (!photo.mediaId) await uploadPhoto(owner, record, photo);
    // Another device may have edited during a slow upload. Obtain a fresh CAS revision and recheck the saved item.
    result = await request(owner, record.workOrderId);
    const assessmentModule = currentModule(record, result);
    const item = currentItem(record, result);
    const finding = result.findings?.find((entry) => entry.itemId === item?.id);
    if (!item || item.id !== record.savedItem?.id || item.revision !== record.savedItem.revision
      || (finding?.revision || 0) !== (record.savedFinding?.revision || 0)) throw conflict();
    const linked = result.evidence?.some((entry) => entry.itemId === item.id && entry.jobMediaId === photo.mediaId && entry.status === 'active');
    if (!linked && photo.linked) throw conflict('A previously saved photo was removed elsewhere. Review the evidence before continuing.');
    if (!linked) {
      result = await request(owner, record.workOrderId, { action: 'link_evidence', itemId: item.id,
        jobMediaId: photo.mediaId, purpose: record.purpose || '', expectedModuleRevision: assessmentModule.revision });
    }
    photo.linked = true;
    await persist(owner, record);
  }
  await cacheResult(owner, record.workOrderId, result);
  record.status = 'succeeded'; record.error = '';
  await persist(owner, record);
}

async function processJob(owner: LocalDataOwner, workOrderId: string) {
  const attempted = new Set<string>();
  while (true) {
    await checkOwner(owner);
    const record = (await recordsFor(owner, workOrderId)).find((entry) => !attempted.has(entry.id)
      && ['queued', 'syncing', 'retry'].includes(entry.status));
    if (!record) return;
    attempted.add(record.id);
    try { await processRecord(owner, record); }
    catch (error) {
      await checkOwner(owner);
      record.status = error instanceof RentalSaveQueueError || (error instanceof ApiError && [400, 409, 413, 422].includes(error.status)) ? 'conflict' : 'retry';
      record.error = error instanceof Error ? error.message : 'The answer is saved locally. Retry when connected.';
      await persist(owner, record);
      if (error instanceof ApiError && [401, 403, 426].includes(error.status)) throw error;
      if (record.status === 'retry') return;
    }
  }
}

export async function processRentalSaveQueue(workOrderId?: string): Promise<void> {
  const owner = await ownerNow();
  const records = await recordsFor(owner, workOrderId);
  const jobs = [...new Set(records.filter((record) => record.status !== 'succeeded').map((record) => record.workOrderId))];
  await Promise.all(jobs.map((id) => {
    const key = jobKey(owner, id);
    let worker = workers.get(key);
    if (!worker) {
      worker = serial(jobGates, key, () => processJob(owner, id)).finally(() => { workers.delete(key); });
      workers.set(key, worker);
    }
    return worker;
  }));
}

export async function acknowledgeRentalSave(id: string) {
  const owner = await ownerNow();
  const record = (await recordsFor(owner)).find((entry) => entry.id === id);
  if (!record || record.status !== 'succeeded') return;
  await serial(localGates, jobKey(owner, record.workOrderId), async () => {
    await checkOwner(owner);
    await writeRentalSetting(owner, recordKey(record), null);
  });
  emit(record.workOrderId);
}

export async function discardRentalSave(id: string) {
  const owner = await ownerNow();
  const record = (await recordsFor(owner)).find((entry) => entry.id === id);
  if (!record) return;
  await serial(jobGates, jobKey(owner, record.workOrderId), async () => {
    await serial(localGates, jobKey(owner, record.workOrderId), async () => {
      await checkOwner(owner);
      await writeRentalSetting(owner, recordKey(record), null);
    });
  });
  emit(record.workOrderId);
}

export async function requestWhenRentalSynced(workOrderId: string, body: Record<string, unknown>) {
  const snapshot = copy(body);
  const owner = await ownerNow();
  const key = jobKey(owner, workOrderId);
  // Refuse promptly even if the worker is waiting on a slow request.
  if ((await recordsFor(owner, workOrderId)).some((record) => record.status !== 'succeeded')) throw pendingError();
  return serial(jobGates, key, async () => {
    await serial(localGates, key, async () => {
      await checkOwner(owner);
      if ((await recordsFor(owner, workOrderId)).some((record) => record.status !== 'succeeded')) throw pendingError();
      finalizing.add(key);
    });
    try {
      const current = await request(owner, workOrderId);
      const item = current.items?.find((entry) => entry.id === snapshot.itemId);
      const evidence = current.evidence?.find((entry) => entry.id === snapshot.evidenceId);
      const assessmentModule = current.modules?.find((entry) => entry.id === (snapshot.moduleId || item?.moduleId || evidence?.moduleId));
      // Direct actions must remain tied to what the assessor reviewed. Never replace stale supplied CAS values silently.
      for (const [field, revision] of Object.entries({ expectedInspectionRevision: current.inspection?.revision,
        expectedModuleRevision: assessmentModule?.revision, expectedRevision: assessmentModule?.revision ?? current.inspection?.revision })) {
        if (snapshot[field] !== undefined && snapshot[field] !== revision) throw conflict('This assessment changed while saving. Review the latest details and try again.');
      }
      const mutation = { ...snapshot };
      if (snapshot.action === 'save_module_answers') mutation.answers = { ...assessmentModule?.answers, ...object(snapshot.answers) };
      return await request(owner, workOrderId, mutation);
    } finally { finalizing.delete(key); }
  });
}
