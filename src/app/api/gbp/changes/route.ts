import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import GbpProfileChange from '@/models/GbpProfileChange';
import { createChange, locationIdFor, ProposalConflictError } from '@/services/gbp/changes/store';
import { buildAttributeWrite, buildServiceWrite, toGoogleHours, validateBusinessName, validateDescription, validateRegularHours, validateServiceArea, validateSpecialHours, withGbpUtm, type HoursPeriodIn, type SpecialHourIn } from '@/services/gbp/changes/policy';
import { listCategoryAttributes, readLocationAttributes, readLocationRaw } from '@/lib/gbpClient';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';

export const dynamic = 'force-dynamic';

const KINDS = ['description', 'title', 'phone', 'website', 'categories', 'primary_category', 'services', 'hours', 'service_area', 'attribute'] as const;

const bodySchema = z.object({
  kind: z.enum(KINDS),
  proposed: z.unknown(),
  before: z.unknown().optional(),
  source: z.string().max(40).optional(),
  clientRequestId: z.string().max(80).optional(),
  recommendationRef: z.record(z.string(), z.unknown()).optional(),
  context: z.object({
    city: z.string().optional(),
    services: z.array(z.string()).optional(),
    category: z.string().optional(),
    tokens: z.array(z.string()).optional(),
    allowedNumbers: z.array(z.string()).optional(),
    competitorNames: z.array(z.string()).optional(),
    businessType: z.string().nullable().optional(),
  }).optional(),
});

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const changes = await GbpProfileChange.find({ businessId: ctx.businessId }).sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json({ success: true, changes });
}

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid change.' }, { status: 400 });
  }
  const locationId = await locationIdFor(ctx.businessId);
  if (!locationId) return NextResponse.json({ success: false, error: 'Google Business Profile is not connected.' }, { status: 400 });

  const { kind } = parsed.data;
  let before: unknown = null;
  let proposed: unknown = parsed.data.proposed;
  let validation: { valid: boolean; violations: Array<{ code: string; message: string }> } = { valid: true, violations: [] };
  let live: any = null;

  try {
    if (kind === 'description' || kind === 'title' || kind === 'phone' || kind === 'website') {
      const mask = kind === 'description' ? 'profile' : kind === 'title' ? 'title' : kind === 'phone' ? 'phoneNumbers' : 'websiteUri';
      live = await readLocationRaw(ctx.businessId, mask);
      before = kind === 'description' ? (live?.profile?.description ?? '')
        : kind === 'title' ? (live?.title ?? '')
          : kind === 'phone' ? (live?.phoneNumbers?.primaryPhone ?? '')
            : (live?.websiteUri ?? '');
    } else if (kind === 'categories' || kind === 'primary_category') {
      live = await readLocationRaw(ctx.businessId, 'categories');
      before = live?.categories ?? null;
    } else if (kind === 'services') {
      live = await readLocationRaw(ctx.businessId, 'serviceItems,metadata,categories');
      before = live?.serviceItems ?? [];
    } else if (kind === 'hours') {
      live = await readLocationRaw(ctx.businessId, 'regularHours,specialHours');
      before = { regularHours: live?.regularHours ?? null, specialHours: live?.specialHours ?? null };
    } else if (kind === 'service_area') {
      live = await readLocationRaw(ctx.businessId, 'serviceArea');
      before = live?.serviceArea ?? null;
    } else if (kind === 'attribute') {
      const name = String((parsed.data.proposed as { name?: string })?.name || '');
      const attrs = await readLocationAttributes(ctx.businessId);
      before = (attrs?.attributes || []).find((a: any) => a.name === name) || null;
    }
  } catch {
    return NextResponse.json({ success: false, error: 'Could not read the current Google value.' }, { status: 502 });
  }

  if (kind === 'description') {
    validation = validateDescription(String(proposed || ''), {
      tokens: parsed.data.context?.tokens || [ctx.business.category, ctx.business.city].filter(Boolean),
      allowedNumbers: parsed.data.context?.allowedNumbers,
      competitorNames: parsed.data.context?.competitorNames,
    });
  } else if (kind === 'title') {
    validation = validateBusinessName(String(before || ''), String(proposed || ''), {
      city: parsed.data.context?.city || ctx.business.city,
      services: parsed.data.context?.services,
      category: parsed.data.context?.category || ctx.business.category,
    });
  } else if (kind === 'website') {
    const utm = withGbpUtm(String(proposed || before || ''));
    if (!utm.ok || !utm.url) validation = { valid: false, violations: utm.violations };
    else proposed = utm.url;
  } else if (kind === 'hours') {
    const regular = humanRegular(proposed);
    const special = humanSpecial(proposed);
    if (regular.length === 0 && special.length === 0) {
      validation = { valid: false, violations: [{ code: 'empty', message: 'Add regular or special hours. An empty payload is not written.' }] };
    } else {
      const regularResult = validateRegularHours(regular);
      const specialResult = validateSpecialHours(special);
      validation = { valid: regularResult.valid && specialResult.valid, violations: [...regularResult.violations, ...specialResult.violations] };
      if (validation.valid) {
        const google = toGoogleHours({ regular, special });
        proposed = {
          regularHours: regular.length ? google.regularHours : (live?.regularHours ?? { periods: [] }),
          specialHours: special.length ? google.specialHours : (live?.specialHours ?? { specialHourPeriods: [] }),
        };
      }
    }
  } else if (kind === 'service_area') {
    const livePlaces = Array.isArray(live?.serviceArea?.places?.placeInfos) ? live.serviceArea.places.placeInfos : [];
    const incomingPlaces = Array.isArray((proposed as any)?.places?.placeInfos)
      ? (proposed as any).places.placeInfos
      : Array.isArray((proposed as any)?.places) ? (proposed as any).places : [];
    const seenPlaces = new Set(livePlaces.map((p: any) => p.placeId));
    const places = [...livePlaces, ...incomingPlaces.filter((p: any) => p?.placeId && !seenPlaces.has(p.placeId))];
    const area = validateServiceArea({ businessType: live?.serviceArea?.businessType ?? null, places });
    validation = { valid: area.valid, violations: area.violations };
    if (area.valid) {
      proposed = {
        businessType: live.serviceArea.businessType,
        regionCode: live.serviceArea.regionCode,
        places: { placeInfos: area.places },
      };
    }
  } else if (kind === 'attribute') {
    const spec = proposed as { name?: string; value?: unknown };
    const snap = await GbpLocationSnapshot.findOne({ businessId: ctx.businessId }).select('sections.location.data.primaryCategory.name sections.location.data.address.regionCode').lean();
    const categoryName = (snap as any)?.sections?.location?.data?.primaryCategory?.name || '';
    const region = (snap as any)?.sections?.location?.data?.address?.regionCode || 'IN';
    const catalog = categoryName ? await listCategoryAttributes(ctx.businessId, categoryName, region).catch(() => null) : null;
    const meta = catalog?.find((a) => a.name === spec?.name);
    if (!catalog) {
      validation = { valid: false, violations: [{ code: 'catalog', message: 'The Google attribute catalog was not available. No attribute was guessed.' }] };
    } else if (!meta) {
      validation = { valid: false, violations: [{ code: 'attribute', message: 'That attribute is not in the catalog for this category.' }] };
    } else {
      const built = buildAttributeWrite(meta, spec?.value);
      validation = { valid: built.valid, violations: built.violations };
      if (built.attribute) proposed = { name: meta.name, attribute: built.attribute };
    }
  } else if (kind === 'primary_category' || kind === 'categories') {
    const incoming = proposed as { primaryCategory?: { name?: string }; additionalCategories?: Array<{ name?: string }> };
    const primaryName = kind === 'primary_category' ? incoming?.primaryCategory?.name : live?.categories?.primaryCategory?.name;
    const liveExtras: Array<{ name?: string }> = live?.categories?.additionalCategories || [];
    const incomingExtras = kind === 'categories' ? (incoming?.additionalCategories || []) : [];
    const names = [primaryName, ...incomingExtras.map((c) => c?.name), ...liveExtras.map((c) => c?.name)].filter(Boolean);
    if (!primaryName || names.some((n) => !String(n).startsWith('categories/'))) {
      validation = { valid: false, violations: [{ code: 'category', message: 'Every category must be a Google category resource. Display names are not accepted.' }] };
    } else {
      const seen = new Set<string>();
      const extras = [...liveExtras, ...incomingExtras].filter((c) => {
        const name = c?.name;
        if (!name || name === primaryName || seen.has(name) || !String(name).startsWith('categories/')) return false;
        seen.add(name);
        return true;
      });
      proposed = {
        primaryCategory: kind === 'primary_category' ? { name: primaryName } : live.categories.primaryCategory,
        additionalCategories: extras,
      };
    }
  } else if (kind === 'services') {
    if (live?.metadata?.canModifyServiceList === false) {
      validation = { valid: false, violations: [{ code: 'services', message: 'Google says this service list cannot be modified.' }] };
    } else {
      const additions = Array.isArray((proposed as any)?.additions)
        ? (proposed as any).additions
        : Array.isArray(proposed) ? proposed : [];
      const built = buildServiceWrite({
        existing: Array.isArray(before) ? before : [],
        additions,
        categoryName: live?.categories?.primaryCategory?.name || null,
      });
      validation = { valid: built.valid, violations: built.violations };
      if (built.valid) proposed = built.items;
    }
  }

  let doc;
  try {
    doc = await createChange({
    businessId: ctx.businessId,
    organizationId: ctx.organizationId,
    locationId,
    kind,
    fields: [kind],
    source: parsed.data.source || 'owner',
    before,
    proposed,
    validation,
    requestedBy: ctx.userId,
    recommendationRef: parsed.data.recommendationRef || null,
    clientRequestId: parsed.data.clientRequestId || null,
    });
  } catch (err) {
    if (err instanceof ProposalConflictError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ success: true, change: doc, liveWriteApplied: false });
}

function asClock(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'hours' in value) {
    const row = value as { hours?: number; minutes?: number };
    return `${String(row.hours ?? 0).padStart(2, '0')}:${String(row.minutes ?? 0).padStart(2, '0')}`;
  }
  return '';
}

function asDate(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'year' in value) {
    const row = value as { year?: number; month?: number; day?: number };
    return `${row.year}-${String(row.month ?? 0).padStart(2, '0')}-${String(row.day ?? 0).padStart(2, '0')}`;
  }
  return '';
}

function humanRegular(proposed: unknown): HoursPeriodIn[] {
  const periods = (proposed as { regularHours?: { periods?: any[] } })?.regularHours?.periods || [];
  return periods.map((p) => ({
    openDay: String(p?.openDay || ''),
    closeDay: String(p?.closeDay || ''),
    openTime: asClock(p?.openTime),
    closeTime: asClock(p?.closeTime),
  }));
}

function humanSpecial(proposed: unknown): SpecialHourIn[] {
  const periods = (proposed as { specialHours?: { specialHourPeriods?: any[] } })?.specialHours?.specialHourPeriods || [];
  return periods.map((p) => ({
    startDate: asDate(p?.startDate),
    endDate: p?.endDate ? asDate(p.endDate) : undefined,
    closed: p?.closed === true,
    openTime: p?.openTime ? asClock(p.openTime) : null,
    closeTime: p?.closeTime ? asClock(p.closeTime) : null,
  }));
}
