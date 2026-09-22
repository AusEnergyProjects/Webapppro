export const MFA_REQUIRED_MESSAGE = "Set up or verify your authenticator before accessing this workspace. Open Account security to continue.";
export const MFA_SETUP_URL = "/direct-trade/security";

export function isMfaRequiredResponse(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "code" in value && value.code === "MFA_REQUIRED");
}

export class FirebaseMfaRequiredError extends Error {
  readonly code = "MFA_REQUIRED";
  readonly status = 403;
  readonly setupUrl = MFA_SETUP_URL;

  constructor() {
    super("MFA_REQUIRED");
    this.name = "FirebaseMfaRequiredError";
  }
}

/** Only call with the firebase claim from a cryptographically verified ID token. */
export function firebaseSecondFactorClaim(firebase: unknown): string {
  if (!firebase || typeof firebase !== "object" || !("sign_in_second_factor" in firebase)) return "";
  const factor = firebase.sign_in_second_factor;
  return factor === "totp" || factor === "phone" ? factor : "";
}

export function requireSecondFactor(identity: { secondFactor?: string } | null | undefined): void {
  if (identity?.secondFactor !== "totp" && identity?.secondFactor !== "phone") {
    throw new FirebaseMfaRequiredError();
  }
}
