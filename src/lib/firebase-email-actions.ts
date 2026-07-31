import type { ActionCodeSettings } from "firebase/auth";

const CUSTOMER_ACCOUNT_PATH = "/account?verification=complete";

function emailVerificationSettings(
  origin: string,
  returnPath: string,
): ActionCodeSettings {
  const url = new URL(returnPath, origin);
  return {
    handleCodeInApp: false,
    url: url.toString(),
  };
}

export function customerEmailVerificationSettings(origin: string) {
  return emailVerificationSettings(origin, CUSTOMER_ACCOUNT_PATH);
}
