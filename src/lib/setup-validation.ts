/** Shared validation used by the public first-run form and its API. */
export const MIN_ADMIN_PASSWORD_LENGTH = 10;

/**
 * Require a reasonably strong password because completing setup exposes the
 * admin sign-in endpoint to the public internet. Ten characters plus three
 * character classes keeps the rule understandable while rejecting common
 * weak passwords.
 */
export function isStrongAdminPassword(password: string): boolean {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return false;
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  return classes >= 3;
}

export function isValidSetupEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
