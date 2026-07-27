/**
 * Flexible CSV/spreadsheet column resolution — the same tolerant matching the
 * CRM lead importer uses (see src/app/api/crm/leads/import/route.ts). Header
 * lookups are case-insensitive, whitespace-trimmed and BOM-stripped, and accept
 * a list of aliases, so a file that imports fine in CRM ("Full Name", "Phone
 * Number", "Email Address", …) imports the same way everywhere else.
 */

/** Strip a leading UTF-8 BOM and trim/lowercase a header for comparison. */
function normalizeHeader(key: string): string {
  return key.replace(/^﻿/, '').trim().toLowerCase();
}

/**
 * Returns a getter over one parsed row. `get('name', 'full name', …)` returns
 * the first non-empty matching column value (trimmed), or '' if none match.
 */
export function makeColumnGetter(raw: Record<string, unknown>) {
  // Pre-map normalized header -> original key once per row.
  const normalized = new Map<string, string>();
  for (const original of Object.keys(raw)) {
    normalized.set(normalizeHeader(original), original);
  }
  return (...keys: string[]): string => {
    for (const k of keys) {
      const original = normalized.get(normalizeHeader(k));
      if (original !== undefined) {
        const value = raw[original];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return String(value).trim();
        }
      }
    }
    return '';
  };
}

/** Canonical alias lists shared by every contact/customer/lead importer. */
export const COLUMN_ALIASES = {
  name: ['name', 'full name', 'fullname', 'customer name', 'contact name', 'lead name'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact', 'contact number', 'whatsapp'],
  email: ['email', 'email address', 'e-mail'],
  service: ['service', 'product', 'course', 'interest'],
  date: ['date', 'service date', 'last visit'],
  tags: ['tags', 'tag'],
  notes: ['notes', 'note', 'comments', 'description'],
} as const;
