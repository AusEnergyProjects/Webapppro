import * as SecureStore from 'expo-secure-store';

import type { FieldPrincipal } from '@/lib/field-session';

const BUSINESS_SESSION_KEY = 'tlink.business-session.v1';

export type BusinessChoice = {
  ownerUid: string;
  businessName: string;
  role: 'owner' | 'member';
  memberId: string;
  displayName: string;
  managerName?: string;
  manualOnly?: boolean;
};

type BusinessSession = { firebaseUid: string; business: BusinessChoice; principal: FieldPrincipal };
let paused = false;
let revision = 0;
let sessionIdentity = '';
let businessWrites: Promise<unknown> = Promise.resolve();

function writeBusinessSession<T>(operation: () => Promise<T>): Promise<T> {
  const result = businessWrites.then(operation, operation);
  businessWrites = result.then(() => undefined, () => undefined);
  return result;
}

export function businessSessionRevision() { return revision; }
export function pauseBusinessSession(value: boolean) { if (paused !== value) revision++; paused = value; }

export function businessPrincipal(firebaseUid: string, email: string, business: BusinessChoice): FieldPrincipal {
  return {
    ownerId: business.ownerUid,
    memberId: business.memberId || business.ownerUid,
    displayName: (business.role === 'owner' ? business.managerName?.trim() : '') || business.displayName || email,
    email,
    businessName: business.businessName,
    permissions: { canCreateJobs: false, canManageCustomers: false, canViewCustomers: false },
    authMode: 'firebase',
    localOwnerKey: business.manualOnly ? `firebase:${encodeURIComponent(firebaseUid)}:compliance`
      : `firebase:${encodeURIComponent(firebaseUid)}:${encodeURIComponent(business.ownerUid)}:${encodeURIComponent(business.role === 'owner' ? 'owner' : business.memberId)}`,
  };
}

export async function getBusinessSession(firebaseUid: string, includePaused = false): Promise<BusinessSession | null> {
  if (paused && !includePaused) return null;
  const raw = await SecureStore.getItemAsync(BUSINESS_SESSION_KEY);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as BusinessSession;
    if (saved.firebaseUid !== firebaseUid || !saved.business?.ownerUid || !saved.business.businessName
      || !['owner', 'member'].includes(saved.business.role)
      || (saved.business.role === 'member' && !saved.business.memberId)
      || saved.principal?.localOwnerKey !== businessPrincipal(firebaseUid, saved.principal?.email || '', saved.business).localOwnerKey) return null;
    return saved;
  } catch { return null; }
}

export function saveBusinessSession(firebaseUid: string, business: BusinessChoice, principal: FieldPrincipal, isCurrent?: () => boolean) {
  return writeBusinessSession(async () => {
    if (isCurrent && !isCurrent()) throw new Error('Your account changed. Reopen your business.');
    const identity = `${firebaseUid}:${principal.localOwnerKey}`;
    if (sessionIdentity !== identity) { revision++; sessionIdentity = identity; }
    await SecureStore.setItemAsync(BUSINESS_SESSION_KEY, JSON.stringify({ firebaseUid, business, principal }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
}

export function updateBusinessPersonalName(firebaseUid: string, expectedOwnerKey: string, name: string, isCurrent: () => boolean) {
  return writeBusinessSession(async () => {
    const saved = await getBusinessSession(firebaseUid);
    if (!saved || saved.principal.localOwnerKey !== expectedOwnerKey || paused || !isCurrent()) {
      throw new Error('Your business changed. Reopen Account to update your name.');
    }
    const business: BusinessChoice = saved.business.role === 'owner'
      ? { ...saved.business, managerName: name }
      : { ...saved.business, displayName: name };
    const principal = { ...saved.principal, displayName: name || saved.business.businessName };
    await SecureStore.setItemAsync(BUSINESS_SESSION_KEY, JSON.stringify({ firebaseUid, business, principal }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return principal;
  });
}

export function clearBusinessSession() {
  revision++; sessionIdentity = '';
  return writeBusinessSession(async () => {
    sessionIdentity = '';
    await SecureStore.deleteItemAsync(BUSINESS_SESSION_KEY);
  });
}
