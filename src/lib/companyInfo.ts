/**
 * Single source of truth for the public company / contact identity used across
 * the legal pages (privacy, terms, refund, contact) and the footer.
 */
export const COMPANY = {
  name: 'GrowwMatics AI',
  // The registered legal entity that owns/operates the GrowwMatics AI brand —
  // distinct from the product name above. Used on legal pages, billing, and
  // invoices wherever the underlying legal entity (not just the brand) needs
  // to be named.
  legalName: 'Desun Technology Pvt. Ltd.',
  domain: 'growwmatics.com',
  siteUrl: 'https://growwmatics.com',
  supportEmail: 'support@growwmatics.com',
  address: '11th Floor, Room No - 1104, Ambuja Neotia Eco Station, BP Block, Sector V, Bidhannagar, Kolkata, West Bengal 700091',
} as const;

/** "GrowwMatics AI is a product of Desun Technology Pvt. Ltd." — the one
 *  brand-attribution line to place sparingly (footer, legal, billing,
 *  invoices, auth pages) per product requirements. Not for repeated/heavy use. */
export const BRAND_ATTRIBUTION = `${COMPANY.name} is a product of ${COMPANY.legalName}.`;

/** Human-readable "last updated" date shown on the legal pages. */
export const LEGAL_LAST_UPDATED = 'July 2026';
