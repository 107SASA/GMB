/**
 * Food menu, hotel (lodging) details and booking / order buttons — the GBP
 * sections Google offers only to some listings (Location.metadata flags
 * canHaveFoodMenus / canOperateLodgingData; Place Actions per location).
 *
 * Pure: no I/O, no `@/` imports. Builders turn what the owner approved into
 * Google's shape; canonical* functions make read-back comparable.
 */

export interface Violation {
  code: string;
  message: string;
}

// ─── Food menu (My Business v4 FoodMenus) ──────────────────────────────────────

export type Spice = 'MILD' | 'MEDIUM' | 'HOT';

export interface MenuDraftItem {
  name: string;
  description?: string;
  /** In the menu currency. Google requires a price on every item. */
  price: number | null;
  /** true = vegetarian (Google dietary restriction VEGETARIAN), false = non-veg, null = not stated. */
  veg?: boolean | null;
  spice?: Spice | null;
  serves?: number | null;
}

export interface MenuDraftSection {
  name: string;
  items: MenuDraftItem[];
}

export interface MenuDraft {
  currency: string;
  sections: MenuDraftSection[];
}

export const MENU_LIMITS = { sections: 40, itemsPerSection: 150, items: 500, name: 140, description: 1000 } as const;

const SPICES = new Set(['MILD', 'MEDIUM', 'HOT']);

function cleanText(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

/** Any input (AI read of a menu photo, the owner's editor, Google) → a clean draft. */
export function sanitizeMenuDraft(raw: unknown, fallbackCurrency = 'INR'): MenuDraft {
  const r = (raw || {}) as { currency?: unknown; sections?: unknown };
  const currency = /^[A-Z]{3}$/.test(String(r.currency || '')) ? String(r.currency) : fallbackCurrency;
  const sections: MenuDraftSection[] = [];
  let total = 0;
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (sections.length >= MENU_LIMITS.sections) break;
    const name = cleanText((s as any)?.name, MENU_LIMITS.name) || 'Menu';
    const items: MenuDraftItem[] = [];
    const seen = new Set<string>();
    for (const it of Array.isArray((s as any)?.items) ? (s as any).items : []) {
      if (items.length >= MENU_LIMITS.itemsPerSection || total >= MENU_LIMITS.items) break;
      const itemName = cleanText(it?.name, MENU_LIMITS.name);
      if (!itemName || seen.has(itemName.toLowerCase())) continue;
      seen.add(itemName.toLowerCase());
      const spice = String(it?.spice || '').toUpperCase();
      const serves = Number(it?.serves);
      items.push({
        name: itemName,
        description: cleanText(it?.description, MENU_LIMITS.description) || undefined,
        price: cleanPrice(it?.price),
        veg: typeof it?.veg === 'boolean' ? it.veg : null,
        spice: SPICES.has(spice) ? (spice as Spice) : null,
        serves: Number.isInteger(serves) && serves > 0 && serves <= 50 ? serves : null,
      });
      total += 1;
    }
    if (items.length) {
      const existing = sections.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (existing) existing.items.push(...items.filter((i) => !existing.items.some((e) => e.name.toLowerCase() === i.name.toLowerCase())));
      else sections.push({ name, items });
    }
  }
  return { currency, sections };
}

/**
 * Adds newly read items to the current menu: same-named sections are merged,
 * an item already on the menu keeps its current details (only a missing
 * price is filled in). Nothing on the current menu is dropped.
 */
export function mergeMenuDrafts(current: MenuDraft | null, incoming: MenuDraft): MenuDraft {
  const out: MenuDraft = sanitizeMenuDraft(current || { currency: incoming.currency, sections: [] }, incoming.currency);
  for (const s of incoming.sections) {
    let target = out.sections.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
    if (!target) {
      target = { name: s.name, items: [] };
      out.sections.push(target);
    }
    for (const it of s.items) {
      const have = out.sections.flatMap((x) => x.items).find((x) => x.name.toLowerCase() === it.name.toLowerCase());
      if (have) {
        if (have.price == null && it.price != null) have.price = it.price;
        continue;
      }
      target.items.push(it);
    }
  }
  return sanitizeMenuDraft(out, out.currency);
}

function money(price: number, currency: string) {
  const units = Math.trunc(price);
  const nanos = Math.round((price - units) * 1e9);
  return { currencyCode: currency, units: String(units), ...(nanos ? { nanos } : {}) };
}

function label(displayName: string, description?: string) {
  return [{ displayName, ...(description ? { description } : {}), languageCode: 'en' }];
}

/** Approved draft → Google FoodMenus body (`menus` only; the resource name is added at write time). */
export function buildFoodMenuWrite(draftIn: unknown, opts: { menuName?: string; currency?: string; existing?: unknown } = {}): { valid: boolean; violations: Violation[]; foodMenus: { menus: unknown[] } | null; draft: MenuDraft } {
  const draft = sanitizeMenuDraft(draftIn, opts.currency || 'INR');
  const violations: Violation[] = [];
  if (!draft.sections.length) violations.push({ code: 'empty', message: 'The menu has no items.' });
  const noPrice = draft.sections.flatMap((s) => s.items).filter((i) => i.price == null);
  if (noPrice.length) {
    const names = noPrice.slice(0, 5).map((i) => i.name).join(', ');
    violations.push({ code: 'price', message: `Google needs a price for every item. Missing: ${names}${noPrice.length > 5 ? ` and ${noPrice.length - 5} more` : ''}.` });
  }
  if (violations.length) return { valid: false, violations, foodMenus: null, draft };
  // Google replaces the whole menu on write: keep what only Google holds on a
  // dish that stays (photos, allergens, size options, ingredients…).
  const keep = new Map<string, any>();
  for (const menu of ((opts.existing as any)?.menus || [])) {
    for (const sec of menu?.sections || []) {
      for (const it of sec?.items || []) {
        const n = firstLabel(it?.labels).name.toLowerCase();
        if (n && !keep.has(n)) keep.set(n, it);
      }
    }
  }
  const firstMenu = ((opts.existing as any)?.menus || [])[0];
  const sections = draft.sections.map((s) => ({
    labels: label(s.name),
    items: s.items.map((i) => {
      const old = keep.get(i.name.toLowerCase());
      const { price: _p, dietaryRestriction: _d, spiciness: _s, servesNumPeople: _n, ...oldExtras } = old?.attributes || {};
      return {
      labels: label(i.name, i.description),
      ...(Array.isArray(old?.options) && old.options.length ? { options: old.options } : {}),
      attributes: {
        ...oldExtras,
        price: money(i.price as number, draft.currency),
        ...(i.veg === true ? { dietaryRestriction: ['VEGETARIAN'] } : {}),
        ...(i.spice ? { spiciness: i.spice } : {}),
        ...(i.serves ? { servesNumPeople: i.serves } : {}),
      },
      };
    }),
  }));
  const menuName = cleanText(opts.menuName, MENU_LIMITS.name) || firstLabel(firstMenu?.labels).name || 'Menu';
  return {
    valid: true,
    violations,
    foodMenus: {
      menus: [{
        labels: label(menuName),
        sections,
        ...(Array.isArray(firstMenu?.cuisines) && firstMenu.cuisines.length ? { cuisines: firstMenu.cuisines } : {}),
        ...(firstMenu?.sourceUrl ? { sourceUrl: firstMenu.sourceUrl } : {}),
      }],
    },
    draft,
  };
}

function priceOf(m: any): number | null {
  if (!m || typeof m !== 'object') return null;
  const units = Number(m.units ?? 0);
  const nanos = Number(m.nanos ?? 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  return Math.round((units + nanos / 1e9) * 100) / 100;
}

function firstLabel(labels: any): { name: string; description: string } {
  const l = Array.isArray(labels) ? (labels.find((x: any) => !x?.languageCode || /^en/i.test(x.languageCode)) || labels[0]) : null;
  return { name: String(l?.displayName || '').trim(), description: String(l?.description || '').trim() };
}

/** Google FoodMenus → editable draft (all menus flattened into sections). Null when there is no menu. */
export function foodMenusToDraft(google: unknown): MenuDraft | null {
  const menus = (google as any)?.menus;
  if (!Array.isArray(menus) || !menus.length) return null;
  let currency = 'INR';
  const sections: any[] = [];
  for (const menu of menus) {
    for (const s of menu?.sections || []) {
      sections.push({
        name: firstLabel(s?.labels).name,
        items: (s?.items || []).map((it: any) => {
          const l = firstLabel(it?.labels);
          const a = it?.attributes || {};
          if (a?.price?.currencyCode) currency = String(a.price.currencyCode);
          const diet: string[] = Array.isArray(a.dietaryRestriction) ? a.dietaryRestriction : [];
          return {
            name: l.name,
            description: l.description,
            price: priceOf(a.price),
            veg: diet.includes('VEGETARIAN') || diet.includes('VEGAN') ? true : null,
            spice: a.spiciness,
            serves: a.servesNumPeople,
          };
        }),
      });
    }
  }
  const draft = sanitizeMenuDraft({ currency, sections }, currency);
  return draft.sections.length ? draft : null;
}

/** Comparable menu: names, prices, veg / spice / serves. Labels in other languages and photos are ignored. */
export function canonicalFoodMenus(value: unknown): unknown {
  const draft = foodMenusToDraft(value);
  if (!draft) return null;
  return draft.sections.map((s) => ({
    s: s.name.toLowerCase(),
    i: s.items.map((i) => [i.name.toLowerCase(), i.price, i.veg === true, i.spice || null, i.serves || null]),
  }));
}

// ─── Hotel details (Lodging API v1) ───────────────────────────────────────────

export interface LodgingField {
  path: string;
  label: string;
  group: string;
  type: 'bool' | 'time';
  /** Words in the owner's / website's text that suggest the amenity (pre-ticks it). */
  hints?: RegExp;
}

/** The amenities owners are asked about most. Paths are Google's Lodging field paths. */
export const LODGING_FIELDS: LodgingField[] = [
  { path: 'policies.checkinTime', label: 'Check-in time', group: 'Stay', type: 'time' },
  { path: 'policies.checkoutTime', label: 'Check-out time', group: 'Stay', type: 'time' },
  { path: 'services.twentyFourHourFrontDesk', label: '24-hour front desk', group: 'Stay', type: 'bool', hints: /24\s*(x|\/)?\s*7|24[- ]hour (front desk|reception)/i },
  { path: 'policies.smokeFreeProperty', label: 'Smoke-free property', group: 'Stay', type: 'bool', hints: /smoke[- ]free|no smoking/i },
  { path: 'connectivity.freeWifi', label: 'Free Wi-Fi', group: 'Stay', type: 'bool', hints: /free\s*wi-?fi|complimentary\s*wi-?fi/i },
  { path: 'parking.freeParking', label: 'Free parking', group: 'Getting here', type: 'bool', hints: /free parking|complimentary parking/i },
  { path: 'parking.valetParkingAvailable', label: 'Valet parking', group: 'Getting here', type: 'bool', hints: /valet/i },
  { path: 'transportation.airportShuttle', label: 'Airport shuttle', group: 'Getting here', type: 'bool', hints: /airport (shuttle|pick[- ]?up|transfer)/i },
  { path: 'foodAndDrink.restaurant', label: 'Restaurant', group: 'Food & drink', type: 'bool', hints: /restaurant|multi[- ]cuisine|dining/i },
  { path: 'foodAndDrink.breakfastAvailable', label: 'Breakfast available', group: 'Food & drink', type: 'bool', hints: /breakfast/i },
  { path: 'foodAndDrink.freeBreakfast', label: 'Free breakfast', group: 'Food & drink', type: 'bool', hints: /(free|complimentary) breakfast|breakfast included/i },
  { path: 'foodAndDrink.roomService', label: 'Room service', group: 'Food & drink', type: 'bool', hints: /room service|in[- ]room dining/i },
  { path: 'foodAndDrink.bar', label: 'Bar', group: 'Food & drink', type: 'bool', hints: /\bbar\b|lounge bar|pub/i },
  { path: 'pools.pool', label: 'Swimming pool', group: 'Leisure', type: 'bool', hints: /swimming pool|\bpool\b/i },
  { path: 'wellness.fitnessCenter', label: 'Gym / fitness centre', group: 'Leisure', type: 'bool', hints: /\bgym\b|fitness (centre|center)/i },
  { path: 'wellness.spa', label: 'Spa', group: 'Leisure', type: 'bool', hints: /\bspa\b|ayurved/i },
  { path: 'services.fullServiceLaundry', label: 'Laundry service', group: 'Services', type: 'bool', hints: /laundry/i },
  { path: 'families.kidsFriendly', label: 'Family / kid friendly', group: 'Services', type: 'bool', hints: /family[- ]friendly|kids? (friendly|play|club)/i },
  { path: 'pets.petsAllowed', label: 'Pets allowed', group: 'Services', type: 'bool', hints: /pet[- ]friendly|pets (allowed|welcome)/i },
  { path: 'accessibility.mobilityAccessible', label: 'Wheelchair accessible', group: 'Services', type: 'bool', hints: /wheelchair|accessible/i },
];

const LODGING_PATHS = new Set(LODGING_FIELDS.map((f) => f.path));

export type LodgingValue = boolean | string | null;

function timeText(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
  }
  if (v && typeof v === 'object') {
    const h = Number((v as any).hours ?? 0);
    const min = Number((v as any).minutes ?? 0);
    if (Number.isFinite(h) && Number.isFinite(min) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  return null;
}

function getPath(obj: any, path: string): unknown {
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

/** Google Lodging → { path: value } for the given paths (null = not set). */
export function flattenLodging(lodging: unknown, paths: string[]): Record<string, LodgingValue> {
  const out: Record<string, LodgingValue> = {};
  for (const path of paths) {
    const field = LODGING_FIELDS.find((f) => f.path === path);
    const v = getPath(lodging, path);
    out[path] = field?.type === 'time' ? timeText(v) : typeof v === 'boolean' ? v : null;
  }
  return out;
}

/** { path: value } → nested Lodging body. A null value is left out (the update mask then clears it). */
export function nestLodging(fields: Record<string, LodgingValue>): Record<string, unknown> {
  const body: Record<string, any> = {};
  for (const [path, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const field = LODGING_FIELDS.find((f) => f.path === path);
    const keys = path.split('.');
    let node = body;
    for (const k of keys.slice(0, -1)) node = node[k] ||= {};
    if (field?.type === 'time') {
      const [h, m] = String(value).split(':').map(Number);
      node[keys[keys.length - 1]] = { hours: h, minutes: m };
    } else {
      node[keys[keys.length - 1]] = value;
    }
  }
  return body;
}

/** The owner's ticks → the fields that actually change (only known paths, valid values). */
export function buildLodgingWrite(
  selection: Record<string, unknown>,
  current: Record<string, LodgingValue>,
): { valid: boolean; violations: Violation[]; fields: Record<string, LodgingValue> } {
  const violations: Violation[] = [];
  const fields: Record<string, LodgingValue> = {};
  for (const [path, raw] of Object.entries(selection || {})) {
    if (!LODGING_PATHS.has(path)) {
      violations.push({ code: 'field', message: `${path} is not a hotel detail we can update.` });
      continue;
    }
    const field = LODGING_FIELDS.find((f) => f.path === path)!;
    let value: LodgingValue;
    if (raw === null) value = null;
    else if (field.type === 'time') {
      value = timeText(raw);
      if (value === null) {
        violations.push({ code: 'time', message: `${field.label} must be a time like 12:00.` });
        continue;
      }
    } else if (typeof raw === 'boolean') value = raw;
    else {
      violations.push({ code: 'value', message: `Choose yes or no for ${field.label}.` });
      continue;
    }
    if ((current[path] ?? null) !== value) fields[path] = value;
  }
  if (!violations.length && !Object.keys(fields).length) violations.push({ code: 'empty', message: 'Nothing changed.' });
  return { valid: violations.length === 0, violations, fields };
}

/** Amenities the owner's own text / website mention — pre-ticked for them. */
export function suggestLodgingFromText(text: string, current: Record<string, LodgingValue>): string[] {
  if (!text) return [];
  return LODGING_FIELDS.filter((f) => f.type === 'bool' && f.hints && current[f.path] == null && f.hints.test(text)).map((f) => f.path);
}

export function canonicalLodging(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k]) => LODGING_PATHS.has(k))
    .map(([k, v]) => [k, LODGING_FIELDS.find((f) => f.path === k)?.type === 'time' ? timeText(v) : typeof v === 'boolean' ? v : null] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

// ─── Booking / order buttons (Place Actions API v1) ───────────────────────────

export const PLACE_ACTION_TYPES = [
  'APPOINTMENT', 'ONLINE_APPOINTMENT', 'DINING_RESERVATION', 'FOOD_ORDERING',
  'FOOD_DELIVERY', 'FOOD_TAKEOUT', 'SHOP_ONLINE', 'SOLOPRENEUR_APPOINTMENT',
] as const;
export type PlaceActionType = (typeof PLACE_ACTION_TYPES)[number];

export const PLACE_ACTION_LABEL: Record<PlaceActionType, string> = {
  APPOINTMENT: 'Book an appointment',
  ONLINE_APPOINTMENT: 'Book an online appointment',
  DINING_RESERVATION: 'Reserve a table',
  FOOD_ORDERING: 'Order food',
  FOOD_DELIVERY: 'Order delivery',
  FOOD_TAKEOUT: 'Order takeaway',
  SHOP_ONLINE: 'Shop online',
  SOLOPRENEUR_APPOINTMENT: 'Book with me',
};

const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|ow\.ly|cutt\.ly|rb\.gy|wa\.me|t\.me)$/i;

/** A booking / order button: a supported type for this listing and a real https page. */
export function validatePlaceAction(
  input: { placeActionType?: unknown; uri?: unknown },
  allowedTypes: string[] | null,
): { valid: boolean; violations: Violation[]; value: { placeActionType: PlaceActionType; uri: string | null } | null } {
  const type = String(input?.placeActionType || '') as PlaceActionType;
  if (!(PLACE_ACTION_TYPES as readonly string[]).includes(type)) {
    return { valid: false, violations: [{ code: 'type', message: 'Unknown button type.' }], value: null };
  }
  if (allowedTypes && !allowedTypes.includes(type)) {
    return { valid: false, violations: [{ code: 'type', message: `Google doesn’t offer the “${PLACE_ACTION_LABEL[type]}” button for this listing.` }], value: null };
  }
  if (input.uri === null) return { valid: true, violations: [], value: { placeActionType: type, uri: null } };
  let url: URL;
  try {
    url = new URL(String(input.uri || '').trim());
  } catch {
    return { valid: false, violations: [{ code: 'url', message: 'Enter the full link, starting with https://' }], value: null };
  }
  if (url.protocol !== 'https:') return { valid: false, violations: [{ code: 'url', message: 'The link must start with https://' }], value: null };
  if (SHORTENERS.test(url.hostname)) return { valid: false, violations: [{ code: 'url', message: 'Google doesn’t accept short links or chat links here. Use the full booking / order page.' }], value: null };
  return { valid: true, violations: [], value: { placeActionType: type, uri: url.toString() } };
}

export function canonicalPlaceAction(value: unknown): unknown {
  const v = value as { placeActionType?: string; uri?: string | null } | null;
  if (!v?.placeActionType) return null;
  return { t: v.placeActionType, u: v.uri ? String(v.uri).replace(/\/+$/, '').toLowerCase() : null };
}
