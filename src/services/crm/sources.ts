/**
 * Customer CRM lead sources — one canonical list (pure, runs under `node --test`).
 * Every customer-CRM creation path maps its input through canonicalSource()
 * so analytics and ROI attribution never see free-form source strings.
 */

export const CUSTOMER_LEAD_SOURCES = [
  'WhatsApp',
  'Google Business Profile',
  'Phone Call',
  'Website',
  'Manual',
  'Instagram',
  'Facebook',
  'Referral',
  'Contacts Import',
  'CSV Import',
  'Campaign Import',
  'Appointment',
] as const;
export type CustomerLeadSource = (typeof CUSTOMER_LEAD_SOURCES)[number];

/**
 * Sources where the person reached out to the business themselves. Only these
 * alert the owner on WhatsApp when the lead is created (a CSV of 200 rows must
 * not produce 200 alerts).
 */
export const ORGANIC_SOURCES: ReadonlySet<CustomerLeadSource> = new Set<CustomerLeadSource>([
  'WhatsApp', 'Google Business Profile', 'Phone Call', 'Website', 'Instagram', 'Facebook',
]);

const ALIASES: Record<string, CustomerLeadSource> = {
  whatsapp: 'WhatsApp',
  'google business profile': 'Google Business Profile',
  gbp: 'Google Business Profile',
  'phone call': 'Phone Call',
  phone: 'Phone Call',
  call: 'Phone Call',
  website: 'Website',
  web: 'Website',
  manual: 'Manual',
  instagram: 'Instagram',
  facebook: 'Facebook',
  referral: 'Referral',
  'contacts import': 'Contacts Import',
  contacts: 'Contacts Import',
  'csv import': 'CSV Import',
  csv: 'CSV Import',
  import: 'CSV Import',
  'campaign import': 'Campaign Import',
  campaign: 'Campaign Import',
  appointment: 'Appointment',
};

export function canonicalSource(input: unknown, fallback: CustomerLeadSource = 'Manual'): CustomerLeadSource {
  if (typeof input !== 'string') return fallback;
  const exact = CUSTOMER_LEAD_SOURCES.find((s) => s === input);
  if (exact) return exact;
  return ALIASES[input.trim().toLowerCase()] ?? fallback;
}
