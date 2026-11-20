/**
 * S0 of the free report (docs/FREE_REPORT_REBUILD_PLAN.md): read the
 * business's REAL Google listing before anything is searched.
 *
 * Why: the sign-up form saves Google Places' rough type ("Services",
 * "Manufacturer", "Medical Clinic"), not the category the owner chose on the
 * profile. Checked on 22 real free reports (Nov 2026): 15 of 21 were searched
 * with the wrong category ("medical clinic" for a "Mental health service",
 * "banking and finance" for a "Property investment company").
 *
 * How: one Google Maps search (DataForSEO, $0.002) for the business's own name
 * at its pin. Only a result whose Place ID is the business's own is trusted —
 * a similar name or a nearby pin is never enough to take another listing's
 * category. Saved on the business for 30 days.
 *
 * `pickOwnListing` / `ownListingCategory` are pure (unit-tested); the fetch is
 * a thin wrapper.
 */

export interface OwnListing {
  /** Google's primary category as the profile shows it ("Mental health service"). */
  category: string | null;
  additionalCategories: string[];
  /** Google's short listing description, when it shows one. */
  snippet: string | null;
  website: string | null;
  phone: string | null;
  hasHours: boolean | null;
  bookingUrl: string | null;
  isClaimed: boolean | null;
  totalPhotos: number | null;
  rating: number | null;
  reviewCount: number | null;
  address: string | null;
  /** The search that found it, and when. */
  query: string;
  checkedAt: string;
}

/** A Maps result as DataForSEO returns it (dataForSeoClient.MapsLocalResult). */
interface RawResult {
  title?: string;
  place_id?: string;
  category?: string;
  additionalCategories?: string[];
  snippet?: string;
  website?: string;
  phone?: string;
  hasHours?: boolean;
  bookingUrl?: string;
  isClaimed?: boolean;
  totalPhotos?: number;
  rating?: number;
  reviews?: number;
  address?: string;
}

export const OWN_LISTING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const bareId = (id: unknown) => String(id || '').trim().replace(/^places\//, '');

/** The business's own listing among Maps results — by Place ID only; null when it is not there. */
export function pickOwnListing(results: RawResult[] | null | undefined, placeIds: string[], query: string, now: Date): OwnListing | null {
  const ids = new Set(placeIds.map(bareId).filter(Boolean));
  if (!ids.size || !Array.isArray(results)) return null;
  const r = results.find((x) => x?.place_id && ids.has(bareId(x.place_id)));
  if (!r) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    category: str(r.category),
    additionalCategories: Array.isArray(r.additionalCategories) ? r.additionalCategories.filter((c) => typeof c === 'string' && c.trim()) : [],
    snippet: str(r.snippet),
    website: str(r.website),
    phone: str(r.phone),
    hasHours: typeof r.hasHours === 'boolean' ? r.hasHours : null,
    bookingUrl: str(r.bookingUrl),
    isClaimed: typeof r.isClaimed === 'boolean' ? r.isClaimed : null,
    totalPhotos: typeof r.totalPhotos === 'number' ? r.totalPhotos : null,
    rating: typeof r.rating === 'number' ? r.rating : null,
    reviewCount: typeof r.reviews === 'number' ? r.reviews : null,
    address: str(r.address),
    query,
    checkedAt: now.toISOString(),
  };
}

/** The search for the business's own listing: its name, plus the city when the name lacks it. */
export function ownListingQuery(name: string, city: string): string {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const c = String(city || '').trim();
  return c && !n.toLowerCase().includes(c.toLowerCase()) ? `${n} ${c}` : n;
}

/** A saved listing that is still fresh enough to reuse. */
export function isOwnListingFresh(saved: Partial<OwnListing> | null | undefined, now: Date): saved is OwnListing {
  return !!saved?.checkedAt && now.getTime() - new Date(saved.checkedAt).getTime() < OWN_LISTING_TTL_MS;
}

/**
 * The public listing as the report uses it (facts.PublicListingProfile): the
 * ranking searches' view when they showed the business, else the own-listing
 * lookup — so a business that ranks nowhere still gets its real fields.
 */
export function ownListingAsPublicProfile<P extends { observed: boolean }>(fromSearches: P, listing: OwnListing | null): P | (P & {
  observed: true; category: string | null; additionalCategories: string[] | null; website: string | null; phone: string | null;
  hasHours: boolean | null; bookingUrl: string | null; isClaimed: boolean | null; totalPhotos: number | null;
}) {
  if (fromSearches.observed || !listing) return fromSearches;
  return {
    ...fromSearches,
    observed: true,
    category: listing.category,
    additionalCategories: listing.additionalCategories.length ? listing.additionalCategories : null,
    website: listing.website,
    phone: listing.phone,
    hasHours: listing.hasHours,
    bookingUrl: listing.bookingUrl,
    isClaimed: listing.isClaimed,
    totalPhotos: listing.totalPhotos,
  };
}

/** Placeholder values that are not a category at all. */
const PLACEHOLDER = /^(local business|business|establishment|point of interest|point_of_interest)$/i;

/**
 * The category the report searches with. Google's own listing wins over the
 * rough type saved at sign-up; a category the owner confirmed in intake wins
 * over both (the owner knows their business). Placeholders never win.
 */
export function ownListingCategory(input: {
  listing: Pick<OwnListing, 'category'> | null;
  ownerConfirmed: string | null;
  stored: string | null;
  fromPlaceTypes: string | null;
}): { category: string; source: 'owner' | 'google_listing' | 'signup' | 'place_types' | 'none' } {
  const ok = (c: string | null | undefined): c is string => !!c && !!c.trim() && !PLACEHOLDER.test(c.trim());
  if (ok(input.ownerConfirmed)) return { category: input.ownerConfirmed.trim(), source: 'owner' };
  if (ok(input.listing?.category)) return { category: input.listing!.category!.trim(), source: 'google_listing' };
  if (ok(input.stored)) return { category: input.stored.trim(), source: 'signup' };
  if (ok(input.fromPlaceTypes)) return { category: input.fromPlaceTypes.trim(), source: 'place_types' };
  return { category: 'Local Business', source: 'none' };
}

/**
 * Fetch (or reuse) the business's own listing. Never throws: no pin, no Place
 * ID, DataForSEO off or failing → null, and the report uses the sign-up data
 * as before.
 */
export async function getOwnListing(business: any, opts: { city: string; now?: Date }): Promise<{ listing: OwnListing | null; fetched: boolean }> {
  const now = opts.now ?? new Date();
  if (isOwnListingFresh(business?.googleListing, now)) return { listing: business.googleListing, fetched: false };
  const placeIds = [business?.googlePlaceId, business?.placeId].filter(Boolean).map(String);
  const lat = Number(business?.coordinates?.lat);
  const lng = Number(business?.coordinates?.lng);
  if (!placeIds.length || !business?.name) return { listing: null, fetched: false };
  try {
    const { fetchMapsLocalResults } = require('./dataForSeoClient');
    const query = ownListingQuery(business.name, opts.city);
    const results = await fetchMapsLocalResults(query, {
      point: Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : undefined,
      business,
    });
    return { listing: pickOwnListing(results, placeIds, query, now), fetched: true };
  } catch (err: any) {
    console.warn('[ownListing] lookup failed — using sign-up data:', err?.message);
    return { listing: null, fetched: true };
  }
}
