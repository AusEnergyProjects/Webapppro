import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';

import { ApiError, apiRequest, publicApiRequest } from '@/lib/api';
import { businessPrincipal, clearBusinessSession, getBusinessSession, pauseBusinessSession, saveBusinessSession, updateBusinessPersonalName, type BusinessChoice } from '@/lib/business-session';
import { subscribeAllRentalSaves } from '@/lib/rental-save-queue';
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
  assertLocalDataOwner,
  getLocalDataOwner,
  getJob,
  listJobs,
  legacyLocalWork,
  migrateLegacyLocalOwner,
  prepareLocalDataOwner,
  purgeLocalData,
  queueAction,
  queueCounts,
} from '@/lib/database';
import { APP_VERSION, MOBILE_PLATFORM } from '@/lib/config';
import { deviceRegistration, forgetPushToken, getDeviceId, getDeviceName, getRememberedPushToken, notificationDeviceState, rememberPushToken, requestNotificationPermissionOnce } from '@/lib/device';
import { disableNativeCalls, subscribeNativeCallToken } from '@/lib/native-system-calls';
import type { EvidenceCaptureEnvelope } from '@/lib/evidence';
import {
  clearFieldSession,
  getFieldPrincipal,
  getFieldSessionToken,
  saveFieldSession,
  updateFieldPrincipalDisplayName,
  type FieldPrincipal,
} from '@/lib/field-session';
import { localSyncOutcome, resolveFieldAccessModes, runSync, verifyFieldAccess, waitForActiveSync, type SyncOutcome } from '@/lib/sync';
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
  saveActionInBackground: (action: Omit<OfflineAction, 'clientActionId'>) => Promise<void>;
  saveUpload: (input: UploadInput) => Promise<void>;
  pinSignIn: (displayName: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
  updatePersonalName: (name: string) => Promise<string>;
  waitForNotificationRegistrations: () => Promise<void>;
  businesses: BusinessChoice[];
  choosingBusiness: boolean;
  businessError: string;
  chooseBusiness: (choice: BusinessChoice) => Promise<void>;
  openBusinessChooser: () => Promise<void>;
  cancelBusinessChooser: () => void;
  retryBusinesses: () => Promise<void>;
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

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FieldPrincipal | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<FieldAccessState>(signedOutAccess);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [sync, setSync] = useState(emptySync);
  const [businesses, setBusinesses] = useState<BusinessChoice[]>([]);
  const [choosingBusiness, setChoosingBusiness] = useState(false);
  const [businessError, setBusinessError] = useState('');
  const switching = useRef(false);
  const selecting = useRef(false);
  const localWrites = useRef(0);
  const authGeneration = useRef(0);
  const notificationRegistrations = useRef(new Set<Promise<void>>());

  const waitForNotificationRegistrations = useCallback(async () => {
    await waitForActiveSync().catch(() => undefined);
    await Promise.allSettled([...notificationRegistrations.current]);
  }, []);

  const stopNotificationRegistration = useCallback(async () => {
    DeviceEventEmitter.emit('tlink:call-identity-invalidated');
    await Promise.allSettled([...notificationRegistrations.current]);
    await disableNativeCalls();
  }, []);

  const refreshLocal = useCallback(async () => {
    const generation = authGeneration.current;
    const nextJobs = await listJobs();
    const local = await localSyncOutcome();
    if (generation !== authGeneration.current || switching.current) return;
    setJobs(nextJobs);
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
    switching.current = true;
    authGeneration.current++;
    await stopNotificationRegistration();
    await purgeLocalData();
    await forgetPushToken().catch(() => undefined);
    await clearFieldSession();
    await clearBusinessSession();
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
  }, [stopNotificationRegistration]);

  const syncNow = useCallback(async () => {
    if (switching.current) return;
    const fieldPrincipal = await getFieldPrincipal();
    const currentUser = firebaseAuth.currentUser;
    if (!fieldPrincipal && !currentUser) return;
    const business = currentUser ? await getBusinessSession(currentUser.uid) : null;
    const principal = fieldPrincipal || business?.principal;
    if (!principal || switching.current) return;
    const generation = authGeneration.current;
    const localOwnerKey = principal.localOwnerKey;
    const online = await networkAvailable();
    if (generation !== authGeneration.current || switching.current) return;
    if (!online) {
      const local = await prepareLocalDataOwner(localOwnerKey)
        .then(() => localSyncOutcome())
        .catch(() => ({
          ...emptySync,
          message: 'Reconnect so TLink can prepare secure field work on this device.',
        }));
      if (generation !== authGeneration.current || switching.current) return;
      setSync((value) => ({ ...value, ...local, running: false, online: false }));
      setAccess((value) => value.status === 'approved' ? value : networkVerificationRequired);
      return;
    }
    setSync((value) => ({ ...value, running: true, online: true, message: 'Syncing secure field work...' }));
    try {
      const verified = await verifyFieldAccess(principal.localOwnerKey);
      if (generation !== authGeneration.current || switching.current) return;
      if (fieldPrincipal && verified.displayName) {
        const updatedPrincipal = await updateFieldPrincipalDisplayName(verified.displayName, localOwnerKey,
          () => generation === authGeneration.current && !switching.current);
        if (generation !== authGeneration.current || switching.current) return;
        if (updatedPrincipal) setUser(updatedPrincipal);
      }
      if (!fieldPrincipal && currentUser && business) {
        if (!business.business.manualOnly && verified.ownerUid !== principal.ownerId) {
          throw new ApiError('Business access changed. Choose your business again.', 403, 'BUSINESS_ACCESS_REQUIRED');
        }
        const updated = { ...principal, memberId: verified.memberId || principal.memberId,
          businessName: verified.businessName || principal.businessName,
          displayName: verified.displayName || principal.displayName,
          permissions: verified.permissions || principal.permissions };
        await saveBusinessSession(currentUser.uid, business.business, updated,
          () => generation === authGeneration.current && !switching.current && firebaseAuth.currentUser?.uid === currentUser.uid);
        if (generation !== authGeneration.current || switching.current) return;
        setUser(updated);
      }
      setAccess(approvedAccess);
      await prepareLocalDataOwner(localOwnerKey);
      const result = await runSync(verified.modes);
      if (generation !== authGeneration.current || switching.current) return;
      setSync((value) => ({ ...value, ...result, running: false, online: true }));
      setJobs(await listJobs());
      setAccess(approvedAccess);
    } catch (error) {
      if (generation !== authGeneration.current || switching.current) return;
      if (error instanceof ApiError && error.code.startsWith('BUSINESS_')) {
        switching.current = true;
        await stopNotificationRegistration();
        pauseBusinessSession(true);
        await unregisterBackgroundSync().catch(() => undefined);
        setAccess(checkingAccess);
        setChoosingBusiness(true);
        setBusinessError(error.message);
        setJobs([]);
        return;
      }
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
  }, [handleAccessError, stopNotificationRegistration]);

  const activateBusiness = useCallback(async (identity: FirebaseUser, choice: BusinessChoice) => {
    const principal = businessPrincipal(identity.uid, identity.email || '', choice);
    const legacy = await legacyLocalWork(identity.uid);
    if (legacy) {
      if (legacy.lanes.some(lane => lane !== (choice.manualOnly ? 'creditex_manual' : 'trade_team'))) {
        throw new Error('This phone has saved work in more than one workspace. The files are retained; contact TLink support before changing business.');
      }
      for (let start = 0; start < legacy.workOrderIds.length; start += 500) {
        const proof = await apiRequest<{ ownerUid: string; memberId: string }>('/api/trade-businesses/restore-cache', {
          method: 'POST', body: JSON.stringify({ ownerUid: choice.ownerUid, workOrderIds: legacy.workOrderIds.slice(start, start + 500) }),
        }, identity);
        if (proof.ownerUid !== choice.ownerUid || (choice.role !== 'owner' && proof.memberId !== choice.memberId)) {
          throw new Error('The saved work belongs to a different business. Choose that business to finish syncing.');
        }
      }
      await migrateLegacyLocalOwner(identity.uid, principal.localOwnerKey);
    }
    const previous = await getBusinessSession(identity.uid, true);
    if (previous && previous.business.ownerUid !== choice.ownerUid && !previous.business.manualOnly) {
      await stopNotificationRegistration();
      // A fresh app launch also needs to retire the last business's push delivery.
      pauseBusinessSession(false);
      try {
        await apiRequest('/api/trade-team/devices', { method: 'POST', body: JSON.stringify({
          deviceId: await getDeviceId(), platform: MOBILE_PLATFORM, appVersion: APP_VERSION,
          deviceName: getDeviceName(), pushToken: '', pushProvider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm',
          voipPushToken: '', nativeCallCapable: false,
        }) });
      } catch (error) {
        // Revoked membership cannot receive authorised push delivery or unregister its old device.
        if (!(error instanceof ApiError && [401, 403].includes(error.status))) throw error;
      } finally { pauseBusinessSession(true); }
      await Notifications.dismissAllNotificationsAsync();
      await Notifications.clearLastNotificationResponseAsync();
    }
    await prepareLocalDataOwner(principal.localOwnerKey);
    await saveBusinessSession(identity.uid, choice, principal);
    pauseBusinessSession(false);
    switching.current = false;
    setChoosingBusiness(false);
    setBusinessError('');
    setUser(principal);
    setJobs([]);
    setAccess(checkingAccess);
    await registerBackgroundSync().catch(() => undefined);
    void syncNow();
  }, [stopNotificationRegistration, syncNow]);

  const loadBusinesses = useCallback(async (identity: FirebaseUser) => {
    switching.current = true;
    pauseBusinessSession(true);
    setLoading(true);
    setBusinessError('');
    setAccess(checkingAccess);
    await unregisterBackgroundSync().catch(() => undefined);
    await waitForActiveSync().catch(() => undefined);
    try {
      const result = await apiRequest<{ businesses: BusinessChoice[] }>('/api/trade-businesses', {}, identity);
      if (firebaseAuth.currentUser?.uid !== identity.uid) return;
      setBusinesses(result.businesses);
      if (result.businesses.length === 1) await activateBusiness(identity, result.businesses[0]);
      else if (!result.businesses.length) {
        // Existing assigned compliance-only accounts retain their separate field lane.
        await activateBusiness(identity, { ownerUid: `compliance:${identity.uid}`, memberId: identity.uid,
          businessName: 'Compliance work', displayName: identity.displayName || identity.email || 'Team member', role: 'member', manualOnly: true });
      } else setChoosingBusiness(true);
    } catch (error) {
      setChoosingBusiness(true);
      setBusinessError(error instanceof Error ? error.message : 'Reconnect to choose your business.');
    } finally { setLoading(false); }
  }, [activateBusiness]);

  const chooseBusiness = useCallback(async (choice: BusinessChoice) => {
    const identity = firebaseAuth.currentUser;
    if (selecting.current || !identity || !businesses.some(item => item.ownerUid === choice.ownerUid && item.memberId === choice.memberId)) return;
    selecting.current = true;
    setLoading(true);
    try { await activateBusiness(identity, choice); }
    catch (error) { setBusinessError(error instanceof Error ? error.message : 'This business could not be opened.'); }
    finally { selecting.current = false; setLoading(false); }
  }, [activateBusiness, businesses]);

  const openBusinessChooser = useCallback(async () => {
    if (!firebaseAuth.currentUser || user?.authMode !== 'firebase' || switching.current) return;
    if (localWrites.current) { setBusinessError('Finish saving your current work before changing business.'); return; }
    setBusinessError('');
    switching.current = true;
    setAccess(checkingAccess);
    // Keep the old tenant header in place until its requests and device registration finish.
    await unregisterBackgroundSync().catch(() => undefined);
    try {
      await waitForActiveSync();
      const counts = await queueCounts();
      if (counts.actions || counts.uploads || counts.conflicts) throw new Error('Open Sync and finish or resolve your saved work before changing business.');
      await stopNotificationRegistration();
      await apiRequest('/api/trade-team/devices', { method: 'POST', body: JSON.stringify({
        deviceId: await getDeviceId(), platform: MOBILE_PLATFORM, appVersion: APP_VERSION,
        deviceName: getDeviceName(), pushToken: '', pushProvider: MOBILE_PLATFORM === 'ios' ? 'apns' : 'fcm',
        voipPushToken: '', nativeCallCapable: false,
      }) });
      await Notifications.dismissAllNotificationsAsync();
      await Notifications.clearLastNotificationResponseAsync();
      pauseBusinessSession(true);
      authGeneration.current++;
      setChoosingBusiness(true);
      setAccess(checkingAccess);
      setJobs([]);
      await loadBusinesses(firebaseAuth.currentUser);
    } catch (error) {
      switching.current = false;
      pauseBusinessSession(false);
      setAccess(approvedAccess);
      setBusinessError(error instanceof Error ? error.message : 'Business could not be changed. Try again.');
      await registerBackgroundSync().catch(() => undefined);
    }
  }, [loadBusinesses, stopNotificationRegistration, user?.authMode]);

  const cancelBusinessChooser = useCallback(() => {
    if (!user) return;
    pauseBusinessSession(false);
    switching.current = false;
    setChoosingBusiness(false);
    setBusinessError('');
    void registerBackgroundSync().catch(() => undefined);
    void syncNow();
  }, [syncNow, user]);

  const retryBusinesses = useCallback(async () => {
    if (firebaseAuth.currentUser) await loadBusinesses(firebaseAuth.currentUser);
  }, [loadBusinesses]);

  useEffect(() => {
    let disposed = false;
    let restoreOnUnlock = false;
    const restore = async (nextUser: FirebaseUser | null) => {
    const generation = ++authGeneration.current;
    // A VoIP push can launch the process while private field storage is locked.
    // Calls authenticate separately; restore the full workspace on foreground.
    if (AppState.currentState !== 'active') { restoreOnUnlock = true; return; }
    restoreOnUnlock = false;
    const fieldPrincipal = await getFieldPrincipal();
    if (disposed || generation !== authGeneration.current) return;
    if (!fieldPrincipal && nextUser) {
      setUser(null);
      setJobs([]);
      await loadBusinesses(nextUser);
      return;
    }
    setUser(fieldPrincipal);
    setChoosingBusiness(false);
    if (!fieldPrincipal) {
      switching.current = true;
      await Promise.allSettled([...notificationRegistrations.current]);
      if (generation !== authGeneration.current) return;
      await disableNativeCalls();
      if (generation !== authGeneration.current) return;
      switching.current = false;
      pauseBusinessSession(false);
      await clearBusinessSession();
      if (generation !== authGeneration.current) return;
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
    };
    const hydrate = async (nextUser: FirebaseUser | null) => {
      const expectedGeneration = authGeneration.current + 1;
      try { await restore(nextUser); }
      catch (error) {
        if (disposed || expectedGeneration !== authGeneration.current) return;
        restoreOnUnlock = true;
        setLoading(false);
        setAccess(networkVerificationRequired);
        setSync(value => ({ ...value, message: error instanceof Error ? error.message : 'Unlock your phone to open saved field work.' }));
      }
    };
    const unsubscribe = onAuthStateChanged(firebaseAuth, hydrate);
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active' && restoreOnUnlock) void hydrate(firebaseAuth.currentUser);
    });
    return () => { disposed = true; unsubscribe(); foreground.remove(); };
  }, [loadBusinesses, syncNow]);

  const signedIn = Boolean(user) && !choosingBusiness;

  const registerNotificationDevice = useCallback(async (options?: { pushToken?: string; refreshNativeCalls?: boolean }) => {
    if (!signedIn || access.status !== 'approved' || switching.current) return;
    const generation = authGeneration.current;
    const expectedBusinessKey = user?.localOwnerKey;
    const registration = (async () => {
      if (generation !== authGeneration.current || switching.current) return;
      const registration = await deviceRegistration(options);
      const modes = await resolveFieldAccessModes();
      if (generation !== authGeneration.current || switching.current) return;
      const results = await Promise.allSettled(modes.map(mode => apiRequest(mode === 'creditex_manual'
        ? '/api/creditex/manual-field/devices' : '/api/trade-team/devices', {
        method: 'POST', body: JSON.stringify(registration),
      }, undefined, { expectedBusinessKey })));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    })();
    notificationRegistrations.current.add(registration);
    try {
      await registration;
    } catch (error) {
      notificationRegistrations.current.delete(registration);
      if (generation !== authGeneration.current || switching.current) return;
      if (await handleAccessError(error)) return;
      setSync(value => ({ ...value, message: 'Notification registration failed. Open Account and retry notifications when connected.' }));
    } finally { notificationRegistrations.current.delete(registration); }
  }, [access.status, handleAccessError, signedIn, user?.localOwnerKey]);

  useEffect(() => {
    if (!signedIn || access.status !== 'approved') return;
    let cancelled = false;
    const generation = authGeneration.current;
    const prepare = async () => {
      if (AppState.currentState !== 'active' || switching.current) return;
      await requestNotificationPermissionOnce();
      if (!cancelled && generation === authGeneration.current && !switching.current) await registerNotificationDevice();
    };
    const request = () => void prepare().catch(() => {
      if (!cancelled) setSync(value => ({ ...value, message: 'Open Account to enable message and call notifications.' }));
    });
    request();
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') request(); });
    return () => { cancelled = true; foreground.remove(); };
  }, [access.status, registerNotificationDevice, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeAllRentalSaves(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refreshLocal(); }, 100);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [signedIn, refreshLocal]);

  useEffect(() => {
    const network = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      setSync((value) => ({ ...value, online }));
      if (online && signedIn) void syncNow();
    });
    const response = Notifications.addNotificationResponseReceivedListener(() => { void syncNow(); });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active' && signedIn) void syncNow();
    });
    const token = Notifications.addPushTokenListener(async (nextToken) => {
      if (!signedIn || switching.current) return;
      const generation = authGeneration.current;
      const state = await notificationDeviceState().catch(() => null);
      if (generation !== authGeneration.current || switching.current) return;
      const pushToken = state?.granted && !state.muted ? String(nextToken.data) : '';
      if (pushToken) await rememberPushToken(pushToken);
      else await forgetPushToken();
      if (generation !== authGeneration.current || switching.current) return;
      await registerNotificationDevice({ pushToken, refreshNativeCalls: false });
    });
    const nativeToken = subscribeNativeCallToken(() => {
      if (!signedIn || switching.current) return;
      const generation = authGeneration.current;
      void getRememberedPushToken().then(pushToken => {
        if (generation !== authGeneration.current || switching.current) return;
        return registerNotificationDevice({ pushToken, refreshNativeCalls: false });
      }).catch(() => undefined);
    });
    return () => { network(); response.remove(); foreground.remove(); token.remove(); nativeToken(); };
  }, [registerNotificationDevice, signedIn, syncNow]);

  const savedWorkOwner = useCallback(async () => {
    const expected = user?.localOwnerKey;
    if (switching.current || !expected) throw new Error('Choose your business before saving work.');
    const owner = await getLocalDataOwner();
    if (owner.key !== expected || switching.current) throw new Error('Your business changed. Reopen this job before saving.');
    return owner;
  }, [user?.localOwnerKey]);

  const saveAction = useCallback(async (action: Omit<OfflineAction, 'clientActionId'>) => {
    const owner = await savedWorkOwner();
    localWrites.current++;
    try {
      await queueAction({ ...action, clientActionId: `act-${Crypto.randomUUID()}` }, owner);
      assertLocalDataOwner(owner);
      await refreshLocal();
    } finally { localWrites.current--; }
    if (sync.online) await syncNow();
  }, [refreshLocal, savedWorkOwner, sync.online, syncNow]);

  const saveActionInBackground = useCallback(async (action: Omit<OfflineAction, 'clientActionId'>) => {
    const owner = await savedWorkOwner();
    localWrites.current++;
    try {
      await queueAction({ ...action, clientActionId: `act-${Crypto.randomUUID()}` }, owner);
      assertLocalDataOwner(owner);
      await refreshLocal();
    } finally { localWrites.current--; }
    if (sync.online) void syncNow();
  }, [refreshLocal, savedWorkOwner, sync.online, syncNow]);

  const saveUpload = useCallback(async (input: UploadInput) => {
    const owner = await savedWorkOwner();
    localWrites.current++;
    try {
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
      }, owner);
      assertLocalDataOwner(owner);
      await refreshLocal();
    } finally { localWrites.current--; }
    if (sync.online) void syncNow();
  }, [refreshLocal, savedWorkOwner, sync.online, syncNow]);

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
    switching.current = false;
    pauseBusinessSession(false);
    setChoosingBusiness(false);
    setUser(principal);
    setAccess(checkingAccess);
    setLoading(false);
    void registerBackgroundSync().catch(() => undefined);
    void syncNow();
  }, [syncNow]);

  const signOut = useCallback(async () => {
    DeviceEventEmitter.emit('tlink:call-identity-invalidated');
    switching.current = true;
    authGeneration.current++;
    await unregisterBackgroundSync().catch(() => undefined);
    await waitForActiveSync().catch(() => undefined);
    await stopNotificationRegistration();
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
              voipPushToken: '',
              nativeCallCapable: false,
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
    await clearBusinessSession();
    await firebaseSignOut();
    setUser(null);
    setAccess(signedOutAccess);
  }, [stopNotificationRegistration]);

  const updatePersonalName = useCallback(async (name: string) => {
    if (!user || switching.current) throw new Error('Open your business before updating your name.');
    const generation = authGeneration.current;
    const identityUid = firebaseAuth.currentUser?.uid;
    const isCurrent = () => generation === authGeneration.current && !switching.current
      && (user.authMode === 'field_pin' || firebaseAuth.currentUser?.uid === identityUid);
    const result = await apiRequest<{ ok: boolean; name: string; isOwner: boolean }>('/api/trade-personal-profile', {
      method: 'PATCH', body: JSON.stringify({ name }),
    }, undefined, { expectedBusinessKey: user.localOwnerKey });
    if (!isCurrent()) throw new Error('Your business changed. Reopen Account to update your name.');
    const displayName = result.name || user.businessName;
    if (user.authMode === 'field_pin') await updateFieldPrincipalDisplayName(displayName, user.localOwnerKey, isCurrent);
    else {
      if (!identityUid) throw new Error('Your business changed. Reopen Account to update your name.');
      await updateBusinessPersonalName(identityUid, user.localOwnerKey, result.name, isCurrent);
    }
    if (!isCurrent()) throw new Error('Your business changed. Reopen Account to update your name.');
    setUser(current => current?.localOwnerKey === user.localOwnerKey ? { ...current, displayName } : current);
    return result.name;
  }, [user]);

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
    saveActionInBackground,
    saveUpload,
    pinSignIn,
    signOut,
    updatePersonalName,
    waitForNotificationRegistrations,
    businesses, choosingBusiness, businessError, chooseBusiness, openBusinessChooser, cancelBusinessChooser, retryBusinesses,
  }), [user, loading, access, jobs, sync, refreshLocal, syncNow, saveAction, saveActionInBackground, saveUpload, pinSignIn, signOut, updatePersonalName,
    businesses, choosingBusiness, businessError, chooseBusiness, openBusinessChooser, cancelBusinessChooser, retryBusinesses, waitForNotificationRegistrations]);

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
