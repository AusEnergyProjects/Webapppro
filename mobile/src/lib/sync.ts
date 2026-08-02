import { ApiError, apiRequest } from '@/lib/api';
import { firebaseAuth, firebaseSignOut } from '@/lib/auth';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import {
  applyChanges,
  getSetting,
  prepareLocalDataOwner,
  purgeExpiredAddresses,
  queueCounts,
  queuedActions,
  resolveAction,
  setSetting,
} from '@/lib/database';
import { deviceRegistration, forgetPushToken, getDeviceId } from '@/lib/device';
import type { FieldAccessMode, OfflineAction, SyncResponse } from '@/lib/types';
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

function isFieldAccessMode(value: unknown): value is FieldAccessMode {
  return value === 'trade_team' || value === 'creditex_manual';
}

export async function resolveFieldAccessModes() {
  const response = await apiRequest<{ mode: FieldAccessMode; modes?: FieldAccessMode[] }>('/api/field/access');
  const modes = [...new Set((response.modes?.length ? response.modes : [response.mode])
    .filter(isFieldAccessMode))];
  if (!modes.length) {
    throw new ApiError('No active field access was returned.', 403, 'FIELD_ACCESS_REQUIRED');
  }
  await setSetting('field_access_mode', modes[0]);
  return modes;
}

export async function resolveFieldAccessMode() {
  const [mode] = await resolveFieldAccessModes();
  if (!mode) {
    throw new ApiError('No active field access was returned.', 403, 'FIELD_ACCESS_REQUIRED');
  }
  return mode;
}

function cursorSetting(mode: FieldAccessMode) {
  return `sync_cursor_${mode}`;
}

function actionForServer(row: { payload: string }) {
  const serverAction = { ...(JSON.parse(row.payload) as OfflineAction) };
  delete serverAction.fieldLane;
  return serverAction;
}

function devicePath(mode: FieldAccessMode) {
  return mode === 'creditex_manual'
    ? '/api/creditex/manual-field/devices'
    : '/api/trade-team/devices';
}

function syncPath(mode: FieldAccessMode) {
  return mode === 'creditex_manual'
    ? '/api/creditex/manual-field/sync'
    : '/api/trade-team/sync';
}

async function registerDevice(mode: FieldAccessMode) {
  const registration = await deviceRegistration();
  await apiRequest(devicePath(mode), {
    method: 'POST',
    body: JSON.stringify(registration),
  });
}

async function sendActions(mode: FieldAccessMode) {
  const rows = await queuedActions(mode);
  if (!rows.length) return;
  const actions = rows.map(actionForServer);
  const response = await apiRequest<{
    results: { clientActionId: string; status: string; code?: string; error?: string; retryAfterSeconds?: number }[];
  }>(syncPath(mode), {
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

async function fetchChanges(mode: FieldAccessMode) {
  const setting = cursorSetting(mode);
  let cursor = await getSetting(setting);
  let hasMore = true;
  while (hasMore) {
    const params = new URLSearchParams({
      deviceId: await getDeviceId(),
      platform: MOBILE_PLATFORM,
      appVersion: APP_VERSION,
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);
    const response = await apiRequest<SyncResponse>(`${syncPath(mode)}?${params}`);
    await applyChanges(response.changes, response.bootstrap, response.serverTime, mode);
    cursor = response.nextCursor;
    await setSetting(setting, cursor);
    hasMore = response.hasMore;
  }
}

async function revokedSignOut() {
  await forgetPushToken();
  await firebaseSignOut();
}

async function performSync(): Promise<SyncOutcome> {
  const currentUser = firebaseAuth.currentUser;
  if (!currentUser) throw new ApiError('Sign in to continue.', 401, 'AUTH_REQUIRED');
  await prepareLocalDataOwner(currentUser.uid);
  try {
    const modes = await resolveFieldAccessModes();
    await purgeExpiredAddresses();
    for (const mode of modes) {
      await registerDevice(mode);
      await sendActions(mode);
      await processUploadQueue(mode);
      await fetchChanges(mode);
    }
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
