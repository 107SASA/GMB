/**
 * Customer-facing presentation of profile proposals. Pure, no I/O.
 *
 * Proposal records keep Google's own shapes (TimeOfDay objects, category and
 * attribute resource names, service items). Customers see readable lines
 * instead — never raw JSON, resource ids, or environment-variable names.
 * Nothing here changes what is stored, approved, or sent to Google.
 */

const DAY_LABEL: Record<string, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday',
  FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};
const DAY_ORDER = Object.keys(DAY_LABEL);

export function dayLabel(day: string): string {
  return DAY_LABEL[String(day || '').toUpperCase()] || String(day || '');
}

const KIND_LABEL: Record<string, string> = {
  description: 'Business description',
  title: 'Business name',
  phone: 'Phone number',
  website: 'Website link',
  categories: 'Additional categories',
  primary_category: 'Primary category',
  services: 'Services',
  hours: 'Opening hours',
  service_area: 'Service area',
  attribute: 'Attribute',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] || 'Profile change';
}

export type StatusGroup = 'waiting' | 'approved' | 'live' | 'closed';

const STATUS: Record<string, { label: string; group: StatusGroup; explain: string }> = {
  PROPOSED: { label: 'Waiting for your approval', group: 'waiting', explain: 'Nothing has been sent to Google.' },
  APPROVED: { label: 'Approved — not applied yet', group: 'approved', explain: 'Approved, but nothing has been sent to Google yet.' },
  EXECUTING: { label: 'Applying…', group: 'approved', explain: 'Being sent to Google now.' },
  APPLIED: { label: 'Sent to Google', group: 'live', explain: 'Sent to Google; waiting for Google to confirm the change.' },
  VERIFIED: { label: 'Live on Google', group: 'live', explain: 'Google shows this change on the profile.' },
  REVERTED: { label: 'Rolled back', group: 'closed', explain: 'The previous value was restored on Google.' },
  BLOCKED: { label: 'Not applied', group: 'closed', explain: 'This change was stopped before anything was sent to Google.' },
  FAILED: { label: 'Not applied', group: 'closed', explain: 'Google did not accept this change.' },
  CONFLICT: { label: 'Not applied — profile changed', group: 'closed', explain: 'The Google profile changed after this proposal was made, so it was not applied.' },
  UNRESOLVED: { label: 'Needs checking', group: 'closed', explain: 'We could not confirm whether Google accepted this change.' },
};

export function statusInfo(status: string): { label: string; group: StatusGroup; explain: string } {
  return STATUS[status] || { label: 'Unknown status', group: 'closed', explain: '' };
}

export function sourceLabel(source: string): string {
  if (source === 'recommendation') return 'Suggested by GrowwMatics';
  if (source === 'owner') return 'Entered by you';
  return 'Created in GrowwMatics';
}

/** "attributes/has_wheelchair_accessible_entrance" → "Wheelchair accessible entrance". */
export function attributeLabel(name: string, known?: Record<string, string>): string {
  if (known?.[name]) return known[name];
  const id = String(name || '').split('/').pop() || '';
  const words = id.replace(/^url_/, '').replace(/^(has|is|offers|serves|pay)_/, '').replace(/_/g, ' ').trim();
  if (!words) return 'Attribute';
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return /^url_/.test(id) ? `${label} link` : label;
}

/** "categories/gcid:tile_contractor" → "Tile contractor" (when no display name was stored). */
export function categoryLabel(c: unknown): string {
  const cat = c as { displayName?: string; name?: string } | null;
  if (cat?.displayName) return cat.displayName;
  const id = String(cat?.name || '').split(':').pop() || '';
  const words = id.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

const pad = (n: unknown) => String(Number(n) || 0).padStart(2, '0');

function timeText(t: unknown): string {
  if (typeof t === 'string') return t;
  const o = t as { hours?: number; minutes?: number } | null;
  if (!o || typeof o !== 'object') return '';
  return `${pad(o.hours)}:${pad(o.minutes)}`;
}

function dateText(d: unknown): string {
  if (typeof d === 'string') return d;
  const o = d as { year?: number; month?: number; day?: number } | null;
  if (!o?.year || !o.month || !o.day) return '';
  return `${o.year}-${pad(o.month)}-${pad(o.day)}`;
}

function attributeValueText(attr: any): string {
  if (!attr || typeof attr !== 'object') return 'Not set';
  if (Array.isArray(attr.uriValues) && attr.uriValues.length) return attr.uriValues.map((u: any) => String(u?.uri || '')).filter(Boolean).join(', ');
  if (attr.repeatedEnumValue) {
    const set = Array.isArray(attr.repeatedEnumValue.setValues) ? attr.repeatedEnumValue.setValues : [];
    return set.length ? set.map((v: string) => String(v).replace(/_/g, ' ').toLowerCase()).join(', ') : 'None selected';
  }
  if (Array.isArray(attr.values) && attr.values.length) {
    return attr.values.map((v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : String(v).replace(/_/g, ' ').toLowerCase())).join(', ');
  }
  return 'Not set';
}

function serviceText(item: any): string {
  const free = item?.freeFormServiceItem;
  if (free) return String(free.label?.displayName || '').trim();
  const structured = item?.structuredServiceItem;
  if (structured) {
    const id = String(structured.serviceTypeId || '').split(':').pop() || '';
    const words = id.replace(/_/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(structured.description || '');
  }
  return String(item?.name || item?.displayName || '').trim();
}

/** Readable, line-based text for a stored before/proposed value of one proposal. */
export function formatValue(kind: string, value: unknown, attributeNames?: Record<string, string>): string {
  if (value == null || value === '') return 'Not set';
  if (typeof value === 'string') return value;
  const v = value as any;
  switch (kind) {
    case 'categories':
    case 'primary_category': {
      const lines: string[] = [];
      if (v.primaryCategory) lines.push(`Primary: ${categoryLabel(v.primaryCategory) || 'Not set'}`);
      const extras = (v.additionalCategories || []).map(categoryLabel).filter(Boolean);
      lines.push(`Additional: ${extras.length ? extras.join(', ') : 'None'}`);
      return lines.join('\n');
    }
    case 'services': {
      const items = (Array.isArray(v) ? v : Array.isArray(v?.additions) ? v.additions : []).map(serviceText).filter(Boolean);
      return items.length ? items.map((s: string) => `• ${s}`).join('\n') : 'No services listed';
    }
    case 'hours': {
      const lines: string[] = [];
      const periods = Array.isArray(v?.regularHours?.periods) ? [...v.regularHours.periods] : [];
      periods.sort((a: any, b: any) => DAY_ORDER.indexOf(String(a?.openDay)) - DAY_ORDER.indexOf(String(b?.openDay)));
      if (v?.regularHours !== undefined) {
        lines.push(periods.length
          ? periods.map((p: any) => `${dayLabel(p.openDay)}: ${timeText(p.openTime)}–${timeText(p.closeTime)}`).join('\n')
          : 'Regular hours: not set');
      }
      const special = Array.isArray(v?.specialHours?.specialHourPeriods) ? v.specialHours.specialHourPeriods : [];
      for (const s of special) {
        const start = dateText(s?.startDate);
        const end = dateText(s?.endDate);
        const range = end && end !== start ? `${start} to ${end}` : start;
        lines.push(`Special hours ${range}: ${s?.closed ? 'Closed' : `${timeText(s?.openTime)}–${timeText(s?.closeTime)}`}`);
      }
      return lines.length ? lines.join('\n') : 'Not set';
    }
    case 'service_area': {
      const places = (v?.places?.placeInfos || []).map((p: any) => String(p?.placeName || '').trim()).filter(Boolean);
      return places.length ? places.map((p: string) => `• ${p}`).join('\n') : 'No areas listed';
    }
    case 'attribute': {
      // Proposed: { name, attribute: {...} }; current: the attribute itself (or null).
      const attr = v.attribute ?? v;
      const name = String(v.name || attr?.name || '');
      return `${attributeLabel(name, attributeNames)}: ${attributeValueText(attr)}`;
    }
    default:
      return flatText(v);
  }
}

/** Free text gets a word-level diff; everything else is compared line by line. */
export function usesWordDiff(kind: string): boolean {
  return kind === 'description' || kind === 'title';
}

/**
 * Line-level comparison of two formatted values: each side keeps its own
 * readable lines, and a line is marked when the other side does not have it.
 * Avoids splicing struck-out digits into times ("1009:00").
 */
export function lineChanges(before: string, after: string): { before: Array<{ text: string; changed: boolean }>; after: Array<{ text: string; changed: boolean }> } {
  const left = before.split('\n');
  const right = after.split('\n');
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    before: left.map((text) => ({ text, changed: !rightSet.has(text) })),
    after: right.map((text) => ({ text, changed: !leftSet.has(text) })),
  };
}

/** Last-resort readable form for an unexpected shape: "key: value" lines, never braces. */
export function flatText(value: unknown, prefix = ''): string {
  if (value == null) return '';
  if (typeof value !== 'object') return `${prefix}${String(value)}`;
  if (Array.isArray(value)) return value.map((x) => flatText(x, prefix)).filter(Boolean).join('\n');
  return Object.entries(value as Record<string, unknown>)
    .map(([k, x]) => (x && typeof x === 'object' ? flatText(x, `${prefix}${k} › `) : `${prefix}${k}: ${String(x)}`))
    .filter(Boolean)
    .join('\n');
}

/** Short, customer-safe reference for support (no full internal ids). */
export function shortReference(id: string): string {
  return id ? `#${String(id).slice(-6)}` : '';
}

export interface GroupableChange {
  _id: string;
  kind: string;
  status: string;
  proposed: unknown;
}

/**
 * Collapse identical proposals (same kind, same proposed value, same status)
 * into one entry: the newest record is shown and acted on; the others are
 * counted. Records are not changed. Input is newest-first (as the API returns).
 */
export function groupDuplicates<T extends GroupableChange>(changes: T[]): Array<{ change: T; duplicates: T[] }> {
  const groups = new Map<string, { change: T; duplicates: T[] }>();
  for (const c of changes) {
    const key = `${c.kind}|${c.status}|${JSON.stringify(c.proposed ?? null)}`;
    const g = groups.get(key);
    if (g) g.duplicates.push(c);
    else groups.set(key, { change: c, duplicates: [] });
  }
  return [...groups.values()];
}

/** Friendly result text for an approve / apply / roll-back call. */
export function actionResultText(action: 'approve' | 'execute' | 'rollback', res: { success?: boolean; error?: string | null; liveWriteApplied?: boolean }): string {
  if (!res.success) {
    const err = String(res.error || '');
    if (/live google writes are disabled/i.test(err)) {
      return action === 'rollback'
        ? 'Live Google updates are switched off for this account, so nothing was sent to Google. The change is still live on your profile.'
        : 'Live Google updates are switched off for this account, so nothing was sent to Google. The proposal is still approved and can be applied once updates are switched on.';
    }
    return err || 'The change could not be updated. Please try again.';
  }
  if (action === 'approve') return 'Approved. Nothing has been sent to Google yet — use “Apply to Google” when you are ready.';
  if (action === 'rollback') return 'Rolled back. The previous value was restored on Google.';
  return res.liveWriteApplied ? 'Applied to Google and confirmed on your profile.' : 'Sent to Google. We will show it as live once Google confirms it.';
}

const PIN_TEXT: Record<string, string> = {
  MATCH: 'Your map pin matches your address.',
  WARNING: 'Your map pin is a little away from your address. We never move the pin for you.',
  MISMATCH: 'Your map pin looks far from your address. Check it in Google Business Profile — we never move the pin for you.',
};
export function pinText(status: string | null | undefined): string {
  return PIN_TEXT[String(status || '')] || 'We could not check your map pin against your address yet. We never move the pin for you.';
}

const BUSINESS_TYPE: Record<string, string> = {
  CUSTOMER_LOCATION_ONLY: 'Service-area business (no storefront shown)',
  CUSTOMER_AND_BUSINESS_LOCATION: 'Storefront that also serves customers at their location',
};
export function businessTypeText(type: string | null | undefined): string {
  return BUSINESS_TYPE[String(type || '')] || 'Not set on Google';
}

export const PRODUCTS_TEXT = 'Products can’t be published through Google’s API, so they are not changed here.';
