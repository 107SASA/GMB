/**
 * Raw Google Business Profile responses → normalized snapshot data.
 * Pure (runs under `node --test`). Field names follow the public API
 * reference for Business Information v1 `Location`, `Attributes`,
 * My Business Verifications v1 `VoiceOfMerchantState`, v4 `LocalPost` and
 * v4 `MediaItem`. Missing fields become null / empty — never invented.
 */
import type {
  GbpAddress,
  GbpAttribute,
  GbpCategory,
  GbpGoogleUpdates,
  GbpLocationData,
  GbpMediaSummary,
  GbpPostsSummary,
  GbpServiceItem,
  GbpVerificationState,
  HoursPeriod,
  SpecialHoursPeriod,
} from './types.ts';

/** The single readMask used for the location read (all FR-3.2 profile fields in ONE call). */
export const LOCATION_READ_MASK = [
  'name',
  'title',
  'storeCode',
  'languageCode',
  'phoneNumbers',
  'categories',
  'storefrontAddress',
  'websiteUri',
  'regularHours',
  'specialHours',
  'moreHours',
  'serviceArea',
  'latlng',
  'openInfo',
  'metadata',
  'profile',
  'serviceItems',
].join(',');

/** Fields compared against Google's suggested version (getGoogleUpdated). */
export const GOOGLE_UPDATED_READ_MASK = [
  'title',
  'phoneNumbers',
  'categories',
  'storefrontAddress',
  'websiteUri',
  'regularHours',
  'specialHours',
  'latlng',
  'openInfo',
  'profile',
  'serviceArea',
].join(',');

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Google TimeOfDay {hours?, minutes?} → "HH:MM". Proto3 omits zero fields, so {} is midnight. */
export function timeOfDay(t: any): string | null {
  if (!t || typeof t !== 'object') return null;
  const h = Number(t.hours ?? 0);
  const m = Number(t.minutes ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/** Google Date {year, month, day} → "YYYY-MM-DD". */
export function dateOf(d: any): string | null {
  if (!d || typeof d !== 'object' || !d.year || !d.month || !d.day) return null;
  return `${d.year}-${pad2(Number(d.month))}-${pad2(Number(d.day))}`;
}

function category(c: any): GbpCategory | null {
  if (!c || typeof c !== 'object') return null;
  const name = str(c.name);
  const displayName = str(c.displayName);
  if (!name && !displayName) return null;
  return { name: name || '', displayName: displayName || name || '' };
}

export function normalizeAddress(a: any): GbpAddress | null {
  if (!a || typeof a !== 'object') return null;
  const addressLines = Array.isArray(a.addressLines) ? a.addressLines.map((l: any) => String(l).trim()).filter(Boolean) : [];
  const out: GbpAddress = {
    addressLines,
    locality: str(a.locality),
    sublocality: str(a.sublocality),
    administrativeArea: str(a.administrativeArea),
    postalCode: str(a.postalCode),
    regionCode: str(a.regionCode),
    formatted: '',
  };
  // Same flattening as lib/gbpClient.ts fetchLocationProfile / formatLocationAddress.
  out.formatted = [...addressLines, out.locality, out.administrativeArea, out.postalCode].filter(Boolean).join(', ');
  return out;
}

function hoursPeriods(regularHours: any): HoursPeriod[] | null {
  const periods = regularHours?.periods;
  if (!Array.isArray(periods)) return null;
  return periods
    .map((p: any) => ({
      openDay: String(p?.openDay || ''),
      openTime: timeOfDay(p?.openTime) ?? '00:00',
      closeDay: String(p?.closeDay || p?.openDay || ''),
      closeTime: timeOfDay(p?.closeTime) ?? '00:00',
    }))
    .filter((p: HoursPeriod) => p.openDay);
}

function specialHourPeriods(specialHours: any): SpecialHoursPeriod[] {
  const periods = specialHours?.specialHourPeriods;
  if (!Array.isArray(periods)) return [];
  return periods
    .map((p: any) => {
      const startDate = dateOf(p?.startDate);
      if (!startDate) return null;
      return {
        startDate,
        endDate: dateOf(p?.endDate) || startDate,
        closed: p?.closed === true,
        openTime: p?.closed === true ? null : timeOfDay(p?.openTime),
        closeTime: p?.closed === true ? null : timeOfDay(p?.closeTime),
      } as SpecialHoursPeriod;
    })
    .filter((p: SpecialHoursPeriod | null): p is SpecialHoursPeriod => !!p);
}

function serviceItems(items: any): GbpServiceItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((it: any): GbpServiceItem | null => {
      const price = it?.price && typeof it.price === 'object'
        ? { currencyCode: String(it.price.currencyCode || ''), units: String(it.price.units ?? '0'), nanos: Number(it.price.nanos ?? 0) }
        : null;
      if (it?.structuredServiceItem) {
        const s = it.structuredServiceItem;
        return { kind: 'structured', id: str(s.serviceTypeId), displayName: null, description: str(s.description), price };
      }
      if (it?.freeFormServiceItem) {
        const f = it.freeFormServiceItem;
        return {
          kind: 'free_form',
          id: str(f.category),
          displayName: str(f.label?.displayName),
          description: str(f.label?.description),
          price,
        };
      }
      return null;
    })
    .filter((x: GbpServiceItem | null): x is GbpServiceItem => !!x);
}

/** Readable name for a structured service id ("job_type_id:teeth_whitening" → "Teeth whitening"). */
export function serviceLabel(s: GbpServiceItem): string {
  if (s.displayName) return s.displayName;
  const raw = String(s.id || '').split(':').pop() || '';
  const words = raw.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** Business Information v1 `Location` → GbpLocationData. */
export function normalizeLocation(raw: any): GbpLocationData {
  const meta = raw?.metadata || {};
  const lat = Number(raw?.latlng?.latitude);
  const lng = Number(raw?.latlng?.longitude);
  return {
    resourceName: String(raw?.name || ''),
    title: str(raw?.title),
    storeCode: str(raw?.storeCode),
    languageCode: str(raw?.languageCode),
    primaryPhone: str(raw?.phoneNumbers?.primaryPhone),
    additionalPhones: Array.isArray(raw?.phoneNumbers?.additionalPhones)
      ? raw.phoneNumbers.additionalPhones.map((p: any) => String(p).trim()).filter(Boolean)
      : [],
    websiteUri: str(raw?.websiteUri),
    address: normalizeAddress(raw?.storefrontAddress),
    latlng: Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { latitude: lat, longitude: lng } : null,
    primaryCategory: category(raw?.categories?.primaryCategory),
    additionalCategories: Array.isArray(raw?.categories?.additionalCategories)
      ? raw.categories.additionalCategories.map(category).filter((c: GbpCategory | null): c is GbpCategory => !!c)
      : [],
    description: str(raw?.profile?.description),
    regularHours: hoursPeriods(raw?.regularHours),
    specialHours: specialHourPeriods(raw?.specialHours),
    moreHoursTypes: Array.isArray(raw?.moreHours) ? raw.moreHours.map((m: any) => String(m?.hoursTypeId || '')).filter(Boolean) : [],
    serviceArea: raw?.serviceArea
      ? {
          businessType: str(raw.serviceArea.businessType),
          places: Array.isArray(raw.serviceArea.places?.placeInfos)
            ? raw.serviceArea.places.placeInfos.map((p: any) => ({ placeName: str(p?.placeName), placeId: str(p?.placeId) }))
            : [],
          regionCode: str(raw.serviceArea.regionCode),
        }
      : null,
    services: serviceItems(raw?.serviceItems),
    openInfo: raw?.openInfo
      ? { status: str(raw.openInfo.status), canReopen: typeof raw.openInfo.canReopen === 'boolean' ? raw.openInfo.canReopen : null, openingDate: dateOf(raw.openInfo.openingDate) }
      : null,
    metadata: {
      placeId: str(meta.placeId),
      mapsUri: str(meta.mapsUri),
      newReviewUri: str(meta.newReviewUri),
      hasGoogleUpdated: meta.hasGoogleUpdated === true,
      hasPendingEdits: meta.hasPendingEdits === true,
      hasVoiceOfMerchant: typeof meta.hasVoiceOfMerchant === 'boolean' ? meta.hasVoiceOfMerchant : null,
      canOperateLocalPost: typeof meta.canOperateLocalPost === 'boolean' ? meta.canOperateLocalPost : null,
      canModifyServiceList: typeof meta.canModifyServiceList === 'boolean' ? meta.canModifyServiceList : null,
      duplicateLocation: str(meta.duplicateLocation),
    },
  };
}

function attributeLabel(name: string): string {
  const id = name.split('/').pop() || name;
  const words = id.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

function attributeValue(a: any): string {
  if (Array.isArray(a?.uriValues) && a.uriValues.length) return a.uriValues.map((u: any) => String(u?.uri || '')).filter(Boolean).sort().join(' | ');
  if (a?.repeatedEnumValue) {
    const set = Array.isArray(a.repeatedEnumValue.setValues) ? [...a.repeatedEnumValue.setValues].sort() : [];
    const unset = Array.isArray(a.repeatedEnumValue.unsetValues) ? [...a.repeatedEnumValue.unsetValues].sort() : [];
    return `set:${set.join(',')};unset:${unset.join(',')}`;
  }
  if (Array.isArray(a?.values)) return a.values.map((v: any) => String(v)).sort().join(',');
  return '';
}

/** Business Information v1 `Attributes` resource → GbpAttribute[]. */
export function normalizeAttributes(raw: any): GbpAttribute[] {
  const list = Array.isArray(raw?.attributes) ? raw.attributes : [];
  return list
    .filter((a: any) => typeof a?.name === 'string' && a.name)
    .map((a: any) => ({ name: a.name, label: attributeLabel(a.name), valueType: str(a.valueType), value: attributeValue(a) }))
    .sort((a: GbpAttribute, b: GbpAttribute) => a.name.localeCompare(b.name));
}

/** My Business Verifications v1 `VoiceOfMerchantState` → GbpVerificationState. */
export function normalizeVoiceOfMerchant(raw: any): GbpVerificationState {
  return {
    hasVoiceOfMerchant: typeof raw?.hasVoiceOfMerchant === 'boolean' ? raw.hasVoiceOfMerchant : null,
    hasBusinessAuthority: typeof raw?.hasBusinessAuthority === 'boolean' ? raw.hasBusinessAuthority : null,
    waitForVoiceOfMerchant: !!raw?.waitForVoiceOfMerchant,
    verify: raw?.verify ? { hasPendingVerification: raw.verify.hasPendingVerification === true } : null,
    resolveOwnershipConflict: !!raw?.resolveOwnershipConflict,
    complyWithGuidelines: raw?.complyWithGuidelines
      ? { recommendationReason: str(raw.complyWithGuidelines.recommendationReason) }
      : null,
  };
}

/** Owner media items (lib/gbpClient.ts listLocationMedia) → summary. */
export function summarizeMedia(items: Array<{ category?: string; mediaFormat?: string | null; createTime?: string | null }>): GbpMediaSummary {
  const byCategory: Record<string, number> = {};
  let videos = 0;
  let newest: string | null = null;
  for (const it of items || []) {
    const c = String(it.category || 'ADDITIONAL');
    byCategory[c] = (byCategory[c] || 0) + 1;
    if (String(it.mediaFormat || '').toUpperCase() === 'VIDEO') videos++;
    if (it.createTime && (!newest || it.createTime > newest)) newest = it.createTime;
  }
  const total = (items || []).length;
  return {
    total,
    byCategory,
    photos: total - videos,
    videos,
    hasLogo: (byCategory.LOGO || 0) > 0,
    hasCover: (byCategory.COVER || 0) > 0,
    newestCreateTime: newest,
    scope: 'owner_media',
  };
}

/** v4 LocalPost[] pages → summary (Google posts are NOT GrowwMatics posts). */
export function summarizePosts(posts: any[], truncated: boolean): GbpPostsSummary {
  const byTopicType: Record<string, number> = {};
  let live = 0;
  let newest: string | null = null;
  for (const p of posts || []) {
    const t = String(p?.topicType || 'UNKNOWN');
    byTopicType[t] = (byTopicType[t] || 0) + 1;
    if (p?.state === 'LIVE') live++;
    const ct = str(p?.createTime);
    if (ct && (!newest || ct > newest)) newest = ct;
  }
  const recent = [...(posts || [])]
    .sort((a, b) => String(b?.createTime || '').localeCompare(String(a?.createTime || '')))
    .slice(0, 20)
    .map((p) => ({
      name: String(p?.name || ''),
      topicType: str(p?.topicType),
      state: str(p?.state),
      summary: str(p?.summary) ? String(p.summary).slice(0, 300) : null,
      createTime: str(p?.createTime),
      updateTime: str(p?.updateTime),
      searchUrl: str(p?.searchUrl),
      callToAction: str(p?.callToAction?.actionType),
    }));
  return { total: (posts || []).length, byTopicType, live, newestCreateTime: newest, truncated, recent };
}

/** FieldMask string "a,b.c" → ["a", "b.c"]. */
export function maskFields(mask: unknown): string[] {
  if (typeof mask !== 'string') return [];
  return mask.split(',').map((s) => s.trim()).filter(Boolean).sort();
}

/**
 * Business Information v1 `GoogleUpdatedLocation` ({location, diffMask,
 * pendingMask}) → the Google-suggested values for the fields that differ.
 */
export function normalizeGoogleUpdated(raw: any, canonicalize: (loc: GbpLocationData) => Record<string, string>): GbpGoogleUpdates {
  const diffFields = maskFields(raw?.diffMask);
  const pendingFields = maskFields(raw?.pendingMask);
  const googleValues: Record<string, string> = {};
  if (raw?.location && diffFields.length) {
    const canon = canonicalize(normalizeLocation(raw.location));
    for (const f of diffFields) {
      const key = FIELD_MASK_TO_CANON[f.split('.')[0]] || null;
      if (key && canon[key] !== undefined) googleValues[key] = canon[key];
    }
  }
  return { diffFields, pendingFields, googleValues };
}

/** Top-level Location field → canonical change-detection key (see changes.ts). */
export const FIELD_MASK_TO_CANON: Record<string, string> = {
  title: 'title',
  phoneNumbers: 'primaryPhone',
  categories: 'primaryCategory',
  storefrontAddress: 'address',
  websiteUri: 'website',
  regularHours: 'regularHours',
  specialHours: 'specialHours',
  latlng: 'pin',
  openInfo: 'openStatus',
  profile: 'description',
  serviceArea: 'serviceArea',
  serviceItems: 'services',
};
