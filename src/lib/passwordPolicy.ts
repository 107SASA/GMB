/**
 * Single source of truth for password complexity rules across the whole
 * app (signup, reset-password, change-password — website and mobile all
 * hit the same API routes, which import from here).
 *
 * Deliberately zero server-only dependencies (no bcryptjs/jsonwebtoken) so
 * it can be imported directly into client components. Before this file
 * existed, the same regex set was hand-copied into three places
 * (forgot-password/page.tsx, StepPassword.tsx, and
 * services/auth/security.ts) with a comment promising to "keep in sync
 * manually" — that drift is exactly how the Profile → Change Password form
 * ended up enforcing a much weaker rule (any digit-or-symbol, no
 * upper/lowercase requirement) than every other password entry point.
 */

export interface PasswordCheck {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

export function checkPasswordStrength(password: string): PasswordCheck {
  return {
    minLength: password.length >= 8,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const c = checkPasswordStrength(password);
  return c.minLength && c.hasUpper && c.hasLower && c.hasNumber && c.hasSpecial;
}

/** Returns the first unmet rule as a user-facing message, or null if valid. */
export function getPasswordError(password: string): string | null {
  const c = checkPasswordStrength(password);
  if (!c.minLength) return 'Password must be at least 8 characters long.';
  if (!c.hasUpper) return 'Password must contain an uppercase letter.';
  if (!c.hasLower) return 'Password must contain a lowercase letter.';
  if (!c.hasNumber) return 'Password must contain a number.';
  if (!c.hasSpecial) return 'Password must contain a special character.';
  return null;
}

/** Same shape `services/auth/security.ts` previously exposed — kept for callers that want {isValid, error}. */
export function validatePasswordStrength(password: string): { isValid: boolean; error?: string } {
  const error = getPasswordError(password);
  return error ? { isValid: false, error } : { isValid: true };
}
