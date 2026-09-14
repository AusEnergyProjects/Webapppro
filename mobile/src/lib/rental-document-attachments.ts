import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { apiRequest } from '@/lib/api';
import { assertLocalDataOwner, getLocalDataOwner, readRentalSetting, writeRentalSetting, subscribeLocalDataOwner, type LocalDataOwner } from '@/lib/database';
import type { RentalAssessmentItem, RentalAssessmentResult } from '@/lib/rental-inspection';

export type PendingRentalDocument = { id: string; ownerKey: string; workOrderId: string; itemId: string;
  itemRevision: number; name: string; mediaId: string; envelope: string };
const directory = () => new Directory(Paths.document, 'rental-professional-documents');
const setting = (workOrderId: string) => 'rental-documents:' + workOrderId;
const mutationTails = new Map<string, Promise<unknown>>();
const deletedJobs = new Map<string, symbol>();
const jobKey = (owner: LocalDataOwner, workOrderId: string) => owner.key + ':' + owner.epoch + ':' + workOrderId;
function assertJobAvailable(owner: LocalDataOwner, workOrderId: string) {
  assertLocalDataOwner(owner);
  if (deletedJobs.has(jobKey(owner, workOrderId))) throw new Error('This job is no longer available on this device.');
}
async function mutateDocuments<T>(owner: LocalDataOwner, workOrderId: string, action: () => Promise<T>, allowDeleted = false): Promise<T> {
  const key = jobKey(owner, workOrderId);
  const previous = mutationTails.get(key) || Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => {
    if (allowDeleted) assertLocalDataOwner(owner); else assertJobAvailable(owner, workOrderId);
    return action();
  });
  mutationTails.set(key, pending);
  try { return await pending; }
  finally { if (mutationTails.get(key) === pending) mutationTails.delete(key); }
}
const requests = new Map<AbortController, string>();
subscribeLocalDataOwner(() => { for (const controller of requests.keys()) controller.abort(); deletedJobs.clear(); });
function cancelRentalDocumentRequests(workOrderId: string) {
  for (const [controller, job] of requests) if (job === workOrderId) controller.abort();
}
function valid(value: unknown): value is PendingRentalDocument {
  return Boolean(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) && 'ownerKey' in value && typeof value.ownerKey === 'string'
    && 'workOrderId' in value && typeof value.workOrderId === 'string' && 'itemId' in value && typeof value.itemId === 'string'
    && 'itemRevision' in value && Number.isSafeInteger(value.itemRevision) && 'name' in value && typeof value.name === 'string'
    && 'mediaId' in value && typeof value.mediaId === 'string' && 'envelope' in value && typeof value.envelope === 'string');
}
async function records(owner: LocalDataOwner, workOrderId: string) {
  const raw: unknown = JSON.parse(await readRentalSetting(owner, setting(workOrderId)) || '[]');
  if (!Array.isArray(raw) || !raw.every(valid)) throw new Error('A retained professional document needs recovery. Keep this device and contact support.');
  if (raw.some((entry) => entry.ownerKey !== owner.key || entry.workOrderId !== workOrderId)) throw new Error('The retained document belongs to another account or job.');
  return raw;
}
export async function pendingRentalDocuments(workOrderId: string) {
  const owner = await getLocalDataOwner(); assertJobAvailable(owner, workOrderId);
  return records(owner, workOrderId);
}
/** Fence pending copies and metadata writes before purging this confirmed deleted or reassigned job. */
export async function purgeRentalDocuments(owner: LocalDataOwner, workOrderId: string, deletion = Symbol(workOrderId)) {
  assertLocalDataOwner(owner);
  deletedJobs.set(jobKey(owner, workOrderId), deletion);
  cancelRentalDocumentRequests(workOrderId);
  await mutateDocuments(owner, workOrderId, async () => {
    const current = await records(owner, workOrderId);
    for (const entry of current) {
      assertLocalDataOwner(owner);
      const file = new File(directory(), entry.id + '.pdf'); if (file.exists) file.delete();
    }
    await writeRentalSetting(owner, setting(workOrderId), null);
  }, true);
  return deletion;
}
/** Only an authoritative reassignment may reopen a locally purged job. */
export async function restoreRentalDocumentAccess(owner: LocalDataOwner, workOrderId: string, deletion: symbol) {
  assertLocalDataOwner(owner);
  const key = jobKey(owner, workOrderId);
  if (deletedJobs.get(key) !== deletion) return;
  await mutateDocuments(owner, workOrderId, async () => {
    if (deletedJobs.get(key) === deletion) deletedJobs.delete(key);
  }, true);
}
async function replace(owner: LocalDataOwner, record: PendingRentalDocument) {
  return mutateDocuments(owner, record.workOrderId, async () => {
    const current = await records(owner, record.workOrderId);
    if (!current.some((entry) => entry.id === record.id)) throw new Error('The retained upload was removed or this job is no longer available.');
    await writeRentalSetting(owner, setting(record.workOrderId), JSON.stringify(current.map((entry) => entry.id === record.id ? record : entry)));
  });
}
export async function retainRentalDocument(workOrderId: string, item: RentalAssessmentItem, asset: { uri: string; name: string }) {
  const owner = await getLocalDataOwner();
  return mutateDocuments(owner, workOrderId, async () => {
    const current = await records(owner, workOrderId);
    if (current.some((entry) => entry.itemId === item.id)) throw new Error("Retry or remove this item's retained PDF before choosing another.");
    const source = new File(asset.uri);
    if (!source.exists || source.size < 5 || source.size > 8 * 1024 * 1024) throw new Error('Choose a PDF no larger than 8 MB.');
    const bytes = await source.bytes(); assertJobAvailable(owner, workOrderId);
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Choose a valid PDF document.');
    const id = Crypto.randomUUID();
    directory().create({ idempotent: true, intermediates: true });
    const destination = new File(directory(), id + '.pdf');
    try {
      await source.copy(destination);
      assertJobAvailable(owner, workOrderId);
      const now = new Date();
      const record: PendingRentalDocument = { id, ownerKey: owner.key, workOrderId, itemId: item.id,
        itemRevision: item.revision, name: asset.name, mediaId: '', envelope: JSON.stringify({ schemaVersion: 1,
          kind: 'tlink-rental-inspection-document', captureSessionId: 'capture-' + id, source: 'native_file_upload',
          capture: { captureObservedAtUtc: now.toISOString(), utcOffsetMinutes: -now.getTimezoneOffset(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown' },
          location: { state: 'not_required', observedAtUtc: '', latitude: null, longitude: null, accuracyMetres: null } }) };
      await writeRentalSetting(owner, setting(workOrderId), JSON.stringify([...current, record]));
      assertJobAvailable(owner, workOrderId);
      return record;
    } catch (error) {
      // This unique destination belongs to this attempt, including a copy finishing after an account purge.
      if (destination.exists) destination.delete();
      throw error;
    }
  });
}
export async function discardRentalDocument(workOrderId: string, id: string) {
  const owner = await getLocalDataOwner();
  return mutateDocuments(owner, workOrderId, async () => {
    const current = await records(owner, workOrderId);
    if (!current.some((entry) => entry.id === id)) return;
    await writeRentalSetting(owner, setting(workOrderId), JSON.stringify(current.filter((entry) => entry.id !== id)));
    assertLocalDataOwner(owner);
    const file = new File(directory(), id + '.pdf'); if (file.exists) file.delete();
  });
}
export async function uploadRentalDocument(workOrderId: string, id: string) {
  const owner = await getLocalDataOwner();
  assertJobAvailable(owner, workOrderId);
  const pending = (await records(owner, workOrderId)).find((entry) => entry.id === id);
  if (!pending) throw new Error('The retained PDF could not be found.');
  let record: PendingRentalDocument = pending;
  const controller = new AbortController(); requests.set(controller, workOrderId);
  const getCurrent = async () => {
    assertJobAvailable(owner, workOrderId);
    const result = await apiRequest<RentalAssessmentResult>('/api/trade-rental-inspections?workOrderId=' + encodeURIComponent(workOrderId), { signal: controller.signal });
    assertJobAvailable(owner, workOrderId);
    return result;
  };
  try {
    let current = await getCurrent();
    if (record.mediaId && current.evidence?.some((entry) => entry.itemId === record.itemId && entry.jobMediaId === record.mediaId && entry.status === 'active')) {
      await discardRentalDocument(workOrderId, id); return current;
    }
    const original = current.items?.find((entry) => entry.id === record.itemId);
    if (!current.permissions?.canEdit || !original || original.revision !== record.itemRevision) throw new Error('The saved answer changed or access ended. Review it before choosing this PDF again.');
    if (!record.mediaId) {
      const form = new FormData();
      form.append('workOrderId', workOrderId); form.append('category', 'document');
      form.append('caption', 'Professional service record'); form.append('clientUploadId', record.id);
      form.append('evidenceEnvelope', record.envelope); form.append('file', new File(directory(), record.id + '.pdf'), record.name);
      const result = await apiRequest<{ uploadedMediaId?: string }>('/api/trade-field-work', { method: 'POST', body: form, signal: controller.signal });
      assertLocalDataOwner(owner);
      if (!result.uploadedMediaId) throw new Error('The PDF upload could not be confirmed. Retry the retained document.');
      record = { ...record, mediaId: result.uploadedMediaId }; await replace(owner, record);
    }
    current = await getCurrent();
    if (current.evidence?.some((entry) => entry.itemId === record.itemId && entry.jobMediaId === record.mediaId && entry.status === 'active')) {
      await discardRentalDocument(workOrderId, id); return current;
    }
    const item = current.items?.find((entry) => entry.id === record.itemId);
    const assessmentModule = current.modules?.find((entry) => entry.id === item?.moduleId);
    if (!current.permissions?.canEdit || !item || item.revision !== record.itemRevision || !assessmentModule || assessmentModule.status === 'complete') throw new Error('The answer changed during upload. The PDF is retained; review the record before retrying.');
    const result = await apiRequest<RentalAssessmentResult>('/api/trade-rental-inspections', { method: 'POST', signal: controller.signal,
      body: JSON.stringify({ action: 'link_evidence', workOrderId, itemId: item.id, jobMediaId: record.mediaId,
        purpose: 'Complete authenticated professional service record', expectedModuleRevision: assessmentModule.revision }) });
    assertLocalDataOwner(owner);
    if (!result.ok) throw new Error(result.error || 'The PDF link could not be confirmed. Retry the retained document.');
    await discardRentalDocument(workOrderId, id); return result;
  } finally { requests.delete(controller); }
}
