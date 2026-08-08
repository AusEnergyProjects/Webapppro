import { createRemoteJWKSet, errors, jwtVerify } from "jose";

const FIREBASE_PROJECT_ID = "australian-energy-assessments";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export type FirebaseIdentity = {
  uid: string;
  email: string;
  emailVerified: boolean;
  authTime: number;
  signInProvider: string;
};

export class FirebaseAuthError extends Error {
  readonly code = "AUTH_REQUIRED";
  readonly status = 401;

  constructor() {
    super("AUTH_REQUIRED");
    this.name = "FirebaseAuthError";
  }
}

function isRejectedFirebaseCredential(error: unknown) {
  return error instanceof errors.JWTExpired
    || error instanceof errors.JWTClaimValidationFailed
    || error instanceof errors.JWTInvalid
    || error instanceof errors.JWSInvalid
    || error instanceof errors.JWSSignatureVerificationFailed
    || error instanceof errors.JOSEAlgNotAllowed
    || error instanceof errors.JOSENotSupported
    || error instanceof errors.JWKSNoMatchingKey;
}

async function verifyFirebaseToken(token: string) {
  try {
    return await jwtVerify(token, FIREBASE_KEYS, {
      issuer: FIREBASE_ISSUER,
      audience: FIREBASE_PROJECT_ID,
      algorithms: ["RS256"],
    });
  } catch (error) {
    if (isRejectedFirebaseCredential(error)) {
      throw new FirebaseAuthError();
    }
    throw error;
  }
}

export async function requireFirebaseIdentity(request: Request): Promise<FirebaseIdentity> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new FirebaseAuthError();

  const token = authorization.slice(7).trim();
  if (!token) throw new FirebaseAuthError();
  const { payload } = await verifyFirebaseToken(token);

  const uid = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!uid || !email) throw new FirebaseAuthError();

  const firebase = payload.firebase && typeof payload.firebase === "object"
    ? payload.firebase as Record<string, unknown>
    : {};
  return {
    uid,
    email,
    emailVerified: payload.email_verified === true,
    authTime: typeof payload.auth_time === "number" ? payload.auth_time : 0,
    signInProvider:
      typeof firebase.sign_in_provider === "string"
        ? firebase.sign_in_provider
        : "",
  };
}
