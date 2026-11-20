/**
 * Account areas — which part of the platform a User account belongs to.
 *
 *  - customer — business owners (role CLIENT), incl. shadow accounts
 *  - partner  — Growth Partners (role GROWTH_PARTNER), /partner-login
 *  - staff    — Super Admins and Content Studio team members, /admin-login
 *
 * The same person can hold one account in EACH area with the same email or
 * mobile number (e.g. a customer who also becomes a Growth Partner). Email
 * and phone are unique per role at the database level (see the compound
 * indexes in models/User.ts) and per area in the app checks below.
 *
 * So every lookup of a User by email or phone must say which area it means —
 * otherwise it can pick up the same person's account from another area.
 */

export type AccountArea = 'customer' | 'partner' | 'staff';

const PARTNER_ROLES = ['GROWTH_PARTNER'];
const STAFF_ROLES = ['SUPER_ADMIN', 'TEAM_MEMBER'];
const NON_CUSTOMER_ROLES = [...PARTNER_ROLES, ...STAFF_ROLES];

/**
 * Mongo filter that limits a User query to one area. Spread it into the query:
 *   User.findOne({ email, ...areaFilter('customer') })
 * The customer filter is "not partner and not staff" so an old document with
 * no stored role still counts as a customer (role defaults to CLIENT).
 */
export function areaFilter(area: AccountArea): { role: { $in: string[] } | { $nin: string[] } } {
  if (area === 'partner') return { role: { $in: PARTNER_ROLES } };
  if (area === 'staff') return { role: { $in: STAFF_ROLES } };
  return { role: { $nin: NON_CUSTOMER_ROLES } };
}

export function areaOfRole(role: string | null | undefined): AccountArea {
  if (role && PARTNER_ROLES.includes(role)) return 'partner';
  if (role && STAFF_ROLES.includes(role)) return 'staff';
  return 'customer';
}

/** The forgot-password page's `context` value (?context=partner|admin) → area. */
export function areaFromLoginContext(context: unknown): AccountArea {
  if (context === 'partner') return 'partner';
  if (context === 'admin' || context === 'staff') return 'staff';
  return 'customer';
}
