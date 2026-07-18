import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest } from '@/lib/api';
import { firebaseAuth, firebaseSignOut } from '@/lib/auth';
import { registerBackgroundSync, unregisterBackgroundSync } from '@/lib/background';
import {
  addUpload,
  getJob,
  listJobs,
  purgeLocalData,
  queueAction,
  queueCounts,
} from '@/lib/database';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import { forgetPushToken, getDeviceId, getDeviceName, rememberPushToken } from '@/lib/device';
import { localSyncOutcome, runSync, type SyncOutcome } from '@/lib/sync';
import type { FieldJob, OfflineAction } from '@/lib/types';

type UploadInput = {
  workOrderId: string;
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: string;
  caption: string;
};

type AppValue = {
  user: User | null;
  loading: boolean;
  jobs: FieldJob[];
  sync: SyncOutcome & { running: boolean; online: boolean };
  refreshLocal: () => Promise<void>;
  syncNow: () => Promise<void>;
  findJob: (id: string) => Promise<FieldJob | null>;
  saveAction: (action: Omit<OfflineAction, 'clientActionId'>) => Promise<void>;
  saveUpload: (input: UploadInput) => Promise<void>;
  signOut: () => Promise<void>;
};

const emptySync: AppValue['sync'] = {
  running: false,
  online: true,
  lastSyncedAt: '',
  queuedActions: 0,
  queuedUploads: 0,
  conflicts: 0,
  updateRequired: '',
  message: 'Preparing secure field work...',
};

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [sync, setSync] = useState(emptySync);

  const refreshLocal = useCallback(async () => {
    setJobs(await listJobs());
    const local = await localSyncOutcome();
    setSync((value) => ({ ...value, ...local }));
  }, []);

  const syncNow = useCallback(async () => {
    if (!firebaseAuth.currentUser) return;
    const network = await NetInfo.fetch();
    const online = network.isConnected !== false && network.isInternetReachable !== false;
    if (!online) {
      const local = await localSyncOutcome();
      setSync((value) => ({ ...value, ...local, online: false }));
      return;
    }
    setSync((value) => ({ ...value, running: true, online: true, message: 'Syncing secure field work...' }));
    try {
      const result = await runSync();
      setSync((value) => ({ ...value, ...result, running: false, online: true }));
      setJobs(await listJobs());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync paused. Saved work remains on this device.';
      const counts = await queueCounts().catch(() => ({ actions: 0, uploads: 0, conflicts: 0 }));
      setSync((value) => ({
        ...value,
        running: false,
        online: true,
        queuedActions: counts.actions,
        queuedUploads: counts.uploads,
        conflicts: counts.conflicts,
        message,
      }));
    }
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, async (nextUser) => {
    setUser(nextUser);
    if (!nextUser) {
      setJobs([]);
      setSync(emptySync);
      setLoading(false);
      return;
    }
    try {
      await registerBackgroundSync();
      await refreshLocal();
      await syncNow();
    } finally {
      setLoading(false);
    }
  }), [refreshLocal, syncNow]);

  useEffect(() => {
    const network = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      setSync((value) => ({ ...value, online }));
      if (online && firebaseAuth.currentUser) void syncNow();
    });
    const response = Notifications.addNotificationResponseReceivedListener(() => { void syncNow(); });
    const token = Notifications.addPushTokenListener(async (nextToken) => {
      if (!firebaseAuth.currentUser) return;
      await rememberPushToken(String(nextToken.data));
      void apiRequest('/api/trade-team/devices', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: await getDeviceId(),
          platform: MOBILE_PLATFORM,
          appVersion: APP_VERSION,
          deviceName: getDeviceName(),
          pushToken: String(nextToken.data),
          pushProvider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm',
        }),
      }).catch(() => undefined);
    });
    return () => { network(); response.remove(); token.remove(); };
  }, [syncNow]);

  const saveAction = useCallback(async (action: Omit<OfflineAction, 'clientActionId'>) => {
    await queueAction({ ...action, clientActionId: `act-${Crypto.randomUUID()}` });
    await refreshLocal();
    if (sync.online) await syncNow();
  }, [refreshLocal, sync.online, syncNow]);

  const saveUpload = useCallback(async (input: UploadInput) => {
    await addUpload({
      id: `upload-${Crypto.randomUUID()}`,
      work_order_id: input.workOrderId,
      local_uri: input.uri,
      file_name: input.fileName,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      category: input.category,
      caption: input.caption,
    });
    await refreshLocal();
    if (sync.online) void syncNow();
  }, [refreshLocal, sync.online, syncNow]);

  const signOut = useCallback(async () => {
    await unregisterBackgroundSync().catch(() => undefined);
    await apiRequest('/api/trade-team/devices', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: await getDeviceId(),
        platform: MOBILE_PLATFORM,
        appVersion: APP_VERSION,
        deviceName: getDeviceName(),
        pushToken: '',
        pushProvider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm',
      }),
    }).catch(() => undefined);
    await purgeLocalData();
    await forgetPushToken();
    await firebaseSignOut();
  }, []);

  const value = useMemo<AppValue>(() => ({
    user,
    loading,
    jobs,
    sync,
    refreshLocal,
    syncNow,
    findJob: getJob,
    saveAction,
    saveUpload,
    signOut,
  }), [user, loading, jobs, sync, refreshLocal, syncNow, saveAction, saveUpload, signOut]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider.');
  return value;
}

export function readableAuthError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('invalid-credential')) return 'The email or password is not correct.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Wait a little and try again.';
  if (code.includes('network-request-failed')) return 'No connection. Sign in again when reception returns.';
  return 'Sign in could not be completed. Check the details and try again.';
}
