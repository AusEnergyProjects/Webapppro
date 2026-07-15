import { ApiError, apiRequest } from '@/lib/api';
import { firebaseAuth, firebaseSignOut } from '@/lib/auth';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import {
  applyChanges,
  getSetting,
  purgeExpiredAddresses,
  purgeLocalData,
  queueCounts,
  queuedActions,
  resolveAction,
  setSetting,
} from '@/lib/database';
import { deviceRegistration, forgetPushToken, getDeviceId } from '@/lib/device';
import type { OfflineAction, SyncResponse } from '@/lib/types';
import { processUploadQueue } from '@/lib/uploads';

let activeSync: Promise<SyncOutcome> | null = null;

export type SyncOutcome = {
  lastSyncedAt: string;
  queuedActions: number;
  queuedUploads: number;
  conflicts: number;
  updateRequired: string;
  message: string;
};

async function registerDevice() {
  const registration = await deviceRegistration();
  await apiRequest('/api/trade-team/devices', {
    method: 'POST',
    body: JSON.stringify(registration),
  });
}

async function sendActions() {
  const rows = await queuedActions();
  if (!rows.length) return;
  const actions = rows.map((row) => JSON.parse(row.payload) as OfflineAction);
  const response = await apiRequest<{
    results: { clientActionId: string; status: string; code?: string; error?: string; retryAfterSeconds?: number }[];
  }>('/api/trade-team/sync', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: await getDeviceId(),
      platform: MOBILE_PLATFORM,
      appVersion: APP_VERSION,
      actions,
    }),
  });
  for (const result of response.results) await resolveAction(result.clientActionId, result);
}

async function fetchChanges() {
  let cursor = await getSetting('sync_cursor');
  let hasMore = true;
  while (hasMore) {
    const params = new URLSearchParams({
      deviceId: await getDeviceId(),
      platform: MOBILE_PLATFORM,
      appVersion: APP_VERSION,
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);
    const response = await apiRequest<SyncResponse>(`/api/trade-team/sync?${params}`);
    await applyChanges(response.changes, response.bootstrap, response.serverTime);
    cursor = response.nextCursor;
    await setSetting('sync_cursor', cursor);
    hasMore = response.hasMore;
  }
}

async function revokedSignOut() {
  await purgeLocalData();
  await forgetPushToken();
  await firebaseSignOut();
}

async function performSync(): Promise<SyncOutcome> {
  if (!firebaseAuth.currentUser) throw new ApiError('Sign in to continue.', 401, 'AUTH_REQUIRED');
  try {
    await purgeExpiredAddresses();
    await registerDevice();
    await sendActions();
    await processUploadQueue();
    await fetchChanges();
    const lastSyncedAt = new Date().toISOString();
    await setSetting('last_synced_at', lastSyncedAt);
    const counts = await queueCounts();
    return {
      lastSyncedAt,
      queuedActions: counts.actions,
      queuedUploads: counts.uploads,
      conflicts: counts.conflicts,
      updateRequired: '',
      message: counts.conflicts ? 'Work is saved. Review the items that changed elsewhere.' : 'All field work is safely synced.',
    };
  } catch (error) {
    if (error instanceof ApiError && ['DEVICE_REVOKED', 'DEVICE_REAUTHORISATION_REQUIRED'].includes(error.code)) {
      await revokedSignOut();
      throw new ApiError('This device was signed out remotely. Its local work has been removed.', 403, 'DEVICE_REVOKED');
    }
    if (error instanceof ApiError && error.status === 426) {
      const counts = await queueCounts();
      return {
        lastSyncedAt: await getSetting('last_synced_at'),
        queuedActions: counts.actions,
        queuedUploads: counts.uploads,
        conflicts: counts.conflicts,
        updateRequired: error.minimumVersion || 'current',
        message: 'Update AEA Field before syncing. Your saved work is still secure on this device.',
      };
    }
    throw error;
  }
}

export function runSync() {
  activeSync ||= performSync().finally(() => { activeSync = null; });
  return activeSync;
}

export async function localSyncOutcome(message = 'Work is saved on this device and will sync when connected.') {
  const counts = await queueCounts();
  return {
    lastSyncedAt: await getSetting('last_synced_at'),
    queuedActions: counts.actions,
    queuedUploads: counts.uploads,
    conflicts: counts.conflicts,
    updateRequired: '',
    message,
  } satisfies SyncOutcome;
}
