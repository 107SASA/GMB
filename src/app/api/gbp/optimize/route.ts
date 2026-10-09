import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';
import Audit from '@/models/Audit';
import { listCategoryAttributes, searchGbpCategories } from '@/lib/gbpClient';
import { PRODUCTS_SUPPORT, comparePin, draftDescription, haversineMeters, holidayReminders, validateDescription, type PinStatus } from '@/services/gbp/changes/policy';
import { proposeServices, recommendCategories, suggestUnsetAttributes } from '@/services/gbp/changes/recommend';

export const dynamic = 'force-dynamic';

/**
 * Recommendations only. Nothing in this route writes to Google.
 * Turning a recommendation into a change is POST /api/gbp/changes.
 */
export async function GET(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const snap = await GbpLocationSnapshot.findOne({ businessId: ctx.businessId }).lean();
  const loc = (snap as any)?.sections?.location?.data || null;
  const attrs = (snap as any)?.sections?.attributes?.data || [];
  const audit = await Audit.findOne({ businessId: ctx.businessId, status: 'COMPLETED' }).sort({ createdAt: -1 })
    .select('auditData.fr4.competitorBenchmark auditData.facts').lean();
  const keywords = ((audit as any)?.auditData?.fr4?.competitorBenchmark?.keywords || []) as any[];
  const competitors = keywords.flatMap((k) => (k.competitors || []).map((c: any) => ({
    name: c.name,
    primaryCategory: c.primaryCategory,
    additionalCategories: c.additionalCategories || [],
  })));
  const services: string[] = (loc?.services || []).map((s: any) => s.displayName).filter(Boolean);
  const displayNames = new Set<string>();
  for (const c of competitors) {
    if (c.primaryCategory) displayNames.add(c.primaryCategory);
    for (const extra of c.additionalCategories || []) displayNames.add(extra);
  }
  const catalog: Array<{ name: string; displayName: string }> = [];
  for (const name of [...displayNames].slice(0, 8)) {
    try {
      const found = await searchGbpCategories(ctx.businessId, name, loc?.address?.regionCode || 'IN');
      catalog.push(...found);
    } catch {
      /* unresolved categories stay without a resource name */
    }
  }
  const categories = recommendCategories({
    businessName: loc?.title || ctx.business.name || '',
    currentPrimary: loc?.primaryCategory || null,
    currentAdditional: loc?.additionalCategories || [],
    competitors,
    services,
    catalog,
  });
  let attributeCatalog: Array<{ name: string; displayName: string; valueType: string }> | null = null;
  if (loc?.primaryCategory?.name) {
    attributeCatalog = await listCategoryAttributes(ctx.businessId, loc.primaryCategory.name, loc?.address?.regionCode || 'IN').catch(() => null);
  }
  const attributes = suggestUnsetAttributes(attributeCatalog, (attrs || []).map((a: any) => a.name));
  const servicePlan = proposeServices({
    existing: services,
    verified: services,
    category: loc?.primaryCategory?.displayName || ctx.business.category || '',
    city: loc?.address?.locality || ctx.business.city || '',
    canModify: loc?.metadata?.canModifyServiceList ?? null,
  });
  const tokens = [loc?.primaryCategory?.displayName, loc?.address?.locality, ctx.business.category, ctx.business.city, ...services].filter(Boolean);
  const description = draftDescription({
    name: loc?.title || ctx.business.name || '',
    category: loc?.primaryCategory?.displayName || ctx.business.category || '',
    city: loc?.address?.locality || ctx.business.city || '',
    services,
  });
  const descriptionValidation = validateDescription(description, { tokens });
  const hours = holidayReminders(loc?.specialHours || [], null, new Date().toISOString());

  const url = new URL(req.url);
  let pin: { status: PinStatus; distanceMeters: number | null; note: string } = { status: 'UNKNOWN', distanceMeters: null, note: 'Add ?address= to compare the Google pin with a geocoded address. The pin is not moved.' };
  const address = url.searchParams.get('address');
  if (address && loc?.latlng) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      pin = { status: 'UNKNOWN', distanceMeters: null, note: 'Geocoding is not configured. The pin is not moved.' };
    } else {
      const geo = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`).then((r) => r.json()).catch(() => null);
      const point = geo?.results?.[0]?.geometry?.location;
      if (!point) pin = { status: 'UNKNOWN', distanceMeters: null, note: 'The address did not geocode. The pin is not moved.' };
      else {
        const distance = haversineMeters({ lat: loc.latlng.latitude, lng: loc.latlng.longitude }, { lat: point.lat, lng: point.lng });
        pin = comparePin({ lat: loc.latlng.latitude, lng: loc.latlng.longitude }, { lat: point.lat, lng: point.lng }, distance);
      }
    }
  }

  return NextResponse.json({
    success: true,
    writes: false,
    products: PRODUCTS_SUPPORT,
    categories,
    attributes,
    services: servicePlan,
    description: {
      text: description,
      validation: descriptionValidation,
      tokens,
      competitorNames: [...new Set(competitors.map((c) => c.name).filter(Boolean))].slice(0, 20),
    },
    hours,
    links: {
      website: loc?.websiteUri || null,
      appointment: 'Supported only when the attribute catalog contains attributes/url_appointment.',
      menu: 'Supported only when the attribute catalog contains attributes/url_menu.',
      order: 'Supported only when the attribute catalog contains attributes/url_order_ahead.',
      catalogHas: {
        appointment: !!attributeCatalog?.some((a) => a.name === 'attributes/url_appointment'),
        menu: !!attributeCatalog?.some((a) => a.name === 'attributes/url_menu'),
        order: !!attributeCatalog?.some((a) => a.name === 'attributes/url_order_ahead'),
      },
    },
    serviceArea: {
      businessType: loc?.serviceArea?.businessType || null,
      places: loc?.serviceArea?.places || [],
    },
    pin,
    current: loc ? { title: loc.title, description: loc.description, primaryCategory: loc.primaryCategory } : null,
  });
}

export async function POST() {
  return NextResponse.json({ success: false, error: 'Recommendations are read-only. Create a change with POST /api/gbp/changes after review.' }, { status: 405 });
}
