import * as SecureStore from 'expo-secure-store';

const FIELD_TOKEN_KEY = 'aea.field.session-token.v1';
const FIELD_PRINCIPAL_KEY = 'aea.field.principal.v1';

export type FieldPrincipal = {
  ownerId: string;
  memberId: string;
  displayName: string;
  email: string;
  businessName: string;
  permissions: {
    canCreateJobs: boolean;
    canManageCustomers: boolean;
    canViewCustomers: boolean;
  };
  authMode: 'field_pin' | 'firebase';
  localOwnerKey: string;
};

export async function getFieldSessionToken() {
  return (await SecureStore.getItemAsync(FIELD_TOKEN_KEY)) || '';
}

export async function getFieldPrincipal() {
  const stored = await SecureStore.getItemAsync(FIELD_PRINCIPAL_KEY);
  if (!stored) return null;
  try {
    const principal = JSON.parse(stored) as FieldPrincipal;
    if (!principal.ownerId || !principal.memberId || !principal.displayName) return null;
    return principal;
  } catch {
    return null;
  }
}

export async function saveFieldSession(token: string, principal: Omit<FieldPrincipal, 'authMode' | 'localOwnerKey'>) {
  const saved: FieldPrincipal = {
    ...principal,
    authMode: 'field_pin',
    localOwnerKey: `field:${principal.ownerId}:${principal.memberId}`,
  };
  await SecureStore.setItemAsync(FIELD_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(FIELD_PRINCIPAL_KEY, JSON.stringify(saved), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return saved;
}

export async function updateFieldPrincipalDisplayName(displayName: string) {
  const principal = await getFieldPrincipal();
  const nextDisplayName = displayName.trim();
  if (!principal || principal.authMode !== 'field_pin' || !nextDisplayName
    || principal.displayName === nextDisplayName) return principal;
  const updated = { ...principal, displayName: nextDisplayName };
  await SecureStore.setItemAsync(FIELD_PRINCIPAL_KEY, JSON.stringify(updated), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return updated;
}

export async function clearFieldSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(FIELD_TOKEN_KEY),
    SecureStore.deleteItemAsync(FIELD_PRINCIPAL_KEY),
  ]);
}
