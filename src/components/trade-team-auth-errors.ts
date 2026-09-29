export function teamAuthErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}

export function teamAuthErrorMessage(error: unknown): string {
  switch (teamAuthErrorCode(error)) {
    case "auth/email-already-in-use":
      return "This email already has a login. Continue with Google, sign in, or choose Reset password to set a new password by email.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password with at least 8 characters, including letters and numbers.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email or password was not recognised. Try again, or choose Reset password.";
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/network-request-failed": return "The connection was interrupted. Check your internet connection and try again.";
    case "auth/too-many-requests": return "Too many attempts. Please wait a few minutes, then try again.";
    case "auth/user-disabled": return "This login has been disabled. Ask your business administrator for help.";
    case "auth/popup-blocked": return "Your browser blocked Google sign-in. Allow the sign-in window and try again, or use your email.";
    case "auth/popup-closed-by-user": return "Google sign-in was closed. Try again, or use your email.";
    case "auth/operation-not-allowed": return "This sign-in method is unavailable. Try Google sign-in or contact your business administrator.";
    default: return "Sign-in could not be completed. Please try again. If it continues, contact your business administrator.";
  }
}
