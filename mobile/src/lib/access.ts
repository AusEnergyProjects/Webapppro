export type FieldAccessStatus = 'signed_out' | 'checking' | 'approved' | 'pending' | 'denied';

export type FieldAccessState = {
  status: FieldAccessStatus;
  code: string;
  title: string;
  message: string;
  guidance: string;
};

export const signedOutAccess: FieldAccessState = {
  status: 'signed_out',
  code: '',
  title: 'Sign in required',
  message: 'Enter the name and PIN created for you in TLink.',
  guidance: '',
};

export const checkingAccess: FieldAccessState = {
  status: 'checking',
  code: '',
  title: 'Checking trade access',
  message: 'Confirming this account with the secure TLink service.',
  guidance: 'Keep this device connected while the approval check completes.',
};

export const approvedAccess: FieldAccessState = {
  status: 'approved',
  code: '',
  title: 'Trade access approved',
  message: 'This account can use protected field work.',
  guidance: '',
};

export const networkVerificationRequired: FieldAccessState = {
  status: 'pending',
  code: 'NETWORK_VERIFICATION_REQUIRED',
  title: 'Connect to verify access',
  message: 'TLink Field must confirm this account with TLink before protected work can open.',
  guidance: 'Reconnect, then choose Check access again.',
};

const PENDING_CODES = new Set([
  'ABN_REVIEW_REQUIRED',
  'EMAIL_VERIFICATION_REQUIRED',
  'PROFILE_REQUIRED',
  'TEAM_ACCESS_RECORD_REQUIRED',
]);

export function accessStateForServerError(status: number, code: string, serverMessage: string): FieldAccessState {
  const normalisedCode = code.trim().toUpperCase();
  if (normalisedCode === 'EMAIL_VERIFICATION_REQUIRED') {
    return {
      status: 'pending',
      code: normalisedCode,
      title: 'Verify your work email',
      message: serverMessage || 'The work email must be verified before field access can open.',
      guidance: 'Complete the Firebase verification email, then choose Check access again.',
    };
  }
  if (normalisedCode === 'PROFILE_REQUIRED') {
    return {
      status: 'pending',
      code: normalisedCode,
      title: 'Complete the trade account',
      message: serverMessage || 'A trade business profile is required before field access can open.',
      guidance: 'The business owner must complete the TLink trade application with a valid ABN.',
    };
  }
  if (normalisedCode === 'ABN_REVIEW_REQUIRED') {
    return {
      status: 'pending',
      code: normalisedCode,
      title: 'Business approval pending',
      message: serverMessage || 'The trade account has not completed authorised ABN review.',
      guidance: 'The business owner must supply a valid ABN and wait for an authorised TLink review.',
    };
  }
  if (normalisedCode === 'TEAM_ACCESS_RECORD_REQUIRED' || status === 404) {
    return {
      status: 'pending',
      code: normalisedCode || 'TEAM_ACCESS_RECORD_REQUIRED',
      title: 'Team access pending',
      message: serverMessage || 'No active installer team access was found for this account.',
      guidance: 'Ask the approved business owner to add or reactivate this work email, then check again.',
    };
  }
  if (PENDING_CODES.has(normalisedCode)) {
    return {
      status: 'pending',
      code: normalisedCode,
      title: 'Access review pending',
      message: serverMessage || 'This account is waiting for an access requirement to be completed.',
      guidance: 'Complete the requested TLink review step, then choose Check access again.',
    };
  }
  return {
    status: 'denied',
    code: normalisedCode || (status === 401 ? 'AUTH_REQUIRED' : 'ACCESS_DENIED'),
    title: status === 401 ? 'Secure sign-in not accepted' : 'Field access unavailable',
    message: serverMessage || 'This account cannot use protected field work.',
    guidance: status === 401
      ? 'Sign out, then sign in again with the authorised work account.'
      : 'Contact the approved business owner or TLink administrator before trying again.',
  };
}
