/**
 * External-change detection (FR-3.3) — pure (runs under `node --test`).
 *
 * Compares the previous successful snapshot with the current one. Values are
 * reduced to a stable canonical string first, so formatting differences
 * (phone spacing, "https://www.x.com/" vs "x.com", TimeOfDay {hours:9} vs
 * {hours:9,minutes:0}) never produce a change. A section is compared only when
 * it was fetched successfully THIS sync and a previous successful value
 * exists — a failed fetch is never read as "the field was removed".
 */
import type {
  ChangeSource,
  ExternalChange,
  GbpAttribute,
  GbpGoogleUpdates,
  GbpLocationData,
  GbpVerificationState,
  HoursPeriod,
  Section,
} from './types.ts';
import { serviceLabel } from './normalize.ts';

const DAY_ORDER = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const ws = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function canonPhone(p: string | null | undefined): string {
  const digits = String(p ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function canonWebsite(u: string | null | undefined): string {
  const raw = ws(u);
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}${url.search}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

export function canonText(s: string | null | undefined): string {
  return ws(s).toLowerCase().replace(/[.,;:]+/g, '').replace(/\s+/g, ' ');
}

export function canonHours(periods: HoursPeriod[] | null): string {
  if (periods == null) return 'none';
  return [...periods]
    .map((p) => `${p.openDay} ${p.openTime}-${p.closeDay === p.openDay ? '' : `${p.closeDay} `}${p.closeTime}`)
    .sort((a, b) => {
      const da = DAY_ORDER.indexOf(a.split(' ')[0]);
      const db = DAY_ORDER.indexOf(b.split(' ')[0]);
      return da - db || a.localeCompare(b);
    })
    .join('; ');
}

/** Upcoming / current special hours only — past dates dropping off is not a change. */
export function canonSpecialHours(loc: GbpLocationData, today: string): string {
  return loc.specialHours
    .filter((p) => p.endDate >= today)
    .map((p) => `${p.startDate}${p.endDate !== p.startDate ? `..${p.endDate}` : ''} ${p.closed ? 'closed' : `${p.openTime ?? '?'}-${p.closeTime ?? '?'}`}`)
    .sort()
    .join('; ');
}

/** Canonical comparable values for one location. Keys are stable field names. */
export function canonicalizeLocation(loc: GbpLocationData, today: string = new Date().toISOString().slice(0, 10)): Record<string, string> {
  return {
    title: ws(loc.title),
    primaryPhone: canonPhone(loc.primaryPhone),
    additionalPhones: loc.additionalPhones.map(canonPhone).filter(Boolean).sort().join(','),
    website: canonWebsite(loc.websiteUri),
    address: canonText(loc.address?.formatted),
    postalCode: ws(loc.address?.postalCode),
    pin: loc.latlng ? `${loc.latlng.latitude.toFixed(4)},${loc.latlng.longitude.toFixed(4)}` : '',
    primaryCategory: loc.primaryCategory ? (loc.primaryCategory.name || canonText(loc.primaryCategory.displayName)) : '',
    additionalCategories: loc.additionalCategories.map((c) => c.name || canonText(c.displayName)).sort().join(','),
    description: ws(loc.description),
    regularHours: canonHours(loc.regularHours),
    specialHours: canonSpecialHours(loc, today),
    services: loc.services
      .map((s) => `${canonText(serviceLabel(s))}${s.price ? `@${s.price.currencyCode}${s.price.units}` : ''}`)
      .filter(Boolean)
      .sort()
      .join(','),
    serviceArea: (loc.serviceArea?.places || []).map((p) => p.placeId || canonText(p.placeName)).sort().join(','),
    openStatus: ws(loc.openInfo?.status),
  };
}

/** Readable value for a change record (the canonical form is for comparison only). */
function displayLocationValue(loc: GbpLocationData, key: string, today: string): string | null {
  switch (key) {
    case 'title': return loc.title;
    case 'primaryPhone': return loc.primaryPhone;
    case 'additionalPhones': return loc.additionalPhones.join(', ') || null;
    case 'website': return loc.websiteUri;
    case 'address': return loc.address?.formatted || null;
    case 'postalCode': return loc.address?.postalCode || null;
    case 'pin': return loc.latlng ? `${loc.latlng.latitude},${loc.latlng.longitude}` : null;
    case 'primaryCategory': return loc.primaryCategory?.displayName || null;
    case 'additionalCategories': return loc.additionalCategories.map((c) => c.displayName).join(', ') || null;
    case 'description': return loc.description;
    case 'regularHours': return loc.regularHours == null ? null : canonHours(loc.regularHours);
    case 'specialHours': return canonSpecialHours(loc, today) || null;
    case 'services': return loc.services.map(serviceLabel).filter(Boolean).join(', ') || null;
    case 'serviceArea': return (loc.serviceArea?.places || []).map((p) => p.placeName || p.placeId).filter(Boolean).join(', ') || null;
    case 'openStatus': return loc.openInfo?.status || null;
    default: return null;
  }
}

export const FIELD_LABELS: Record<string, string> = {
  title: 'Business name',
  primaryPhone: 'Primary phone',
  additionalPhones: 'Additional phones',
  website: 'Website',
  address: 'Address',
  postalCode: 'PIN / postal code',
  pin: 'Map pin',
  primaryCategory: 'Primary category',
  additionalCategories: 'Additional categories',
  description: 'Description',
  regularHours: 'Opening hours',
  specialHours: 'Special hours',
  services: 'Services',
  serviceArea: 'Service area',
  openStatus: 'Open / closed status',
  verificationState: 'Verification state',
};

export function canonVerification(v: GbpVerificationState): string {
  const action = v.complyWithGuidelines
    ? `comply:${v.complyWithGuidelines.recommendationReason || 'unspecified'}`
    : v.resolveOwnershipConflict ? 'ownership_conflict'
      : v.verify ? `verify${v.verify.hasPendingVerification ? ':pending' : ''}`
        : v.waitForVoiceOfMerchant ? 'wait'
          : 'none';
  return `voiceOfMerchant:${v.hasVoiceOfMerchant ?? 'unknown'};action:${action}`;
}

function changeType(prev: string, next: string): ExternalChange['changeType'] {
  if (!prev && next) return 'added';
  if (prev && !next) return 'removed';
  return 'modified';
}

export interface DetectInput {
  prev: {
    location?: Section<GbpLocationData> | null;
    attributes?: Section<GbpAttribute[]> | null;
    verification?: Section<GbpVerificationState> | null;
  } | null;
  next: {
    location?: Section<GbpLocationData> | null;
    attributes?: Section<GbpAttribute[]> | null;
    verification?: Section<GbpVerificationState> | null;
  };
  /** Canonical field keys GrowwMatics itself wrote to Google since the previous snapshot. */
  growmaticsEditedFields?: Set<string>;
  /** Google's own update flags this sync (diffMask), when read. */
  googleUpdates?: GbpGoogleUpdates | null;
  now: Date;
}

const freshSuccess = (s?: Section<unknown> | null) => !!s && s.meta.status === 'SUCCESS' && s.data != null;

/** Compare previous vs current successful data. Unchanged data → []. */
export function detectChanges(input: DetectInput): ExternalChange[] {
  const out: ExternalChange[] = [];
  const at = input.now.toISOString();
  const today = at.slice(0, 10);
  const googleDiff = new Set(Object.keys(input.googleUpdates?.googleValues || {}));
  const sourceFor = (key: string): ChangeSource =>
    input.growmaticsEditedFields?.has(key)
      ? 'GROWMATICS_EDIT'
      : googleDiff.has(key) ? 'GOOGLE_SUGGESTED_EDIT' : 'GOOGLE_EXTERNAL_CHANGE';

  const prevLoc = input.prev?.location?.data;
  const nextLoc = input.next.location;
  if (prevLoc && freshSuccess(nextLoc)) {
    const a = canonicalizeLocation(prevLoc, today);
    const b = canonicalizeLocation(nextLoc!.data!, today);
    for (const key of Object.keys(b)) {
      if (a[key] === b[key]) continue;
      out.push({
        field: key,
        previousValue: displayLocationValue(prevLoc, key, today),
        newValue: displayLocationValue(nextLoc!.data!, key, today),
        source: sourceFor(key),
        changeType: changeType(a[key], b[key]),
        detectedAt: at,
      });
    }
  }

  const prevAttrs = input.prev?.attributes?.data;
  const nextAttrs = input.next.attributes;
  if (prevAttrs && freshSuccess(nextAttrs)) {
    const a = new Map(prevAttrs.map((x) => [x.name, x]));
    const b = new Map(nextAttrs!.data!.map((x) => [x.name, x]));
    for (const name of new Set([...a.keys(), ...b.keys()])) {
      const pv = a.get(name)?.value ?? '';
      const nv = b.get(name)?.value ?? '';
      if (pv === nv) continue;
      const key = `attribute:${name.split('/').pop()}`;
      out.push({
        field: key,
        previousValue: a.has(name) ? pv : null,
        newValue: b.has(name) ? nv : null,
        source: sourceFor(key),
        changeType: changeType(pv, nv),
        detectedAt: at,
      });
    }
  }

  const prevV = input.prev?.verification?.data;
  const nextV = input.next.verification;
  if (prevV && freshSuccess(nextV)) {
    const pv = canonVerification(prevV);
    const nv = canonVerification(nextV!.data!);
    if (pv !== nv) {
      out.push({ field: 'verificationState', previousValue: pv, newValue: nv, source: 'GOOGLE_EXTERNAL_CHANGE', changeType: 'modified', detectedAt: at });
    }
  }
  return out;
}

/** Human label for a change field ("attribute:has_wifi" → "Attribute: has wifi"). */
export function changeFieldLabel(field: string): string {
  if (field.startsWith('attribute:')) return `Attribute: ${field.slice('attribute:'.length).replace(/_/g, ' ')}`;
  return FIELD_LABELS[field] || field;
}
