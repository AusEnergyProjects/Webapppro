import * as Crypto from 'expo-crypto';

import { ApiError, apiRequest } from '@/lib/api';
import { APP_VERSION, MOBILE_PLATFORM, UPLOAD_PART_BYTES } from '@/lib/config';
import { getDeviceId } from '@/lib/device';
import { completeUpload, queuedUploads, updateUpload } from '@/lib/database';
import { decryptQueuedPart, encryptedBundleExists } from '@/lib/encrypted-files';
import type { FieldAccessMode, UploadRow } from '@/lib/types';

type UploadSession = {
  id: string;
  partSizeBytes: number;
  totalParts: number;
  status: string;
  parts: { partNumber: number; etag: string; sizeBytes: number }[];
};

type UploadResponse = { ok: boolean; upload: UploadSession };

type SessionAction = 'complete' | 'continue' | 'restart' | 'reject';

function mediaPath(mode: FieldAccessMode) {
  return mode === 'creditex_manual'
    ? '/api/creditex/manual-field/media'
    : '/api/trade-team/media';
}

function sessionAction(status: string): SessionAction {
  if (status === 'completed') return 'complete';
  if (['initiated', 'uploading', 'completing'].includes(status)) return 'continue';
  if (['expired', 'aborted'].includes(status)) return 'restart';
  return 'reject';
}

function isRecoverableSessionFailure(status: number, code: string, message: string) {
  if (status === 404) return true;
  if ([
    'UPLOAD_EXPIRED',
    'UPLOAD_STATE_CHANGED',
    'MANUAL_FIELD_UPLOAD_NOT_FOUND',
    'MANUAL_FIELD_UPLOAD_STATE_INVALID',
  ].includes(code)) return true;
  return status === 409 && /upload.*(?:no longer|cannot be completed|changed state)/i.test(message);
}

function evidenceEnvelope(row: UploadRow) {
  try {
    return JSON.parse(row.evidence_envelope) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function initiate(row: UploadRow, mode: FieldAccessMode) {
  const deviceId = await getDeviceId();
  return apiRequest<UploadResponse>(mediaPath(mode), {
    method: 'POST',
    body: JSON.stringify({
      action: 'initiate',
      deviceId,
      platform: MOBILE_PLATFORM,
      appVersion: APP_VERSION,
      clientUploadId: row.client_upload_id || row.id,
      workOrderId: row.work_order_id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      category: row.category,
      caption: row.caption,
      evidenceEnvelope: evidenceEnvelope(row),
    }),
  });
}

async function resume(row: UploadRow, mode: FieldAccessMode) {
  const deviceId = await getDeviceId();
  return apiRequest<UploadResponse>(
    `${mediaPath(mode)}?deviceId=${encodeURIComponent(deviceId)}&sessionId=${encodeURIComponent(row.session_id)}`,
  );
}

async function uploadPart(
  row: UploadRow,
  session: UploadSession,
  partNumber: number,
  mode: FieldAccessMode,
) {
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
  return apiRequest<UploadResponse>(mediaPath(mode), { method: 'POST', body: form });
}

async function finalise(sessionId: string, mode: FieldAccessMode) {
  return apiRequest<UploadResponse>(mediaPath(mode), {
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

function unavailableSessionError(session: UploadSession) {
  return new ApiError(
    `Upload session ${session.id} is ${session.status} and cannot be resumed.`,
    409,
    'UPLOAD_SESSION_TERMINAL',
  );
}

async function restartUpload(row: UploadRow) {
  const clientUploadId = `upload-${Crypto.randomUUID()}`;
  await updateUpload(row.id, {
    client_upload_id: clientUploadId,
    session_id: '',
    uploaded_parts: '[]',
    status: 'queued',
    error_message: '',
  });
  return {
    ...row,
    client_upload_id: clientUploadId,
    session_id: '',
    uploaded_parts: '[]',
    status: 'queued' as const,
    error_message: '',
  };
}

async function processUploadAttempt(row: UploadRow, mode: FieldAccessMode): Promise<SessionAction> {
  let response = row.session_id ? await resume(row, mode) : await initiate(row, mode);
  let session = response.upload;
  const action = sessionAction(session.status);
  if (action === 'complete') {
    await completeUpload(row.id);
    return action;
  }
  if (action === 'reject') {
    await updateUpload(row.id, {
      status: 'rejected',
      error_message: `The server upload session is ${session.status}. Review or capture this evidence again.`,
    });
    return action;
  }
  if (action !== 'continue') return action;
  const expectedParts = Math.ceil(row.size_bytes / UPLOAD_PART_BYTES);
  if (!encryptedBundleExists(row.local_uri, expectedParts)) {
    await updateUpload(row.id, {
      status: 'rejected',
      error_message: 'The saved file is no longer available on this device.',
    });
    return 'reject';
  }
  await updateUpload(row.id, {
    session_id: session.id,
    uploaded_parts: JSON.stringify(session.parts.map((part) => part.partNumber)),
    status: 'uploading',
  });
  const completed = new Set(session.parts.map((part) => part.partNumber));
  for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
    if (completed.has(partNumber)) continue;
    response = await uploadPart(row, session, partNumber, mode);
    session = response.upload;
    await updateUpload(row.id, {
      uploaded_parts: JSON.stringify(session.parts.map((part) => part.partNumber)),
      status: 'uploading',
    });
  }
  await finalise(session.id, mode);
  await completeUpload(row.id);
  return 'complete';
}

async function processUpload(row: UploadRow, mode: FieldAccessMode) {
  let current = row;
  let recoveryUsed = false;
  while (true) {
    try {
      const action = await processUploadAttempt(current, mode);
      if (action === 'complete' || action === 'reject') return;
      if (action === 'restart' && !recoveryUsed) {
        current = await restartUpload(current);
        recoveryUsed = true;
        continue;
      }
      throw unavailableSessionError({
        id: current.session_id,
        partSizeBytes: UPLOAD_PART_BYTES,
        totalParts: 0,
        status: action,
        parts: [],
      });
    } catch (error) {
      if (
        recoveryUsed
        || !current.session_id
        || !(error instanceof ApiError)
        || !isRecoverableSessionFailure(error.status, error.code, error.message)
      ) {
        throw error;
      }
      try {
        const response = await resume(current, mode);
        const action = sessionAction(response.upload.status);
        if (action === 'complete') {
          await completeUpload(current.id);
          return;
        }
        if (action === 'reject') throw unavailableSessionError(response.upload);
        if (action === 'restart') current = await restartUpload(current);
      } catch (resumeError) {
        if (
          !(resumeError instanceof ApiError)
          || !isRecoverableSessionFailure(resumeError.status, resumeError.code, resumeError.message)
        ) {
          throw resumeError;
        }
        current = await restartUpload(current);
      }
      recoveryUsed = true;
    }
  }
}

export async function processUploadQueue(mode: FieldAccessMode) {
  const uploads = await queuedUploads(mode);
  for (const upload of uploads) {
    try {
      await processUpload(upload, mode);
    } catch (error) {
      const permanentEvidenceCodes = new Set([
        'EVIDENCE_HASH_MISMATCH',
        'EVIDENCE_ENVELOPE_INVALID',
        'EVIDENCE_LINK_INVALID',
        'EVIDENCE_REQUIREMENT_REQUIRED',
        'EVIDENCE_CONTENT_TYPE_INVALID',
        'EVIDENCE_ORIGINAL_REQUIRED',
        'EVIDENCE_METADATA_REQUIRED',
        'EVIDENCE_LOCATION_INVALID',
        'EVIDENCE_GPS_REQUIRED',
        'EVIDENCE_GPS_MOCKED',
        'EVIDENCE_CAPTURE_TIME_REQUIRED',
        'EVIDENCE_MAXIMUM_REACHED',
        'EVIDENCE_REQUIREMENT_UNSUPPORTED',
        'IDEMPOTENCY_MISMATCH',
        'UPLOAD_SESSION_TERMINAL',
      ]);
      await updateUpload(upload.id, {
        status: error instanceof ApiError && permanentEvidenceCodes.has(error.code) ? 'rejected' : 'retry',
        attempts: upload.attempts + 1,
        error_message: error instanceof Error ? error.message : 'Upload paused. It will resume when connected.',
      });
      throw error;
    }
  }
}

export { UPLOAD_PART_BYTES };
