/**
 * Visiting-card scan — pure rules (no imports; runs under `node --test`).
 *
 * The AI model returns loose JSON; everything that reaches the form or the
 * CRM passes through sanitizeCardExtraction() so the client only ever sees
 * clean, bounded strings. Phone normalization is injected (lib/phone.ts) so
 * this file stays dependency-free.
 */

export interface CardPhone {
  number: string;
  /** mobile | office | whatsapp | fax | other */
  label: string;
}

export interface CardFields {
  isBusinessCard: boolean;
  name: string;
  designation: string;
  company: string;
  phones: CardPhone[];
  emails: string[];
  website: string;
  address: string;
  city: string;
  /** Field names the model was unsure about (shown highlighted in the form). */
  uncertain: string[];
}

export const CARD_FIELD_NAMES = ['name', 'designation', 'company', 'phones', 'emails', 'website', 'address', 'city'] as const;

const PHONE_LABELS = new Set(['mobile', 'office', 'whatsapp', 'fax', 'other']);

/** JSON schema handed to Gemini (OpenAPI subset — `responseSchema`). */
export const CARD_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isBusinessCard: { type: 'BOOLEAN' },
    name: { type: 'STRING' },
    designation: { type: 'STRING' },
    company: { type: 'STRING' },
    phones: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          number: { type: 'STRING' },
          label: { type: 'STRING', enum: ['mobile', 'office', 'whatsapp', 'fax', 'other'] },
        },
        required: ['number', 'label'],
      },
    },
    emails: { type: 'ARRAY', items: { type: 'STRING' } },
    website: { type: 'STRING' },
    address: { type: 'STRING' },
    city: { type: 'STRING' },
    uncertain: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['isBusinessCard', 'name', 'company', 'phones', 'emails'],
} as const;

export const CARD_PROMPT = [
  'You read business / visiting cards (often Indian, may mix English and Hindi or other Indian languages).',
  'The image(s) show the front and possibly the back of ONE card. Extract the PERSON on the card.',
  'Rules:',
  '- Copy text exactly as printed; never invent or guess values. Use "" (or []) when a field is not on the card.',
  '- name: the person\'s name only (no title like "Mr."/"Dr." unless part of how it is printed). Write names in English letters.',
  '- designation: job title (e.g. "Sales Manager", "Proprietor"). company: business / firm name.',
  '- phones: every phone number with its label. "M", "Mob", "Cell" = mobile; "O", "Off", "Tel", landline with STD code = office; a WhatsApp icon = whatsapp. Keep the + and country code if printed.',
  '- emails: every email address, lowercase. website: the main website without "http://".',
  '- address: full postal address on one line. city: the city from the address.',
  '- uncertain: names of fields you could not read clearly (blurry, cut off, ambiguous).',
  '- isBusinessCard: false if the image is not a business/visiting card.',
].join('\n');

const clip = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function cleanWebsite(v: unknown): string {
  const s = clip(v, 300).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s) ? s.toLowerCase() : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turns the model's raw JSON into safe form fields. Phones are normalized to
 * E.164 when possible (unparseable ones are kept as printed, so the owner can
 * fix them), deduped, and ordered mobile-first so phones[0] is the best
 * primary number for the lead.
 */
export function sanitizeCardExtraction(raw: unknown, normalizePhone: (s: string) => string | null): CardFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const seenPhones = new Set<string>();
  const phones: CardPhone[] = [];
  for (const p of Array.isArray(r.phones) ? r.phones.slice(0, 8) : []) {
    const printed = clip((p as any)?.number, 40);
    if (!printed || !/\d{6,}/.test(printed.replace(/\D/g, ''))) continue;
    const number = normalizePhone(printed) ?? printed;
    const key = number.replace(/\D/g, '').slice(-10);
    if (seenPhones.has(key)) continue;
    seenPhones.add(key);
    const label = clip((p as any)?.label, 20).toLowerCase();
    phones.push({ number, label: PHONE_LABELS.has(label) ? label : 'other' });
  }
  const rank = (l: string) => ({ mobile: 0, whatsapp: 1, office: 2, other: 3, fax: 4 } as Record<string, number>)[l] ?? 3;
  phones.sort((a, b) => rank(a.label) - rank(b.label));

  const emails = Array.from(
    new Set(
      (Array.isArray(r.emails) ? r.emails : [])
        .map((e) => clip(e, 200).toLowerCase())
        .filter((e) => EMAIL_RE.test(e)),
    ),
  ).slice(0, 5);

  const uncertain = (Array.isArray(r.uncertain) ? r.uncertain : [])
    .map((u) => clip(u, 40))
    .filter((u): u is (typeof CARD_FIELD_NAMES)[number] => (CARD_FIELD_NAMES as readonly string[]).includes(u));

  return {
    isBusinessCard: r.isBusinessCard !== false,
    name: clip(r.name, 120),
    designation: clip(r.designation, 200),
    company: clip(r.company, 200),
    phones,
    emails,
    website: cleanWebsite(r.website),
    address: clip(r.address, 500),
    city: clip(r.city, 100),
    uncertain: Array.from(new Set(uncertain)),
  };
}

/** True when the scan found nothing a lead could be saved from. */
export function isEmptyExtraction(f: CardFields): boolean {
  return !f.name && !f.company && f.phones.length === 0 && f.emails.length === 0;
}

/** Whether the cheap model's result is weak enough to retry on the stronger one. */
export function needsFallback(f: CardFields): boolean {
  if (!f.isBusinessCard) return false; // a clear "not a card" is a real answer
  if (isEmptyExtraction(f)) return true;
  const contactUnsure = f.uncertain.includes('phones') || f.uncertain.includes('emails') || f.uncertain.includes('name');
  return contactUnsure || (f.phones.length === 0 && f.emails.length === 0);
}

/** A stored card-image key must belong to this business (never trust a client-sent key). */
export function isOwnCardImageKey(key: unknown, businessId: string): key is string {
  return typeof key === 'string' && key.startsWith(`business-cards/${businessId}/`) && !key.includes('..') && key.length < 300;
}

// ── Model choice ─────────────────────────────────────────────────────────
// Google retires Gemini models for new keys without notice (2.5 Flash /
// Flash-Lite answer 404 "no longer available to new users"), so the scanner
// does not hardcode a model: it lists what THIS key can call and picks the
// newest Flash-Lite (cheap reader) and newest Flash (stronger retry).

export interface GeminiModelInfo {
  name: string; // "models/gemini-3.8-flash"
  supportedGenerationMethods?: string[];
}

const MODEL_RE = /^(?:models\/)?gemini-(\d+(?:\.\d+)?)-flash(-lite)?(?:-(preview(?:-[\w-]+)?|\d{3}))?$/;

/** Newest stable Flash-Lite + Flash this key supports (preview only when no stable exists). */
export function pickCardModels(models: GeminiModelInfo[]): { primary: string | null; fallback: string | null } {
  const rows = models
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '');
      const r = MODEL_RE.exec(id);
      if (!r) return null;
      return { id, version: parseFloat(r[1]), lite: !!r[2], preview: (r[3] ?? '').startsWith('preview') };
    })
    .filter((r): r is { id: string; version: number; lite: boolean; preview: boolean } => !!r);

  const best = (lite: boolean): string | null => {
    const pool = rows.filter((r) => r.lite === lite);
    const stable = pool.filter((r) => !r.preview);
    const list = (stable.length ? stable : pool).sort((a, b) => b.version - a.version || a.id.length - b.id.length);
    return list[0]?.id ?? null;
  };
  const lite = best(true);
  const flash = best(false);
  return { primary: lite ?? flash, fallback: lite ? flash : null };
}
