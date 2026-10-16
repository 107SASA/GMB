/** Stored on a shadow account until a real person name is known. */
export const PLACEHOLDER_PERSON_NAME = 'New User';

/**
 * A name safe to store on User.fullName.
 * Rejects the shadow placeholder, a bare phone number, and the business
 * name (that belongs on the business, not the person).
 */
export function usablePersonName(value: unknown, businessName?: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return '';
  if (name.toLowerCase() === PLACEHOLDER_PERSON_NAME.toLowerCase()) return '';
  if (/^\+?\d[\d\s-]{7,}$/.test(name)) return '';
  if (businessName && name.toLowerCase() === businessName.trim().toLowerCase()) return '';
  return name;
}

/**
 * For admin lists: the person's name, else what does identify them
 * (business name, then phone), so a shadow account never reads "New User".
 */
export function displayPersonName(fullName: unknown, ...fallbacks: Array<string | null | undefined>): string {
  return usablePersonName(fullName) || fallbacks.map((f) => (f || '').trim()).find(Boolean) || 'Unnamed';
}
