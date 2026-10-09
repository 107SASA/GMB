/**
 * FR-5 validators and URL/hours/pin rules. Pure: no I/O, no `@/` imports.
 * A failing validation blocks execution. Unknown data is not treated as a value.
 */

export const DESCRIPTION_MAX = 750;
export const DESCRIPTION_LEAD = 250;
/** Pin vs geocoded address. Documented, not a Google requirement. */
export const PIN_MATCH_METERS = 100;
export const PIN_WARNING_METERS = 250;
export const SERVICE_AREA_MAX = 20;

export const PRODUCTS_SUPPORT = {
  supported: false as const,
  reason: 'This integration has no Google Business Profile endpoint for the product catalog. Products are not written.',
};

const PROMO = /\b(best|top|no\.?\s*1|number\s*1|number\s+one|#1|world[- ]class|guaranteed|guarantee|discount|cheapest|cheap|leading|premier|award[- ]winning|finest|trusted)\b/i;
const SHORT_LINK = /\b(?:https?:\/\/|www\.)?(?:bit\.ly|wa\.me|t\.me|goo\.gl|tinyurl\.com|t\.co|is\.gd|ow\.ly|cutt\.ly|rb\.gy|g\.co)\/?\S*/i;
const URLISH = /(https?:\/\/|www\.|\b[\w-]+\.(com|in|net|org|co|io)\b)/i;
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

export interface Violation {
  code: string;
  message: string;
}

export interface DescriptionValidation {
  length: number;
  first250Quality: boolean;
  containsUrl: boolean;
  promotionalLanguage: boolean;
  keywordStuffing: boolean;
  unsupportedClaims: boolean;
  valid: boolean;
  violations: Violation[];
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
}

/** Deterministic description from verified facts only. No links, prices, or rankings. */
export function draftDescription(input: { name: string; category: string; city: string; services: string[] }): string {
  const services = input.services.map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const lead = `${input.name.trim()} provides ${services[0] || input.category.trim() || 'local services'} in ${input.city.trim()}.`;
  const rest = services.length > 1 ? ` Services include ${services.join(', ')}.` : '';
  const text = `${lead}${rest}`.replace(/\s+/g, ' ').trim();
  return text.slice(0, DESCRIPTION_MAX);
}

export function validateDescription(
  text: string,
  facts: { tokens: string[]; allowedNumbers?: string[]; competitorNames?: string[] } = { tokens: [] },
): DescriptionValidation {
  const violations: Violation[] = [];
  const value = String(text || '');
  const lead = value.slice(0, DESCRIPTION_LEAD);
  const tokens = facts.tokens.map((t) => String(t).trim().toLowerCase()).filter((t) => t.length >= 3);
  const first250Quality = tokens.length === 0 ? false : tokens.some((t) => lead.toLowerCase().includes(t));
  const containsUrl = URLISH.test(value) || SHORT_LINK.test(value);
  const promotionalLanguage = PROMO.test(value);
  const counts = new Map<string, number>();
  for (const w of words(value)) counts.set(w, (counts.get(w) || 0) + 1);
  const keywordStuffing = [...counts.values()].some((n) => n >= 4);
  const numbers = value.match(/\d+(?:\.\d+)?/g) || [];
  const allowed = new Set(facts.allowedNumbers || []);
  const unsupportedNumber = numbers.some((n) => !allowed.has(n));
  const names = (facts.competitorNames || []).map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 4);
  const namesCompetitor = names.some((n) => value.toLowerCase().includes(n));
  const unsupportedClaims = unsupportedNumber || namesCompetitor;
  if (!value.trim()) violations.push({ code: 'empty', message: 'Description is empty.' });
  if (value.length > DESCRIPTION_MAX) violations.push({ code: 'length', message: `Description is ${value.length} characters. The maximum is ${DESCRIPTION_MAX}.` });
  if (!first250Quality) violations.push({ code: 'first250', message: 'The first 250 characters do not contain a verified service, category, or city.' });
  if (containsUrl) violations.push({ code: 'url', message: 'Descriptions cannot contain a link.' });
  if (promotionalLanguage) violations.push({ code: 'promo', message: 'Promotional language is not allowed.' });
  if (keywordStuffing) violations.push({ code: 'stuffing', message: 'A word is repeated too often.' });
  if (unsupportedClaims) violations.push({ code: 'unsupported', message: 'The text contains a number or competitor name that was not verified.' });
  return {
    length: value.length,
    first250Quality,
    containsUrl,
    promotionalLanguage,
    keywordStuffing,
    unsupportedClaims,
    valid: violations.length === 0,
    violations,
  };
}

export interface NameValidation {
  valid: boolean;
  requiresExplicitApproval: true;
  violations: Violation[];
}

export function validateBusinessName(
  current: string,
  proposed: string,
  context: { city?: string | null; services?: string[]; category?: string | null } = {},
): NameValidation {
  const violations: Violation[] = [];
  const next = proposed.trim().replace(/\s+/g, ' ');
  const prev = current.trim().replace(/\s+/g, ' ');
  if (!next) violations.push({ code: 'empty', message: 'Business name cannot be empty.' });
  if (PROMO.test(next)) violations.push({ code: 'promo', message: 'The name contains promotional wording.' });
  const nextWords = next.toLowerCase().split(/\s+/).filter(Boolean);
  const repeats = nextWords.filter((w, i) => w.length >= 4 && nextWords.indexOf(w) !== i);
  if (repeats.length) violations.push({ code: 'repeat', message: 'The name repeats a keyword.' });
  const prevNorm = prev.toLowerCase();
  const added = (token: string | null | undefined) => {
    const t = String(token || '').trim().toLowerCase();
    return t.length >= 3 && next.toLowerCase().includes(t) && !prevNorm.includes(t);
  };
  if (added(context.city)) violations.push({ code: 'city', message: 'The proposed name adds the city. That is keyword stuffing.' });
  for (const s of context.services || []) {
    if (added(s)) violations.push({ code: 'service', message: `The proposed name adds the service "${s}".` });
  }
  if (added(context.category)) violations.push({ code: 'category', message: 'The proposed name adds the category.' });
  return { valid: violations.length === 0 && next !== prev, requiresExplicitApproval: true, violations };
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface HoursPeriodIn { openDay: string; closeDay: string; openTime: string; closeTime: string }
export interface SpecialHourIn { startDate: string; endDate?: string; closed: boolean; openTime?: string | null; closeTime?: string | null }

function minutes(hm: string): number | null {
  const m = HM.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function validateRegularHours(periods: HoursPeriodIn[]): { valid: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  const spans: Array<{ day: string; start: number; end: number }> = [];
  for (const p of periods) {
    if (!DAYS.includes(p.openDay) || !DAYS.includes(p.closeDay)) {
      violations.push({ code: 'day', message: `Unknown day in ${p.openDay}/${p.closeDay}.` });
      continue;
    }
    if (p.openDay !== p.closeDay) violations.push({ code: 'overnight', message: 'Overnight hours are not accepted. Split them into same-day periods.' });
    const a = minutes(p.openTime);
    const b = minutes(p.closeTime);
    if (a == null || b == null || a >= b) violations.push({ code: 'time', message: `${p.openDay} needs an opening time before the closing time.` });
    else spans.push({ day: p.openDay, start: a, end: b });
  }
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i].day === spans[j].day && spans[i].start < spans[j].end && spans[j].start < spans[i].end) {
        violations.push({ code: 'overlap', message: `${spans[i].day} has overlapping hours.` });
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

function timeOfDay(hm: string): { hours: number; minutes: number } {
  const [h, m] = hm.split(':').map(Number);
  return { hours: h, minutes: m };
}

function dateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

/** Validated hours → the Business Information special/regular hours body. */
export function toGoogleHours(input: { regular: HoursPeriodIn[]; special: SpecialHourIn[] }): {
  regularHours: { periods: Array<{ openDay: string; closeDay: string; openTime: { hours: number; minutes: number }; closeTime: { hours: number; minutes: number } }> };
  specialHours: { specialHourPeriods: Array<Record<string, unknown>> };
} {
  return {
    regularHours: {
      periods: input.regular.map((p) => ({
        openDay: p.openDay,
        closeDay: p.closeDay,
        openTime: timeOfDay(p.openTime),
        closeTime: timeOfDay(p.closeTime),
      })),
    },
    specialHours: {
      specialHourPeriods: input.special.map((p) => {
        const row: Record<string, unknown> = {
          startDate: dateParts(p.startDate),
          endDate: dateParts(p.endDate || p.startDate),
          closed: p.closed,
        };
        if (!p.closed && p.openTime && p.closeTime) {
          row.openTime = timeOfDay(p.openTime);
          row.closeTime = timeOfDay(p.closeTime);
        }
        return row;
      }),
    },
  };
}

export function validateSpecialHours(periods: SpecialHourIn[]): { valid: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const p of periods) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)) violations.push({ code: 'date', message: `Special hours date ${p.startDate || '(blank)'} is not YYYY-MM-DD.` });
    const end = p.endDate || p.startDate;
    if (end < p.startDate) violations.push({ code: 'date', message: 'Special hours end before they start.' });
    if (seen.has(p.startDate)) violations.push({ code: 'overlap', message: `More than one special-hours entry starts on ${p.startDate}.` });
    seen.add(p.startDate);
    if (!p.closed) {
      const a = minutes(p.openTime || '');
      const b = minutes(p.closeTime || '');
      if (a == null || b == null || a >= b) violations.push({ code: 'time', message: `${p.startDate} is open but the times are invalid.` });
    }
  }
  return { valid: violations.length === 0, violations };
}

export interface HolidayReminder {
  status: 'NOT_CONFIGURED' | 'READY';
  note: string;
  reminders: Array<{ name: string; date: string; covered: boolean }>;
}

/** Reminders only for a caller-supplied holiday list. Dates are never invented here. */
export function holidayReminders(
  specials: Array<{ startDate: string }>,
  holidays: Array<{ name: string; date: string }> | null,
  nowIso: string,
): HolidayReminder {
  if (!holidays) {
    return { status: 'NOT_CONFIGURED', note: 'No holiday calendar is configured. Festival dates are not guessed.', reminders: [] };
  }
  const today = nowIso.slice(0, 10);
  const until = new Date(today + 'T00:00:00Z');
  until.setUTCDate(until.getUTCDate() + 30);
  const limit = until.toISOString().slice(0, 10);
  const covered = new Set(specials.map((s) => s.startDate));
  const reminders = holidays
    .filter((h) => h.date >= today && h.date <= limit)
    .map((h) => ({ name: h.name, date: h.date, covered: covered.has(h.date) }));
  return { status: 'READY', note: 'Upcoming supplied holidays. A missing special-hours entry is a reminder, not a write.', reminders };
}

/** Add GBP UTM parameters without dropping or duplicating existing ones. */
export function withGbpUtm(raw: string): { ok: boolean; url: string | null; violations: Violation[] } {
  const violations: Violation[] = [];
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, url: null, violations: [{ code: 'url', message: 'The link is not a valid URL.' }] };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, url: null, violations: [{ code: 'protocol', message: 'The link must be http or https.' }] };
  }
  const set = (key: string, value: string) => {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  };
  set('utm_source', 'google');
  set('utm_medium', 'organic');
  set('utm_campaign', 'gbp');
  return { ok: violations.length === 0, url: url.toString(), violations };
}

export type PinStatus = 'MATCH' | 'WARNING' | 'MISMATCH' | 'UNKNOWN';

export function comparePin(
  google: { lat: number; lng: number } | null,
  geocoded: { lat: number; lng: number } | null,
  distanceMeters: number | null,
): { status: PinStatus; distanceMeters: number | null; note: string } {
  if (!google || !geocoded || distanceMeters == null) {
    return { status: 'UNKNOWN', distanceMeters: null, note: 'The Google pin or the geocoded address is missing. The pin is not moved.' };
  }
  if (distanceMeters <= PIN_MATCH_METERS) return { status: 'MATCH', distanceMeters, note: `Within ${PIN_MATCH_METERS} metres.` };
  if (distanceMeters <= PIN_WARNING_METERS) return { status: 'WARNING', distanceMeters, note: `Between ${PIN_MATCH_METERS} and ${PIN_WARNING_METERS} metres. The pin is not moved.` };
  return { status: 'MISMATCH', distanceMeters, note: `More than ${PIN_WARNING_METERS} metres. The pin is not moved.` };
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export interface ServiceAreaPlace { placeId: string; placeName: string }

export function validateServiceArea(input: {
  businessType: string | null;
  places: ServiceAreaPlace[];
}): { valid: boolean; violations: Violation[]; places: ServiceAreaPlace[] } {
  const violations: Violation[] = [];
  const sab = input.businessType === 'CUSTOMER_LOCATION_ONLY' || input.businessType === 'CUSTOMER_AND_BUSINESS_LOCATION';
  if (!sab) violations.push({ code: 'not_sab', message: 'Service areas apply only to a service-area business.' });
  const seen = new Set<string>();
  const places: ServiceAreaPlace[] = [];
  for (const p of input.places) {
    if (!p.placeId || p.placeId.trim().length < 8) {
      violations.push({ code: 'place', message: `${p.placeName || 'An area'} has no resolved Google place id.` });
      continue;
    }
    if (seen.has(p.placeId)) {
      violations.push({ code: 'duplicate', message: `${p.placeName || p.placeId} is listed twice.` });
      continue;
    }
    seen.add(p.placeId);
    places.push(p);
  }
  if (places.length > SERVICE_AREA_MAX) violations.push({ code: 'limit', message: `A listing can have at most ${SERVICE_AREA_MAX} service areas.` });
  if (places.length === 0) violations.push({ code: 'empty', message: 'No resolved service area was provided.' });
  return { valid: violations.length === 0, violations, places: places.slice(0, SERVICE_AREA_MAX) };
}

/**
 * Full service list to write: the live items Google already has, plus free-form
 * additions under the listing's real primary category resource. Prices are not added.
 */
export function buildServiceWrite(input: {
  existing: unknown[];
  additions: Array<{ name?: string; description?: string }>;
  categoryName: string | null;
}): { valid: boolean; violations: Violation[]; items: unknown[] } {
  const violations: Violation[] = [];
  const category = input.categoryName && input.categoryName.startsWith('categories/') ? input.categoryName : null;
  if (input.additions.length > 0 && !category) {
    violations.push({ code: 'category', message: 'Services need the listing’s Google primary category. It was not available, so nothing was invented.' });
  }
  const seen = new Set<string>();
  for (const item of input.existing) {
    const label = (item as any)?.freeFormServiceItem?.label?.displayName || (item as any)?.structuredServiceItem?.description || '';
    if (label) seen.add(String(label).trim().toLowerCase());
  }
  const items = [...input.existing];
  for (const add of input.additions) {
    const name = String(add?.name || '').trim();
    if (!name) {
      violations.push({ code: 'name', message: 'A service is missing its name.' });
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      violations.push({ code: 'duplicate', message: `${name} is already on the service list.` });
      continue;
    }
    seen.add(name.toLowerCase());
    if (!category) continue;
    items.push({
      freeFormServiceItem: {
        category,
        label: {
          displayName: name.slice(0, 140),
          description: String(add.description || '').trim().slice(0, 300),
          languageCode: 'en',
        },
      },
    });
  }
  if (items.length === input.existing.length && violations.length === 0) {
    violations.push({ code: 'empty', message: 'No new service was provided.' });
  }
  return { valid: violations.length === 0, violations, items };
}

/** Owner-supplied attribute value → the Google attribute object. Unknown types are refused. */
export function buildAttributeWrite(
  meta: { name: string; valueType: string },
  value: unknown,
): { valid: boolean; violations: Violation[]; attribute: Record<string, unknown> | null } {
  const fail = (message: string) => ({ valid: false, violations: [{ code: 'value', message }], attribute: null as null });
  if (meta.valueType === 'BOOL') {
    if (typeof value !== 'boolean') return fail('Choose yes or no for this attribute.');
    return { valid: true, violations: [], attribute: { name: meta.name, valueType: 'BOOL', values: [value] } };
  }
  if (meta.valueType === 'ENUM') {
    if (typeof value !== 'string' || !value.trim()) return fail('Choose one of the allowed values.');
    return { valid: true, violations: [], attribute: { name: meta.name, valueType: 'ENUM', values: [value.trim()] } };
  }
  if (meta.valueType === 'URL') {
    const utm = withGbpUtm(String(value || ''));
    if (!utm.ok || !utm.url) return { valid: false, violations: utm.violations, attribute: null };
    return { valid: true, violations: [], attribute: { name: meta.name, valueType: 'URL', uriValues: [{ uri: utm.url }] } };
  }
  if (meta.valueType === 'REPEATED_ENUM') {
    const setValues = Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
    if (!setValues.length) return fail('Choose at least one value.');
    return {
      valid: true,
      violations: [],
      attribute: { name: meta.name, valueType: 'REPEATED_ENUM', repeatedEnumValue: { setValues, unsetValues: [] } },
    };
  }
  return fail(`Attribute type ${meta.valueType || 'unknown'} is not written.`);
}

/** Same Google location, whether or not the account prefix is present. */
export function locationKey(id: string | null | undefined): string {
  const value = String(id || '').trim();
  const at = value.indexOf('locations/');
  return at >= 0 ? value.slice(at) : value;
}

export function locationGuard(
  storedLocationId: string,
  connectedLocationId: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  const stored = locationKey(storedLocationId);
  const connected = locationKey(connectedLocationId);
  if (!stored || !connected || stored !== connected) {
    return { ok: false, error: 'The connected Google listing does not match this proposal. Nothing was sent to Google.' };
  }
  return { ok: true };
}

export function canRollbackAttribute(before: unknown): boolean {
  return before != null;
}

/** After rollback is claimed, patch only if the live field is still the verified value. */
export function rollbackRecheck(afterFingerprint: string | null, liveFingerprint: string): 'patch' | 'conflict' {
  if (!afterFingerprint || liveFingerprint !== afterFingerprint) return 'conflict';
  return 'patch';
}

function emptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clock(value: unknown): string | null {
  if (typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  }
  if (value && typeof value === 'object') {
    const row = value as { hours?: number; minutes?: number };
    return `${String(Number(row.hours ?? 0)).padStart(2, '0')}:${String(Number(row.minutes ?? 0)).padStart(2, '0')}`;
  }
  return null;
}

function dateKey(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value && typeof value === 'object' && 'year' in value) {
    const row = value as { year?: number; month?: number; day?: number };
    return `${row.year}-${String(row.month ?? 0).padStart(2, '0')}-${String(row.day ?? 0).padStart(2, '0')}`;
  }
  return null;
}

function categoryResource(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.startsWith('categories/') ? name : null;
}

function canonicalCategories(value: unknown): { primary: string | null; additional: string[] } {
  const body = value && typeof value === 'object' && 'primaryCategory' in (value as object)
    ? value as { primaryCategory?: unknown; additionalCategories?: unknown[] }
    : value && typeof value === 'object' && 'categories' in (value as object)
      ? (value as { categories?: { primaryCategory?: unknown; additionalCategories?: unknown[] } }).categories || {}
      : {};
  const record = (body || {}) as { primaryCategory?: unknown; additionalCategories?: unknown[] };
  const additional = Array.isArray(record.additionalCategories)
    ? record.additionalCategories.map(categoryResource).filter((name): name is string => !!name).sort()
    : [];
  return { primary: categoryResource(record.primaryCategory), additional };
}

function canonicalHours(value: unknown): { regular: unknown[]; special: unknown[] } {
  const body = (value || {}) as { regularHours?: { periods?: unknown[] }; specialHours?: { specialHourPeriods?: unknown[] } };
  const regular = (Array.isArray(body.regularHours?.periods) ? body.regularHours.periods : []).map((period) => {
    const row = period as { openDay?: string; closeDay?: string; openTime?: unknown; closeTime?: unknown };
    return { openDay: row.openDay || '', closeDay: row.closeDay || '', openTime: clock(row.openTime), closeTime: clock(row.closeTime) };
  });
  const special = (Array.isArray(body.specialHours?.specialHourPeriods) ? body.specialHours.specialHourPeriods : []).map((period) => {
    const row = period as { startDate?: unknown; endDate?: unknown; closed?: boolean; openTime?: unknown; closeTime?: unknown };
    return {
      startDate: dateKey(row.startDate),
      endDate: dateKey(row.endDate) || dateKey(row.startDate),
      closed: row.closed === true,
      openTime: row.closed === true ? null : clock(row.openTime),
      closeTime: row.closed === true ? null : clock(row.closeTime),
    };
  });
  return { regular, special };
}

function attributeBody(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== 'object') return null;
  const row = value as { attribute?: Record<string, unknown> };
  const raw = row.attribute && typeof row.attribute === 'object' ? row.attribute : value as Record<string, unknown>;
  return raw;
}

function scalarValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const row = value as { boolValue?: unknown; stringValue?: unknown; uri?: unknown };
    if ('boolValue' in row) return row.boolValue;
    if ('stringValue' in row) return row.stringValue;
    if ('uri' in row) return row.uri;
  }
  return value;
}

function canonicalAttribute(value: unknown): { name: string | null; values: unknown[]; uris: string[]; setValues: string[] } | null {
  const raw = attributeBody(value);
  if (!raw) return null;
  const values = Array.isArray(raw.values) ? raw.values.map(scalarValue) : [];
  const uris = (Array.isArray(raw.uriValues) ? raw.uriValues : [])
    .map((item) => String((item as { uri?: string })?.uri || item || ''))
    .filter(Boolean)
    .sort();
  const setValues = Array.isArray((raw.repeatedEnumValue as { setValues?: unknown[] } | undefined)?.setValues)
    ? ((raw.repeatedEnumValue as { setValues: unknown[] }).setValues).map((item) => String(item)).sort()
    : [];
  return { name: typeof raw.name === 'string' ? raw.name : null, values, uris, setValues };
}

function canonicalServices(value: unknown): unknown[] {
  const items = Array.isArray(value) ? value : [];
  return items.map((item) => {
    const free = (item as { freeFormServiceItem?: any })?.freeFormServiceItem;
    const structured = (item as { structuredServiceItem?: any })?.structuredServiceItem;
    if (free) {
      return { kind: 'free', category: free.category || null, name: free.label?.displayName || '', description: free.label?.description || '' };
    }
    if (structured) return { kind: 'structured', id: structured.serviceTypeId || null, description: structured.description || '' };
    return { kind: 'free', category: null, name: (item as { name?: string })?.name || '', description: (item as { description?: string })?.description || '' };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function canonicalServiceArea(value: unknown): { businessType: string | null; regionCode: string | null; places: string[] } {
  const body = (value || {}) as { businessType?: string; regionCode?: string; places?: { placeInfos?: Array<{ placeId?: string }> } | Array<{ placeId?: string }> };
  const infos = Array.isArray(body.places) ? body.places : body.places?.placeInfos || [];
  return {
    businessType: body.businessType || null,
    regionCode: body.regionCode || null,
    places: infos.map((place) => place.placeId || '').filter(Boolean).sort(),
  };
}

function phoneKey(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

function websiteKey(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return value.trim();
  }
}

/** Comparable Google value. Extra metadata and equivalent clock values collapse; a different value does not. */
export function canonicalValue(kind: string, value: unknown): unknown {
  if (kind === 'title' || kind === 'description') return emptyText(value);
  if (kind === 'phone') {
    const text = emptyText(value);
    return text ? phoneKey(text) : null;
  }
  if (kind === 'website') {
    const text = emptyText(value);
    return text ? websiteKey(text) : null;
  }
  if (kind === 'categories' || kind === 'primary_category') return canonicalCategories(value);
  if (kind === 'hours') return canonicalHours(value);
  if (kind === 'attribute') return canonicalAttribute(value);
  if (kind === 'services') return canonicalServices(value);
  if (kind === 'service_area') return canonicalServiceArea(value);
  return value ?? null;
}

export function canonicalFingerprint(kind: string, value: unknown): string {
  return fingerprint(canonicalValue(kind, value));
}

/** Same clientRequestId: reuse only when the proposal itself is unchanged. */
export function idempotencyResult(
  existing: { kind: string; proposed: unknown } | null,
  next: { kind: string; proposed: unknown },
): 'create' | 'reuse' | 'conflict' {
  if (!existing) return 'create';
  return canonicalFingerprint(existing.kind, existing.proposed) === canonicalFingerprint(next.kind, next.proposed) ? 'reuse' : 'conflict';
}

export type ReadBackStatus = 'VERIFIED' | 'FAILED' | 'CONFLICT';

/** VERIFIED only when the stored value is the approved value. Unchanged stays FAILED. Anything else is CONFLICT. */
export function classifyReadBack(kind: string, before: unknown, proposed: unknown, actual: unknown): ReadBackStatus {
  const got = canonicalFingerprint(kind, actual);
  if (got === canonicalFingerprint(kind, proposed)) return 'VERIFIED';
  if (got === canonicalFingerprint(kind, before)) return 'FAILED';
  return 'CONFLICT';
}

export function fingerprint(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sort((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
    }
    return v ?? null;
  };
  return JSON.stringify(sort(value));
}
