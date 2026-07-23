/**
 * Single source of truth for the public company / contact identity used across
 * the legal pages (privacy, terms, refund, contact) and the footer.
 *
 * NOTE: `address` is a placeholder — replace it with the real registered
 * business address before relying on these pages for Razorpay / Google
 * verification.
 */
export const COMPANY = {
  name: 'Growwmatic AI',
  legalName: 'Growwmatic AI',
  domain: 'growwmatics.com',
  siteUrl: 'https://growwmatics.com',
  supportEmail: 'support@growwmatics.com',
  // TODO: replace with the real registered business address.
  address: '[REGISTERED BUSINESS ADDRESS — replace before launch]',
} as const;

/** Human-readable "last updated" date shown on the legal pages. */
export const LEGAL_LAST_UPDATED = 'July 2026';
