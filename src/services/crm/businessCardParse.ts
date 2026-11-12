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
  '- Phone numbers: if ANY digit is blurry or ambiguous (e.g. 1/7, 3/8, 5/6, 0/8), still return your best reading but add "phones" to uncertain. Never drop or add digits.',
  '- If the whole photo is too blurry to read the name or any contact, return empty fields rather than guesses.',
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

// ── Auto-save (no confirmation step) ─────────────────────────────────────
// Cards captured in quick / offline mode are read and saved without the
// owner checking the form. These rules decide what goes into the lead and
// whether it is flagged "Check details" for the owner to look at later.

export interface AutoSaveLead {
  name: string;
  phone: string | null;
  email: string | null;
  otherPhones: string[];
  otherEmails: string[];
  needsReview: boolean;
}

const isE164 = (p: string) => /^\+\d{8,15}$/.test(p);

export function leadFromCard(f: CardFields): AutoSaveLead {
  const phones = f.phones.map((p) => p.number);
  const phone = phones.find(isE164) ?? null;
  const email = f.emails[0] ?? null;
  const unsure = f.uncertain.some((u) => u === 'name' || u === 'phones' || u === 'emails');
  return {
    // No printed name → company, then the number, so the lead is still findable.
    name: f.name || f.company || phone || email || 'Visiting card',
    phone,
    email,
    otherPhones: phones.filter((p) => p !== phone),
    otherEmails: f.emails.filter((e) => e !== email),
    needsReview: unsure || !f.name || (!phone && !email) || phones.some((p) => !isE164(p)),
  };
}

/** Client-generated id of one captured card (offline queue) — makes retries idempotent. */
export function isValidClientScanId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

// ── Photo sharpness (logged next to the AI result to tune the app's blur warning) ──
// Same measure as the app's lib/sharpness.ts: variance of the Laplacian per tile
// over the centre 70% of a 640px-wide grayscale image, 2nd-best tile.
export function tiledSharpness(gray: ArrayLike<number>, w: number, h: number, cols = 6, rows = 4, centre = 0.7): number {
  if (w < 8 || h < 8) return 0;
  const cx0 = Math.floor((w * (1 - centre)) / 2);
  const cy0 = Math.floor((h * (1 - centre)) / 2);
  const tw = Math.max(2, Math.floor(Math.floor(w * centre) / cols));
  const th = Math.max(2, Math.floor(Math.floor(h * centre) / rows));
  const scores: number[] = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.max(1, cx0 + tx * tw);
      const y0 = Math.max(1, cy0 + ty * th);
      const x1 = Math.min(w - 1, x0 + tw);
      const y1 = Math.min(h - 1, y0 + th);
      let n = 0;
      let sum = 0;
      let sq = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
          sum += l;
          sq += l * l;
          n++;
        }
      }
      if (n) scores.push(sq / n - (sum / n) ** 2);
    }
  }
  scores.sort((a, b) => b - a);
  return scores[1] ?? scores[0] ?? 0;
}
