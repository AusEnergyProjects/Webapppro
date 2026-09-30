import type { User } from 'firebase/auth';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';

import { API_BASE_URL, APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import { getDeviceId } from '@/lib/device';
import { firebaseAuth } from '@/lib/auth';
import { getFieldPrincipal, getFieldSessionToken } from '@/lib/field-session';
import { businessSessionRevision, getBusinessSession } from '@/lib/business-session';

const JSON_REQUEST_TIMEOUT_MS = 20_000;
const REPORT_REQUEST_TIMEOUT_MS = 120_000;
const MULTIPART_REQUEST_TIMEOUT_MS = 120_000;

export type ApiRequestOptions = { operation?: 'report'; expectedBusinessKey?: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly minimumVersion = '',
    public readonly payload: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

async function bearer(user?: User | null) {
  const active = user || firebaseAuth.currentUser;
  if (!active) throw new ApiError('Sign in to continue.', 401, 'AUTH_REQUIRED');
  // Firebase refreshes expired tokens itself. Forcing a refresh on each call
  // signal adds an unnecessary network round trip to every ICE candidate.
  return active.getIdToken();
}

async function authenticatedHeaders(init: RequestInit, user?: User | null, discovery = false, expectedBusinessKey?: string) {
  const deviceId = await getDeviceId();
  const headers = new Headers(init.headers);
  const fieldToken = await getFieldSessionToken();
  headers.delete('X-TLink-Business');
  if (!fieldToken && !discovery) {
    const active = user || firebaseAuth.currentUser;
    const session = active ? await getBusinessSession(active.uid) : null;
    if (!session) throw new ApiError('Choose a business to continue.', 409, 'BUSINESS_SELECTION_REQUIRED');
    if (expectedBusinessKey && session.principal.localOwnerKey !== expectedBusinessKey) {
      throw new ApiError('Your business changed. Reopen this item before continuing.', 409, 'BUSINESS_CHANGED');
    }
    if (!session.business.manualOnly) headers.set('X-TLink-Business', session.business.ownerUid);
  }
  if (fieldToken && expectedBusinessKey && (await getFieldPrincipal())?.localOwnerKey !== expectedBusinessKey) {
    throw new ApiError('Your business changed. Reopen this item before continuing.', 409, 'BUSINESS_CHANGED');
  }
  headers.set('Authorization', fieldToken
    ? `TLinkField ${fieldToken}`
    : `Bearer ${await bearer(user)}`);
  headers.set('x-aea-device-id', deviceId);
  headers.set('x-aea-platform', MOBILE_PLATFORM);
  headers.set('x-aea-app-version', APP_VERSION);
  return headers;
}

async function deviceHeaders(init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set('x-aea-device-id', await getDeviceId());
  headers.set('x-aea-platform', MOBILE_PLATFORM);
  headers.set('x-aea-app-version', APP_VERSION);
  return headers;
}

function normaliseSha256(value: string) {
  const normalised = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[0-9a-f]{64}$/.test(normalised) ? normalised : '';
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function fetchJson(url: string, init: RequestInit, options: ApiRequestOptions = {}) {
  const controller = new AbortController();
  const multipart = init.body instanceof FormData;
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), multipart ? MULTIPART_REQUEST_TIMEOUT_MS
    : options.operation === 'report' ? REPORT_REQUEST_TIMEOUT_MS : JSON_REQUEST_TIMEOUT_MS);
  try {
    const request = { ...init, signal: controller.signal };
    return await (multipart ? expoFetch(url, request) : fetch(url, request));
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new ApiError(
        options.operation === 'report'
          ? 'The report service took too long to respond. Your finish request is saved and will check the result again.'
          : 'The service took too long to respond. Your work is saved; try again when connected.',
        408,
        'NETWORK_TIMEOUT',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

export async function governedReferenceDocumentBytesSha256(bytes: Uint8Array) {
  const exactBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exactBytes).set(bytes);
  return bytesToHex(new Uint8Array(
    await digest(CryptoDigestAlgorithm.SHA256, exactBytes),
  ));
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* An upstream size limit or outage may return text instead of JSON. */ }
  if (response.status === 413) throw new ApiError(
    'The upload exceeds the server size limit. Your original remains on this phone.',
    413, 'UPLOAD_TOO_LARGE',
  );
  throw new ApiError(
    'The service did not return a valid result. Your work is retained. Try again when connected.',
    response.status, 'INVALID_SERVER_RESPONSE',
  );
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, user?: User | null, options: ApiRequestOptions = {}) {
  const revision = businessSessionRevision();
  const headers = await authenticatedHeaders(init, user,
    path === '/api/trade-businesses' || path === '/api/trade-businesses/restore-cache', options.expectedBusinessKey);
  const assertBusiness = () => {
    if (revision !== businessSessionRevision()) throw new ApiError('Your business changed. Reopen this item before continuing.', 409, 'BUSINESS_CHANGED');
  };
  assertBusiness();
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetchJson(`${API_BASE_URL}${path}`, { ...init, headers }, options);
  const body = await responseBody(response);
  assertBusiness();
  if (!response.ok) {
    const error = new ApiError(
      String(body.error || 'The request could not be completed.'),
      response.status,
      String(body.code || ''),
      String(body.minimumVersion || ''),
      body,
    );
    throw error;
  }
  return body as T;
}

export async function publicApiRequest<T>(path: string, init: RequestInit = {}) {
  const headers = await deviceHeaders(init);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetchJson(`${API_BASE_URL}${path}`, { ...init, headers });
  const body = await responseBody(response);
  if (!response.ok) throw new ApiError(
    String(body.error || 'The request could not be completed.'),
    response.status,
    String(body.code || ''),
    String(body.minimumVersion || ''),
    body,
  );
  return body as T;
}

/** Download private conversation media without exposing an authenticated URL to another app. */
export async function apiDownloadMessageMedia(id: string, signal?: AbortSignal): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
    throw new ApiError('This attachment is invalid.', 400, 'MESSAGE_MEDIA_INVALID');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, JSON_REQUEST_TIMEOUT_MS);
  try {
    const init: RequestInit = { method: 'GET', signal: controller.signal, redirect: 'error' };
    const headers = await authenticatedHeaders(init);
    if (controller.signal.aborted) throw new Error('Attachment download cancelled.');
    const response = await expoFetch(`${API_BASE_URL}/api/trade-message-media?id=${encodeURIComponent(id)}`, { ...init, headers });
    if (!response.ok) {
      const body = await responseBody(response);
      throw new ApiError(String(body.error || 'This attachment could not be opened.'), response.status,
        String(body.code || 'MESSAGE_MEDIA_UNAVAILABLE'));
    }
    const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg']);
    const limit = 5 * 1024 * 1024;
    const advertised = response.headers.get('content-length');
    if (!types.has(contentType) || (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > limit))) {
      throw new ApiError('This attachment has an unsupported format or size.', 413, 'MESSAGE_MEDIA_INVALID');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError('This attachment is empty.', 502, 'MESSAGE_MEDIA_INVALID');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error('Attachment download cancelled.');
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) throw new ApiError('This attachment is too large.', 413, 'MESSAGE_MEDIA_INVALID');
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (size < 1 || (advertised !== null && Number(advertised) !== size)) {
      throw new ApiError('This attachment did not download completely. Try again.', 502, 'MESSAGE_MEDIA_INVALID');
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, contentType };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export type VerifiedGovernedDocument = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  sha256: string;
  integrityReceipt: string;
}>;

export async function downloadAssignedWorkPackDocument(
  path: string,
  expected: Readonly<{
    sha256: string;
    contentType: string;
    sizeBytes: number;
  }>,
  user?: User | null,
): Promise<VerifiedGovernedDocument> {
  const assignedDocumentPath = path.startsWith(
    '/api/trade-team/work-packs/reference-document?',
  ) || path.startsWith('/api/trade-team/work-packs/final-record?');
  if (!assignedDocumentPath) {
    throw new ApiError(
      'This governed document link is invalid. Sync the job and try again.',
      400,
      'WORK_PACK_DOCUMENT_URL_INVALID',
    );
  }
  const expectedSha256 = normaliseSha256(expected.sha256);
  const expectedContentType = expected.contentType.trim().toLowerCase();
  if (
    !expectedSha256
    || !expectedContentType
    || !Number.isSafeInteger(expected.sizeBytes)
    || expected.sizeBytes < 1
    || expected.sizeBytes > 100 * 1024 * 1024
  ) {
    throw new ApiError(
      'This governed document record is incomplete. Sync the job and try again.',
      409,
      'WORK_PACK_DOCUMENT_BINDING_INVALID',
    );
  }
  const init: RequestInit = { method: 'GET' };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: await authenticatedHeaders(init, user),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({
      error: 'The governed document could not be downloaded.',
    })) as Record<string, unknown>;
    throw new ApiError(
      String(body.error || 'The governed document could not be downloaded.'),
      response.status,
      String(body.code || 'WORK_PACK_DOCUMENT_DOWNLOAD_FAILED'),
    );
  }
  const responseSha256 = normaliseSha256(
    response.headers.get('x-creditex-sha256') || '',
  );
  const integrityReceipt = (
    response.headers.get('x-creditex-custody-receipt') || ''
  ).trim();
  const contentType = (response.headers.get('content-type') || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  const contentLength = Number(response.headers.get('content-length') || '');
  const retainedSize = Number(response.headers.get('x-creditex-size-bytes') || '');
  if (
    responseSha256 !== expectedSha256
    || !integrityReceipt
    || integrityReceipt.length > 500
    || contentType !== expectedContentType
    || contentLength !== expected.sizeBytes
    || retainedSize !== expected.sizeBytes
  ) {
    throw new ApiError(
      'The governed document did not match its approved record.',
      409,
      'WORK_PACK_DOCUMENT_HEADERS_MISMATCH',
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = await governedReferenceDocumentBytesSha256(bytes);
  if (bytes.byteLength !== expected.sizeBytes || actualSha256 !== expectedSha256) {
    throw new ApiError(
      'The governed document bytes did not match the approved record.',
      409,
      'WORK_PACK_DOCUMENT_BYTES_MISMATCH',
    );
  }
  return Object.freeze({
    bytes,
    contentType,
    sha256: actualSha256,
    integrityReceipt,
  });
}
