/**
 * Single source of truth for the public company / contact identity used across
 * the legal pages (privacy, terms, refund, contact) and the footer.
 */
export const COMPANY = {
  name: 'Growwmatics AI',
  // The registered legal entity that owns/operates the GrowwMatics AI brand —
  // distinct from the product name above. Used on legal pages, billing, and
  // invoices wherever the underlying legal entity (not just the brand) needs
  // to be named.
  legalName: 'Mulsetu Agrotech Private Limited',
  // Corporate Identity Number (MCA). Companies (Incorporation) Rules 2014,
  // r.26: a company's website must show its name, registered office and CIN.
  cin: 'U47990MH2024PTC429632',
  // Permanent Account Number and Tax Deduction and Collection Account Number,
  // as issued by the Income Tax Department. PAN goes on invoices (customers
  // deducting TDS need it); TAN is the company's own TDS number.
  pan: 'AASCM3695C',
  tan: 'NSKM16602F',
  // Not registered under GST yet. While null, invoices are titled "Invoice",
  // charge no GST and say so. Set the GSTIN here once registered — invoices
  // then become "Tax Invoice" (services/billing/companyInvoice.ts).
  gstin: null as string | null,
  domain: 'growwmatics.com',
  siteUrl: 'https://growwmatics.com',
  supportEmail: 'support@growwmatics.com',
  // Registered office of the legal entity above, as given by the company.
  address: 'G No 2427/215, Sanjiwani, Ngr, Nr Petrol Pump, Ozar, Upnagar, Nashik, Nashik - 422206, Maharashtra' as string,
} as const;

/** "GrowwMatics AI is a product of Mulsetu Agrotech Private Limited." — the one
 *  brand-attribution line to place sparingly (footer, legal, billing,
 *  invoices, auth pages) per product requirements. Not for repeated/heavy use. */
export const BRAND_ATTRIBUTION = `${COMPANY.name} is a product of ${COMPANY.legalName}.`;

/** Human-readable "last updated" date shown on the legal pages. */
export const LEGAL_LAST_UPDATED = 'July 2026';
