import { apiRequest } from '@/lib/api';
import { APP_VERSION, MOBILE_PLATFORM, UPLOAD_PART_BYTES } from '@/lib/config';
import { getDeviceId } from '@/lib/device';
import { completeUpload, queuedUploads, updateUpload } from '@/lib/database';
import { decryptQueuedPart, encryptedBundleExists } from '@/lib/encrypted-files';
import type { UploadRow } from '@/lib/types';

type UploadSession = {
  id: string;
  partSizeBytes: number;
  totalParts: number;
  status: string;
  parts: { partNumber: number; etag: string; sizeBytes: number }[];
};

type UploadResponse = { ok: boolean; upload: UploadSession };

async function initiate(row: UploadRow) {
  const deviceId = await getDeviceId();
  return apiRequest<UploadResponse>('/api/trade-team/media', {
    method: 'POST',
    body: JSON.stringify({
      action: 'initiate',
      deviceId,
      platform: MOBILE_PLATFORM,
      appVersion: APP_VERSION,
      clientUploadId: row.id,
      workOrderId: row.work_order_id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      category: row.category,
      caption: row.caption,
    }),
  });
}

async function resume(row: UploadRow) {
  const deviceId = await getDeviceId();
  return apiRequest<UploadResponse>(
    `/api/trade-team/media?deviceId=${encodeURIComponent(deviceId)}&sessionId=${encodeURIComponent(row.session_id)}`,
  );
}

async function uploadPart(row: UploadRow, session: UploadSession, partNumber: number) {
  const bytes = await decryptQueuedPart(row.local_uri, partNumber);
  const part = new Blob([bytes.buffer as ArrayBuffer], { type: row.content_type });
  const form = new FormData();
  form.append('action', 'upload_part');
  form.append('deviceId', await getDeviceId());
  form.append('platform', MOBILE_PLATFORM);
  form.append('appVersion', APP_VERSION);
  form.append('sessionId', session.id);
  form.append('partNumber', String(partNumber));
  form.append('file', part, `${row.file_name}.part-${partNumber}`);
  return apiRequest<UploadResponse>('/api/trade-team/media', { method: 'POST', body: form });
}

async function finalise(sessionId: string) {
  return apiRequest<UploadResponse>('/api/trade-team/media', {
    method: 'POST',
    body: JSON.stringify({
      action: 'complete',
      deviceId: await getDeviceId(),
      platform: MOBILE_PLATFORM,
      appVersion: APP_VERSION,
      sessionId,
    }),
  });
}

async function processUpload(row: UploadRow) {
  const expectedParts = Math.ceil(row.size_bytes / UPLOAD_PART_BYTES);
  if (!encryptedBundleExists(row.local_uri, expectedParts)) {
    await updateUpload(row.id, { status: 'rejected', error_message: 'The saved file is no longer available on this device.' });
    return;
  }
  let response = row.session_id ? await resume(row) : await initiate(row);
  let session = response.upload;
  await updateUpload(row.id, {
    session_id: session.id,
    uploaded_parts: JSON.stringify(session.parts.map((part) => part.partNumber)),
    status: 'uploading',
  });
  const completed = new Set(session.parts.map((part) => part.partNumber));
  for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
    if (completed.has(partNumber)) continue;
    response = await uploadPart(row, session, partNumber);
    session = response.upload;
    await updateUpload(row.id, {
      uploaded_parts: JSON.stringify(session.parts.map((part) => part.partNumber)),
      status: 'uploading',
    });
  }
  await finalise(session.id);
  await completeUpload(row.id);
}

export async function processUploadQueue() {
  const uploads = await queuedUploads();
  for (const upload of uploads) {
    try {
      await processUpload(upload);
    } catch (error) {
      await updateUpload(upload.id, {
        status: 'retry',
        attempts: upload.attempts + 1,
        error_message: error instanceof Error ? error.message : 'Upload paused. It will resume when connected.',
      });
      throw error;
    }
  }
}

export { UPLOAD_PART_BYTES };
