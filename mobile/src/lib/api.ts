import type { User } from 'firebase/auth';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';

import { API_BASE_URL, APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import { getDeviceId } from '@/lib/device';
import { firebaseAuth } from '@/lib/auth';
import { getFieldSessionToken } from '@/lib/field-session';

const JSON_REQUEST_TIMEOUT_MS = 20_000;

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
  return active.getIdToken(true);
}

async function authenticatedHeaders(init: RequestInit, user?: User | null) {
  const deviceId = await getDeviceId();
  const headers = new Headers(init.headers);
  const fieldToken = await getFieldSessionToken();
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

async function fetchJson(url: string, init: RequestInit) {
  if (init.signal) return fetch(url, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JSON_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(
        'TLink could not reach the secure service. Check reception and try again.',
        408,
        'NETWORK_TIMEOUT',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function governedReferenceDocumentBytesSha256(bytes: Uint8Array) {
  const exactBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(exactBytes).set(bytes);
  return bytesToHex(new Uint8Array(
    await digest(CryptoDigestAlgorithm.SHA256, exactBytes),
  ));
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, user?: User | null) {
  const headers = await authenticatedHeaders(init, user);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetchJson(`${API_BASE_URL}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' })) as Record<string, unknown>;
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
  const body = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' })) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(
    String(body.error || 'The request could not be completed.'),
    response.status,
    String(body.code || ''),
    String(body.minimumVersion || ''),
    body,
  );
  return body as T;
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
