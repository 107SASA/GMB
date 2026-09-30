import dbConnect from '@/lib/mongodb';
import { isPlausibleCoord, type VerifiedLocation } from '@/lib/imageGeotag';

/**
 * The business location as GOOGLE has it — the only coordinates GrowwMatics
 * ever writes into image GPS metadata.
 *
 *   1. connected profile pin (Business Information `latlng`, free), else
 *   2. Google Places (New) `location` for the profile's own place id
 *      (Essentials SKU, one call, then cached).
 *
 * Business.coordinates is NOT used: it arrives from the browser at onboarding
 * and can be edited through the business PATCH endpoint, so it is not verified.
 * Cached on Business.verifiedLocation for 30 days. Returns null when Google
 * can't confirm a location — images then get no added GPS.
 */

const MAX_AGE_MS = 30 * 86_400_000;

export interface LocationDeps {
  fetchPin?: (businessId: string) => Promise<{ lat?: number; lng?: number; placeId?: string }>;
  fetchPlace?: (placeId: string) => Promise<{ lat: number; lng: number } | null>;
}

async function placeLocation(placeId: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'location' },
  });
  const { meter } = await import('@/lib/providerMeter');
  meter('googleDetailsNewEssentials', 1, 'verified_location');
  if (!res.ok) return null;
  const d = await res.json();
  return isPlausibleCoord(d.location?.latitude, d.location?.longitude) ? { lat: d.location.latitude, lng: d.location.longitude } : null;
}

export async function getVerifiedBusinessLocation(businessId: string, opts: { deps?: LocationDeps; now?: Date } = {}): Promise<VerifiedLocation | null> {
  await dbConnect();
  const { default: Business } = await import('@/models/Business');
  const b: any = await Business.findById(businessId).select('verifiedLocation googleConnected').lean();
  if (!b) return null;
  const now = opts.now ?? new Date();
  const cached = b.verifiedLocation;
  if (cached?.verifiedAt && now.getTime() - new Date(cached.verifiedAt).getTime() < MAX_AGE_MS && isPlausibleCoord(cached.lat, cached.lng)) {
    return { lat: cached.lat, lng: cached.lng, source: cached.source, placeId: cached.placeId, verifiedAt: new Date(cached.verifiedAt).toISOString() };
  }
  if (!b.googleConnected) return null;
  try {
    const fetchPin = opts.deps?.fetchPin ?? (async (id: string) => (await import('@/lib/gbpClient')).fetchLocationPin(id));
    const pin = await fetchPin(businessId);
    let loc: VerifiedLocation | null = null;
    if (isPlausibleCoord(pin.lat, pin.lng)) loc = { lat: pin.lat as number, lng: pin.lng as number, source: 'gbp_location', placeId: pin.placeId };
    else if (pin.placeId) {
      const p = await (opts.deps?.fetchPlace ?? placeLocation)(pin.placeId);
      if (p) loc = { ...p, source: 'google_places', placeId: pin.placeId };
    }
    if (!loc) return null;
    loc.verifiedAt = now.toISOString();
    await Business.updateOne({ _id: businessId }, { $set: { verifiedLocation: { lat: loc.lat, lng: loc.lng, source: loc.source, placeId: loc.placeId, verifiedAt: now } } });
    return loc;
  } catch (err: any) {
    console.warn(`[verifiedLocation] Google could not confirm a location for ${businessId}:`, err?.message);
    return null;
  }
}
