import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';
import Audit from '@/models/Audit';
import WebsiteIntelligence from '@/models/WebsiteIntelligence';
import { normalizeOrigin } from '@/services/intel/websiteExtract';
import { getCategoryServiceTypes, getFoodMenus, getLodging, listCategoryAttributes, listPlaceActionLinks, listPlaceActionTypes, readLocationAttributes, readLocationRaw, searchGbpCategories } from '@/lib/gbpClient';
import { normalizeLocation, serviceLabel } from '@/services/gbp/intelligence/normalize';
import { PRODUCTS_SUPPORT, chooseDescriptionSuggestion, comparePin, draftDescription, haversineMeters, holidayReminders, validateDescription, type PinStatus } from '@/services/gbp/changes/policy';
import { calendarDate, holidayCalendarFor } from '@/services/gbp/changes/holidayCalendar';
import { LODGING_FIELDS, PLACE_ACTION_LABEL, flattenLodging, foodMenusToDraft, suggestLodgingFromText, type PlaceActionType } from '@/services/gbp/changes/richSections';
import { outrankerPrimaryTally, proposeServices, recommendCategories, suggestUnsetAttributes } from '@/services/gbp/changes/recommend';

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
  // Attributes read live too, so one just applied (a booking link, "online
  // appointments") isn't suggested again before the next sync.
  const liveAttrs: any[] | null = loc
    ? await readLocationAttributes(ctx.businessId).then((r) => (Array.isArray(r?.attributes) ? r.attributes : [])).catch(() => null)
    : null;
  const attrs = liveAttrs ?? ((snap as any)?.sections?.attributes?.data || []);
  const currentUri = (name: string): string | null => {
    const hit = (liveAttrs || []).find((a: any) => a?.name === name);
    return hit?.uriValues?.[0]?.uri || null;
  };
  // Hours and service area read live: the snapshot syncs every few hours, so
  // a change just applied (Saturday hours, a Diwali closure) would otherwise
  // show as missing. Falls back to the snapshot if Google can't be read.
  const live = loc
    ? await readLocationRaw(ctx.businessId, 'regularHours,specialHours,serviceArea').then(normalizeLocation).catch(() => null)
    : null;
  const liveRegularHours = live ? live.regularHours : (loc?.regularHours ?? null);
  const liveServiceArea = live ? live.serviceArea : (loc?.serviceArea ?? null);
  const audit = await Audit.findOne({ businessId: ctx.businessId, status: 'COMPLETED' }).sort({ createdAt: -1 })
    .select('auditData.fr4.competitorBenchmark auditData.facts').lean();
  const keywords = ((audit as any)?.auditData?.fr4?.competitorBenchmark?.keywords || []) as any[];
  // Keyword + positions travel with each row so the main-category advice can
  // use only the competitors that actually rank above this business.
  const competitors = keywords.flatMap((k) => (k.competitors || []).map((c: any) => ({
    name: c.name,
    placeId: c.placeId ?? null,
    primaryCategory: c.primaryCategory,
    additionalCategories: c.additionalCategories || [],
    keyword: k.keyword,
    position: typeof c.position === 'number' ? c.position : null,
    ownPosition: typeof k.ownPosition === 'number' ? k.ownPosition : null,
  })));
  // Google's predefined services carry only an id — named from it so they
  // count as "already on the profile" (they were missed before).
  const services: string[] = (loc?.services || []).map((s: any) => serviceLabel(s)).filter(Boolean);
  const existingTypeIds: string[] = (loc?.services || []).filter((s: any) => s.kind === 'structured' && s.id).map((s: any) => s.id);
  // Outranking competitors' main categories are looked up first, so the
  // main-category suggestion resolves to a Google category id.
  const businessLabel = loc?.title || ctx.business.name || '';
  const displayNames = new Set<string>(outrankerPrimaryTally(competitors, businessLabel).tally.slice(0, 3).map((t) => t.label));
  for (const c of competitors) {
    if (c.primaryCategory) displayNames.add(c.primaryCategory);
    for (const extra of c.additionalCategories || []) displayNames.add(extra);
  }
  const catalog: Array<{ name: string; displayName: string }> = [];
  const categoryQueries = [...new Set([
    ...[...displayNames].slice(0, 8),
    ...services.filter((service) => !displayNames.has(service)).slice(0, 4),
  ])];
  for (const name of categoryQueries) {
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
  // Booking/menu/order links have their own section — not repeated (and not
  // taking one of the 20 suggestion slots) in the attribute list.
  const LINK_ATTRIBUTES = new Set(['attributes/url_appointment', 'attributes/url_menu', 'attributes/url_order_ahead']);
  const attributes = suggestUnsetAttributes(
    attributeCatalog ? attributeCatalog.filter((a) => !LINK_ATTRIBUTES.has(a.name)) : null,
    (attrs || []).map((a: any) => a.name),
  );
  // Services to suggest = what the owner says they offer (Settings / intake)
  // + what their own website names (the stored crawl the report used — no new
  // crawl here). Google's current list is "existing"; passing it as the
  // suggestion list too always left nothing to add, so the "Add the services"
  // task opened an empty page.
  const ownerServices = String(ctx.business.services || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  let websiteServices: string[] = [];
  let intel: any = null;
  try {
    const origin = normalizeOrigin(String(ctx.business.website || ''));
    if (origin) {
      intel = await WebsiteIntelligence.findOne({ origin })
        .select('services bookingLinks differentiators headings description metaDescription title')
        .lean();
      websiteServices = (intel?.services || []).map((c: any) => String(c?.value || '').trim()).filter(Boolean);
    }
  } catch { /* no stored website read — owner services only */ }
  // Google's own service list for every category on the listing (Phase 1 of
  // the products & services plan). Null when Google can't be read — then only
  // the owner's / website's services are offered.
  let googleServices: Awaited<ReturnType<typeof getCategoryServiceTypes>> = null;
  if (loc?.primaryCategory?.name) {
    try {
      googleServices = await getCategoryServiceTypes(
        String(ctx.businessId),
        [loc.primaryCategory.name, ...(loc.additionalCategories || []).map((c: any) => c.name)],
        loc?.address?.regionCode || 'IN',
      );
    } catch { googleServices = null; }
  }
  const servicePlan = proposeServices({
    existing: services,
    existingTypeIds,
    googleServices,
    verified: [...new Map([...ownerServices, ...websiteServices].filter((x) => x.length >= 3 && x.length <= 120).map((x) => [x.toLowerCase(), x])).values()],
    category: loc?.primaryCategory?.displayName || ctx.business.category || '',
    city: loc?.address?.locality || ctx.business.city || '',
    canModify: loc?.metadata?.canModifyServiceList ?? null,
  });
  const tokens = [loc?.primaryCategory?.displayName, loc?.address?.locality, ctx.business.category, ctx.business.city, ...services].filter(Boolean);
  // Services behind this month's focus keywords lead the description (its
  // first 250 characters matter most) — docs/KEYWORD_SYSTEM_PLAN.md §6.
  const focusServices = await focusServiceNames(String(ctx.businessId));
  const focusRank = (svc: string) => {
    const i = focusServices.findIndex((f) => f.toLowerCase() === svc.toLowerCase());
    return i === -1 ? focusServices.length : i;
  };
  const template = draftDescription({
    name: loc?.title || ctx.business.name || '',
    category: loc?.primaryCategory?.displayName || ctx.business.category || '',
    city: loc?.address?.locality || ctx.business.city || '',
    services: [...services].sort((a, b) => focusRank(a) - focusRank(b)),
  });
  const competitorNames = [...new Set(competitors.map((c) => c.name).filter(Boolean))].slice(0, 20);
  // The SEO plan's AI draft first; the fixed template only for an empty or
  // very short description; nothing over a description that is already good.
  const suggestion = chooseDescriptionSuggestion({
    current: loc ? loc.description : null,
    planDescription: await activePlanDescription(String(ctx.businessId)),
    template,
    tokens,
    competitorNames,
  });
  const description = suggestion.text;
  const descriptionValidation = description ? validateDescription(description, { tokens, competitorNames }) : null;
  const regionCode = loc?.address?.regionCode || ctx.business.country || null;
  const holidayList = holidayCalendarFor(regionCode);
  // Business has no top-level timezone field — fall back to the booking
  // settings' zone, then to IST for an Indian profile.
  const timeZone =
    ctx.business.timezone ||
    ctx.business.whatsappBookingSettings?.timezone ||
    (holidayList && String(regionCode).toUpperCase().startsWith('IN') ? 'Asia/Kolkata' : null);
  const localDate = calendarDate(timeZone, new Date());
  const specials = live ? live.specialHours : Array.isArray(loc?.specialHours) ? loc.specialHours : [];
  const hours = !holidayList
    ? holidayReminders(specials, null, new Date().toISOString())
    : !localDate
      ? { status: 'NOT_CONFIGURED' as const, note: 'The business timezone is not set, so holiday reminders are not calculated.', reminders: [] }
      : holidayReminders(specials, holidayList, `${localDate}T12:00:00.000Z`);

  const url = new URL(req.url);
  let pin: { status: PinStatus; distanceMeters: number | null; note: string } = { status: 'UNKNOWN', distanceMeters: null, note: 'No address or pin on the Google profile to compare. The pin is not moved.' };
  // Default: the profile's own address, so the page can say whether the pin
  // sits where that address geocodes.
  const address = url.searchParams.get('address') || loc?.address?.formatted || null;
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

  // Menu, hotel details and booking buttons — only for listings Google allows
  // them on (Location.metadata flags / Place Actions per location).
  const rich = loc
    ? await richSectionsFor(String(ctx.businessId), loc, {
        ownerText: [ctx.business.description, ctx.business.services, loc?.description].filter(Boolean).join('\n'),
        intel,
        website: loc?.websiteUri || ctx.business.website || null,
      })
    : { foodMenu: null, lodging: null, buttons: null };
  return NextResponse.json({
    success: true,
    writes: false,
    foodMenu: rich.foodMenu,
    lodging: rich.lodging,
    buttons: rich.buttons,
    // false until the Google profile is connected and synced once — the
    // recommendations below are then mostly empty.
    connected: !!loc,
    products: PRODUCTS_SUPPORT,
    // What Google allows on this listing — decides which sections are shown
    // (services, food menu, hotel details, health details). Null = not known yet.
    capabilities: {
      services: loc?.metadata?.canModifyServiceList ?? null,
      foodMenu: loc?.metadata?.canHaveFoodMenus ?? null,
      lodging: loc?.metadata?.canOperateLodgingData ?? null,
      health: loc?.metadata?.canOperateHealthData ?? null,
    },
    categories,
    attributes,
    services: servicePlan,
    // Name, phone and website as Google has them — edited in Profile optimization.
    details: {
      title: loc?.title || '',
      phone: loc?.primaryPhone || '',
      website: loc?.websiteUri || '',
    },
    description: {
      // What Google shows now — the starting point when the owner writes their own.
      current: loc?.description || null,
      text: description,
      // 'seo_plan' = the AI draft from the SEO plan, 'template' = the fixed
      // fill-in-the-blanks text. null when nothing is suggested.
      origin: suggestion.origin,
      reason: suggestion.reason,
      validation: descriptionValidation,
      tokens,
      competitorNames,
    },
    // Regular hours as last synced ("HH:MM"), to pre-fill the hours form.
    // null = Google has no hours set.
    hours: { ...hours, currentSpecialHours: specials, currentRegularHours: loc ? liveRegularHours : undefined },
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
      // The link set on Google now (live read), shown and pre-filled on the page.
      current: {
        appointment: currentUri('attributes/url_appointment'),
        menu: currentUri('attributes/url_menu'),
        order: currentUri('attributes/url_order_ahead'),
      },
      attributes: {
        appointment: attributeCatalog?.find((a) => a.name === 'attributes/url_appointment') || null,
        menu: attributeCatalog?.find((a) => a.name === 'attributes/url_menu') || null,
        order: attributeCatalog?.find((a) => a.name === 'attributes/url_order_ahead') || null,
      },
    },
    serviceArea: {
      businessType: liveServiceArea?.businessType || null,
      places: liveServiceArea?.places || [],
    },
    pin,
    current: loc ? { title: loc.title, description: loc.description, primaryCategory: loc.primaryCategory } : null,
  });
}

export async function POST() {
  return NextResponse.json({ success: false, error: 'Recommendations are read-only. Create a change with POST /api/gbp/changes after review.' }, { status: 405 });
}

/** Services tied to the plan's focus then monthly keywords, in that order (none until researched). */
async function focusServiceNames(businessId: string): Promise<string[]> {
  try {
    const [{ getActiveSeoPlan }, { targetKeywords }] = await Promise.all([
      import('@/services/seoPlan/seoPlanService'),
      import('@/services/seo/keywordSet'),
    ]);
    const names = targetKeywords((await getActiveSeoPlan(businessId))?.keywordSet).map((k) => k.service).filter((x): x is string => !!x);
    return Array.from(new Set(names));
  } catch {
    return [];
  }
}

/** The active SEO plan's description draft, or null. */
async function activePlanDescription(businessId: string): Promise<string | null> {
  try {
    const { getActiveSeoPlan } = await import('@/services/seoPlan/seoPlanService');
    return (await getActiveSeoPlan(businessId))?.suggestedDescription?.trim() || null;
  } catch {
    return null;
  }
}

/** Which button a business most likely wants first, by what Google offers. */
const BUTTON_ORDER: PlaceActionType[] = ['APPOINTMENT', 'DINING_RESERVATION', 'FOOD_ORDERING', 'FOOD_DELIVERY', 'FOOD_TAKEOUT', 'SHOP_ONLINE', 'ONLINE_APPOINTMENT', 'SOLOPRENEUR_APPOINTMENT'];

async function richSectionsFor(
  businessId: string,
  loc: any,
  src: { ownerText: string; intel: any; website: string | null },
) {
  const meta = loc?.metadata || {};
  const [foodMenu, lodging, buttons] = await Promise.all([
    // Food menu: the current Google menu as an editable draft.
    meta.canHaveFoodMenus === true
      ? getFoodMenus(businessId)
          .then((m) => ({ allowed: true, current: foodMenusToDraft(m), readable: true }))
          .catch(() => ({ allowed: true, current: null, readable: false }))
      : Promise.resolve(null),
    // Hotel details: current values + amenities their own text / website mention (pre-ticked).
    meta.canOperateLodgingData === true
      ? getLodging(businessId, LODGING_FIELDS.map((f) => f.path).join(','))
          .then((raw) => {
            const current = flattenLodging(raw, LODGING_FIELDS.map((f) => f.path));
            const text = [
              src.ownerText,
              src.intel?.description?.value, src.intel?.metaDescription, src.intel?.title,
              ...(src.intel?.differentiators || []).map((c: any) => c?.value),
              ...(src.intel?.headings || []).map((c: any) => c?.value),
              ...(src.intel?.services || []).map((c: any) => c?.value),
            ].filter(Boolean).join('\n');
            return {
              allowed: true,
              readable: true,
              fields: LODGING_FIELDS.map(({ path, label, group, type }) => ({ path, label, group, type })),
              current,
              suggested: suggestLodgingFromText(text, current),
            };
          })
          .catch(() => ({ allowed: true, readable: false, fields: [], current: {}, suggested: [] as string[] }))
      : Promise.resolve(null),
    // Booking / order buttons: the types Google offers here, what is set, a link to suggest.
    Promise.all([listPlaceActionTypes(businessId).catch(() => null), listPlaceActionLinks(businessId).catch(() => null)])
      .then(([types, links]) => {
        if (!types || !types.length) return null;
        const bookingLinks: string[] = (src.intel?.bookingLinks || [])
          .map((c: any) => String(c?.value || c?.sourceUrl || '').trim())
          .filter((u: string) => /^https:\/\//i.test(u));
        const allowed = types.map((t) => t.placeActionType).filter((t): t is PlaceActionType => t in PLACE_ACTION_LABEL);
        return {
          readable: !!links,
          types: [...allowed].sort((a, b) => BUTTON_ORDER.indexOf(a) - BUTTON_ORDER.indexOf(b)).map((type) => {
            const mine = (links || []).find((l) => l.placeActionType === type && l.isEditable && l.providerType !== 'AGGREGATOR_3P');
            const partner = (links || []).find((l) => l.placeActionType === type && l.providerType === 'AGGREGATOR_3P');
            return {
              placeActionType: type,
              label: PLACE_ACTION_LABEL[type],
              current: mine?.uri || null,
              partner: partner ? partner.uri : null,
              // Their website's own booking / order page; for shops, the website itself.
              suggested: mine ? null : bookingLinks[0] || (type === 'SHOP_ONLINE' && src.website && /^https:/i.test(src.website) ? src.website : null),
            };
          }),
        };
      }),
  ]);
  return { foodMenu, lodging, buttons };
}
