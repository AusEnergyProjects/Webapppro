import * as SecureStore from 'expo-secure-store';

const FIELD_TOKEN_KEY = 'aea.field.session-token.v1';
const FIELD_PRINCIPAL_KEY = 'aea.field.principal.v1';
let fieldWrites: Promise<unknown> = Promise.resolve();

// Clear, sign-in and name changes must finish in order. A delayed name write
// must never restore a principal after logout or overwrite the next login.
function writeFieldSession<T>(operation: () => Promise<T>): Promise<T> {
  const result = fieldWrites.then(operation, operation);
  fieldWrites = result.then(() => undefined, () => undefined);
  return result;
}

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

export function saveFieldSession(token: string, principal: Omit<FieldPrincipal, 'authMode' | 'localOwnerKey'>) {
  const saved: FieldPrincipal = {
    ...principal,
    authMode: 'field_pin',
    localOwnerKey: `field:${principal.ownerId}:${principal.memberId}`,
  };
  return writeFieldSession(async () => {
    await SecureStore.setItemAsync(FIELD_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await SecureStore.setItemAsync(FIELD_PRINCIPAL_KEY, JSON.stringify(saved), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return saved;
  });
}

export function updateFieldPrincipalDisplayName(displayName: string, expectedOwnerKey: string, isCurrent: () => boolean) {
  return writeFieldSession(async () => {
    const principal = await getFieldPrincipal();
    if (!principal || principal.authMode !== 'field_pin' || principal.localOwnerKey !== expectedOwnerKey || !isCurrent()) {
      throw new Error('Your account changed. Reopen Account to update your name.');
    }
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName || principal.displayName === nextDisplayName) return null;
    const updated = { ...principal, displayName: nextDisplayName };
    await SecureStore.setItemAsync(FIELD_PRINCIPAL_KEY, JSON.stringify(updated), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return updated;
  });
}

export function clearFieldSession() {
  return writeFieldSession(async () => { await Promise.all([
    SecureStore.deleteItemAsync(FIELD_TOKEN_KEY),
    SecureStore.deleteItemAsync(FIELD_PRINCIPAL_KEY),
  ]); });
}
