import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, apiRequest, publicApiRequest } from '@/lib/api';
import {
  accessStateForServerError,
  approvedAccess,
  checkingAccess,
  networkVerificationRequired,
  signedOutAccess,
  type FieldAccessState,
} from '@/lib/access';
import { firebaseAuth, firebaseSignOut } from '@/lib/auth';
import { registerBackgroundSync, unregisterBackgroundSync } from '@/lib/background';
import {
  addUpload,
  getJob,
  listJobs,
  prepareLocalDataOwner,
  purgeLocalData,
  queueAction,
  queueCounts,
} from '@/lib/database';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import { forgetPushToken, getDeviceId, getDeviceName, rememberPushToken } from '@/lib/device';
import type { EvidenceCaptureEnvelope } from '@/lib/evidence';
import {
  clearFieldSession,
  getFieldPrincipal,
  getFieldSessionToken,
  saveFieldSession,
  updateFieldPrincipalDisplayName,
  type FieldPrincipal,
} from '@/lib/field-session';
import { localSyncOutcome, resolveFieldAccessModes, runSync, verifyFieldAccess, type SyncOutcome } from '@/lib/sync';
import type { FieldAccessMode, FieldJob, OfflineAction } from '@/lib/types';

type UploadInput = {
  workOrderId: string;
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: string;
  caption: string;
  evidenceEnvelope: Omit<EvidenceCaptureEnvelope, 'integrity'>;
  clearSettingKey?: string;
};

type AppValue = {
  user: FieldPrincipal | null;
  loading: boolean;
  access: FieldAccessState;
  jobs: FieldJob[];
  sync: SyncOutcome & { running: boolean; online: boolean };
  refreshLocal: () => Promise<void>;
  syncNow: () => Promise<void>;
  findJob: (id: string) => Promise<FieldJob | null>;
  saveAction: (action: Omit<OfflineAction, 'clientActionId'>) => Promise<void>;
  saveUpload: (input: UploadInput) => Promise<void>;
  pinSignIn: (displayName: string, pin: string) => Promise<void>;
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
const NETWORK_STATUS_TIMEOUT_MS = 1_500;

async function networkAvailable() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), NETWORK_STATUS_TIMEOUT_MS);
  });
  const state = await Promise.race([NetInfo.fetch().catch(() => null), fallback]);
  if (timeout) clearTimeout(timeout);
  if (!state) return true;
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function shouldRevalidateFieldAccess(error: unknown): error is ApiError {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}

function isConfirmedFieldAccessLoss(error: unknown): error is ApiError {
  return error instanceof ApiError && (
    (error.status === 401 && error.code === 'AUTH_REQUIRED')
    || (error.status === 403 && error.code === 'FIELD_ACCESS_REQUIRED')
  );
}

function firebasePrincipal(user: FirebaseUser): FieldPrincipal {
  return {
    ownerId: user.uid,
    memberId: user.uid,
    displayName: user.displayName || user.email || 'Installer team member',
    email: user.email || '',
    businessName: '',
    permissions: {
      canCreateJobs: false,
      canManageCustomers: false,
      canViewCustomers: false,
    },
    authMode: 'firebase',
    localOwnerKey: `firebase:${user.uid}`,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FieldPrincipal | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<FieldAccessState>(signedOutAccess);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [sync, setSync] = useState(emptySync);

  const refreshLocal = useCallback(async () => {
    setJobs(await listJobs());
    const local = await localSyncOutcome();
    setSync((value) => ({ ...value, ...local }));
  }, []);

  const handleAccessError = useCallback(async (error: unknown) => {
    if (!shouldRevalidateFieldAccess(error)) return false;
    let confirmedLoss: ApiError;
    try {
      await apiRequest('/api/field/access');
      return false;
    } catch (accessError) {
      if (!isConfirmedFieldAccessLoss(accessError)) return false;
      confirmedLoss = accessError;
    }
    await purgeLocalData();
    await forgetPushToken().catch(() => undefined);
    await clearFieldSession();
    await firebaseSignOut().catch(() => undefined);
    const nextAccess = accessStateForServerError(
      confirmedLoss.status,
      confirmedLoss.code,
      confirmedLoss.message,
    );
    setAccess(nextAccess);
    setJobs([]);
    setSync((value) => ({
      ...value,
      running: false,
      queuedActions: 0,
      queuedUploads: 0,
      conflicts: 0,
      updateRequired: '',
      message: nextAccess.message,
    }));
    return true;
  }, []);

  const syncNow = useCallback(async () => {
    const fieldPrincipal = await getFieldPrincipal();
    const currentUser = firebaseAuth.currentUser;
    if (!fieldPrincipal && !currentUser) return;
    const localOwnerKey = fieldPrincipal?.localOwnerKey || `firebase:${currentUser!.uid}`;
    const online = await networkAvailable();
    if (!online) {
      const local = await prepareLocalDataOwner(localOwnerKey)
        .then(() => localSyncOutcome())
        .catch(() => ({
          ...emptySync,
          message: 'Reconnect so TLink can prepare secure field work on this device.',
        }));
      setSync((value) => ({ ...value, ...local, running: false, online: false }));
      setAccess((value) => value.status === 'approved' ? value : networkVerificationRequired);
      return;
    }
    setSync((value) => ({ ...value, running: true, online: true, message: 'Syncing secure field work...' }));
    try {
      const verified = await verifyFieldAccess();
      if (fieldPrincipal && verified.fieldUsername) {
        const updatedPrincipal = await updateFieldPrincipalDisplayName(verified.fieldUsername);
        if (updatedPrincipal) setUser(updatedPrincipal);
      }
      setAccess(approvedAccess);
      await prepareLocalDataOwner(localOwnerKey);
      const result = await runSync(verified.modes);
      setSync((value) => ({ ...value, ...result, running: false, online: true }));
      setJobs(await listJobs());
      setAccess(approvedAccess);
    } catch (error) {
      if (await handleAccessError(error)) return;
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
      setAccess((value) => value.status === 'approved' ? value : networkVerificationRequired);
    }
  }, [handleAccessError]);

  useEffect(() => onAuthStateChanged(firebaseAuth, async (nextUser) => {
    const fieldPrincipal = await getFieldPrincipal();
    const nextPrincipal = fieldPrincipal || (nextUser ? firebasePrincipal(nextUser) : null);
    setUser(nextPrincipal);
    if (!nextPrincipal) {
      setJobs([]);
      setSync(emptySync);
      setAccess(signedOutAccess);
      setLoading(false);
      return;
    }
    setJobs([]);
    setAccess(checkingAccess);
    setLoading(false);
    void registerBackgroundSync().catch(() => undefined);
    void syncNow();
  }), [syncNow]);

  const signedIn = Boolean(user);

  useEffect(() => {
    const network = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      setSync((value) => ({ ...value, online }));
      if (online && signedIn) void syncNow();
    });
    const response = Notifications.addNotificationResponseReceivedListener(() => { void syncNow(); });
    const token = Notifications.addPushTokenListener(async (nextToken) => {
      if (!signedIn) return;
      await rememberPushToken(String(nextToken.data));
      const modes = await resolveFieldAccessModes().catch(() => []);
      const deviceId = await getDeviceId();
      void Promise.allSettled(modes.map((mode) =>
        apiRequest(mode === 'creditex_manual'
          ? '/api/creditex/manual-field/devices'
          : '/api/trade-team/devices', {
          method: 'POST',
          body: JSON.stringify({
            deviceId,
            platform: MOBILE_PLATFORM,
            appVersion: APP_VERSION,
            deviceName: getDeviceName(),
            isPhysicalDevice: Device.isDevice,
            pushToken: String(nextToken.data),
            pushProvider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm',
          }),
        }).catch((error) => { void handleAccessError(error); })
      ));
    });
    return () => { network(); response.remove(); token.remove(); };
  }, [handleAccessError, signedIn, syncNow]);

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
      evidenceEnvelope: input.evidenceEnvelope,
      clearSettingKey: input.clearSettingKey,
    });
    await refreshLocal();
    if (sync.online) void syncNow();
  }, [refreshLocal, sync.online, syncNow]);

  const pinSignIn = useCallback(async (displayName: string, pin: string) => {
    const response = await publicApiRequest<{
      token: string;
      principal: Omit<FieldPrincipal, 'authMode' | 'localOwnerKey'>;
    }>('/api/field/session', {
      method: 'POST',
      body: JSON.stringify({
        displayName,
        pin,
        deviceId: await getDeviceId(),
        platform: MOBILE_PLATFORM,
        appVersion: APP_VERSION,
        deviceName: getDeviceName(),
      }),
    });
    const principal = await saveFieldSession(response.token, response.principal);
    setUser(principal);
    setAccess(checkingAccess);
    setLoading(false);
    void registerBackgroundSync().catch(() => undefined);
    void syncNow();
  }, [syncNow]);

  const signOut = useCallback(async () => {
    await unregisterBackgroundSync().catch(() => undefined);
    const fieldToken = await getFieldSessionToken();
    if (fieldToken) {
      await apiRequest('/api/field/session', { method: 'DELETE' }).catch(() => undefined);
    } else {
      const modes = await resolveFieldAccessModes().catch(() => (
        ['trade_team', 'creditex_manual'] satisfies FieldAccessMode[]
      ));
      const deviceId = await getDeviceId();
      await Promise.allSettled(modes.map((mode) =>
        mode === 'creditex_manual'
          ? apiRequest('/api/creditex/manual-field/devices', {
            method: 'DELETE',
            body: JSON.stringify({ deviceId }),
          })
          : apiRequest('/api/trade-team/devices', {
            method: 'POST',
            body: JSON.stringify({
              deviceId,
              platform: MOBILE_PLATFORM,
              appVersion: APP_VERSION,
              deviceName: getDeviceName(),
              pushToken: '',
              pushProvider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm',
            }),
          })
      ));
    }
    await Notifications.unregisterForNotificationsAsync()
      .catch(() => undefined);
    await purgeLocalData();
    await forgetPushToken();
    await clearFieldSession();
    await firebaseSignOut();
    setUser(null);
    setAccess(signedOutAccess);
  }, []);

  const value = useMemo<AppValue>(() => ({
    user,
    loading,
    access,
    jobs,
    sync,
    refreshLocal,
    syncNow,
    findJob: getJob,
    saveAction,
    saveUpload,
    pinSignIn,
    signOut,
  }), [user, loading, access, jobs, sync, refreshLocal, syncNow, saveAction, saveUpload, pinSignIn, signOut]);

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
