/**
 * Mirrors src/lib/passwordPolicy.ts on the website — same rule set, kept
 * here as a small standalone copy since the mobile app and the Next.js
 * backend are separate builds with no shared module path between them.
 * If you change one, change the other (this is the only pair left after
 * consolidating three website copies into one shared module — see that
 * file's comment for the bug this exact kind of drift caused).
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
