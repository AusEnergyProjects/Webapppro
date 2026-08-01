type CreditexTokenUser = {
  uid: string;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type CreditexTokenRequestOptions<T> = {
  user: CreditexTokenUser;
  currentUid: () => string | undefined;
  request: (idToken: string) => Promise<T>;
  isUnauthorized: (result: T) => boolean;
};

function assertStableIdentity(
  user: CreditexTokenUser,
  currentUid: () => string | undefined,
) {
  if (currentUid() !== user.uid) {
    throw new Error("The signed-in account changed. Loading the new workspace.");
  }
}

export async function requestWithCreditexTokenRecovery<T>({
  user,
  currentUid,
  request,
  isUnauthorized,
}: CreditexTokenRequestOptions<T>) {
  const cachedToken = await user.getIdToken();
  assertStableIdentity(user, currentUid);

  const firstResult = await request(cachedToken);
  assertStableIdentity(user, currentUid);
  if (!isUnauthorized(firstResult)) return firstResult;

  const refreshedToken = await user.getIdToken(true);
  assertStableIdentity(user, currentUid);

  const retryResult = await request(refreshedToken);
  assertStableIdentity(user, currentUid);
  return retryResult;
}
