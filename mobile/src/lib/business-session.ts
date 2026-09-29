import * as SecureStore from 'expo-secure-store';

import type { FieldPrincipal } from '@/lib/field-session';

const BUSINESS_SESSION_KEY = 'tlink.business-session.v1';

export type BusinessChoice = {
  ownerUid: string;
  businessName: string;
  role: 'owner' | 'member';
  memberId: string;
  displayName: string;
  manualOnly?: boolean;
};

type BusinessSession = { firebaseUid: string; business: BusinessChoice; principal: FieldPrincipal };
let paused = false;
let revision = 0;
let sessionIdentity = '';

export function businessSessionRevision() { return revision; }
export function pauseBusinessSession(value: boolean) { if (paused !== value) revision++; paused = value; }

export function businessPrincipal(firebaseUid: string, email: string, business: BusinessChoice): FieldPrincipal {
  return {
    ownerId: business.ownerUid,
    memberId: business.memberId || business.ownerUid,
    displayName: business.displayName || email,
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

export async function saveBusinessSession(firebaseUid: string, business: BusinessChoice, principal: FieldPrincipal) {
  const identity = `${firebaseUid}:${principal.localOwnerKey}`;
  if (sessionIdentity !== identity) { revision++; sessionIdentity = identity; }
  await SecureStore.setItemAsync(BUSINESS_SESSION_KEY, JSON.stringify({ firebaseUid, business, principal }), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearBusinessSession() {
  revision++; sessionIdentity = '';
  await SecureStore.deleteItemAsync(BUSINESS_SESSION_KEY);
}
