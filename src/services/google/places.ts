export interface AutocompleteResult {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetailsResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  phoneNumber?: string;
  website?: string;
  googleMapsUrl?: string;
  rating?: number;
  totalReviews?: number;
  latitude?: number;
  longitude?: number;
  categories: string[];
  /** Parsed from address_components so onboarding can autofill the address fields. */
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  /** Best-guess human-readable business category derived from `types`. */
  primaryCategory?: string;
  /**
   * Google's own one-line summary of the place (`editorial_summary.overview`).
   * Only a minority of listings have one — Google writes these mostly for
   * well-known places — so treat it as a bonus, not something to rely on.
   */
  editorialSummary?: string;
  /**
   * `photos`/`opening_hours` — added to close 2 of the free-report's
   * "Unknown" profile-completion fields (Business Photos, Business Hours)
   * at zero marginal Google API cost: `photos` is Basic Data (no per-request
   * surcharge) and `opening_hours` is Contact Data, a tier this call already
   * pays for via phoneNumber/website. See calculateProfileCompletion in
   * seoAnalyzer.ts for how these feed the checklist.
   */
  photoCount?: number;
  hasHours?: boolean;
}

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

/** First component whose `types` include any of `wanted`, in priority order. */
function pickComponent(
  components: AddressComponent[],
  wanted: string[]
): string | undefined {
  for (const type of wanted) {
    const hit = components.find((c) => c.types.includes(type));
    if (hit?.long_name) return hit.long_name;
  }
  return undefined;
}

// Container types that describe *what kind of thing a place is* too vaguely to
// show a user as their business category. Exported so competitorService.ts
// can reuse the same generic-type exclusion when deriving a candidate's
// category from its own Places `types[]`.
export const GENERIC_PLACE_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'premise',
  'subpremise',
  'geocode',
  'political',
  'food',
  'health',
  'finance',
  'place_of_worship',
]);

/** "dental_clinic" -> "Dental Clinic". Returns undefined if only generic types. */
export function deriveCategory(types: string[] = []): string | undefined {
  const specific = types.find((t) => !GENERIC_PLACE_TYPES.has(t));
  if (!specific) return undefined;
  return specific
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export class GooglePlacesService {
  private static getApiKey() {
    return process.env.GOOGLE_MAPS_API_KEY || '';
  }

  /**
   * Places API "New" (v1) primaryTypeDisplayName — Google's own human-
   * readable category (e.g. "Software Company"), not derived from the
   * coarse legacy `types` enum. A different REST surface from the legacy
   * Details call above (places.googleapis.com, not maps.googleapis.com),
   * gated on the same GOOGLE_MAPS_API_KEY but requires "Places API (New)"
   * to be separately enabled on the Google Cloud project — if it isn't
   * (or the call fails for any other reason), this returns undefined and
   * callers fall back to deriveCategory(types) exactly as before this was
   * added. Best-effort only; never throws.
   */
  private static async getPrimaryTypeDisplayName(placeId: string): Promise<string | undefined> {
    const apiKey = this.getApiKey();
    if (!apiKey) return undefined;
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'primaryTypeDisplayName',
        },
      });
      if (!res.ok) {
        // Most commonly: Places API (New) not enabled on this project (403)
        // or an invalid placeId (404) — either way, silently defer to the
        // legacy-types fallback rather than failing the whole details fetch.
        console.warn(`[places] Places API (New) primaryTypeDisplayName lookup failed (HTTP ${res.status}) for placeId=${placeId} — falling back to legacy types[].`);
        return undefined;
      }
      const data = await res.json();
      return data?.primaryTypeDisplayName?.text || undefined;
    } catch (e: any) {
      console.warn(`[places] Places API (New) primaryTypeDisplayName lookup threw for placeId=${placeId}:`, e?.message);
      return undefined;
    }
  }

  /**
   * Text Search fallback for when Autocomplete comes up empty — confirmed
   * (Aug 2026, live test against a brand-new GBP listing) that Autocomplete
   * and Text Search are NOT the same index: Autocomplete's predictive
   * ranking weights prominence (review count, click history, verification
   * age) heavily and has no location bias here, so a genuinely OPERATIONAL,
   * just-created listing can return ZERO_RESULTS from Autocomplete while
   * Text Search finds it immediately. Only called when the primary
   * Autocomplete call found nothing, so it doesn't add cost/latency to the
   * common case where Autocomplete already works.
   */
  private static async textSearchFallback(query: string, apiKey: string): Promise<AutocompleteResult[]> {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      url.searchParams.append("query", query);
      url.searchParams.append("key", apiKey);

      const response = await fetch(url.toString());
      const data = await response.json();
      if (data.status !== "OK") return [];

      return (data.results || []).slice(0, 5).map((r: any) => ({
        placeId: r.place_id,
        description: `${r.name}, ${r.formatted_address || ''}`.trim(),
        mainText: r.name,
        secondaryText: r.formatted_address || "",
      }));
    } catch (e: any) {
      console.warn('[places] Text Search fallback failed:', e?.message);
      return [];
    }
  }

  static async autocomplete(query: string): Promise<AutocompleteResult[]> {
    if (!query) return [];

    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn("GOOGLE_MAPS_API_KEY is not set.");
      return [];
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.append("input", query);
    url.searchParams.append("key", apiKey);
    url.searchParams.append("types", "establishment"); // focus on businesses

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places API error (${data.status}): ${data.error_message || 'no additional details'}`);
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || p.description,
      secondaryText: p.structured_formatting?.secondary_text || ""
    }));

    if (predictions.length > 0) return predictions;
    return this.textSearchFallback(query, apiKey);
  }

  static async getDetails(placeId: string): Promise<PlaceDetailsResult | null> {
    if (!placeId) return null;
    
    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn("GOOGLE_MAPS_API_KEY is not set.");
      return null;
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.append("place_id", placeId);
    url.searchParams.append("key", apiKey);
    // address_components is what makes area/city/state/country autofill possible.
    // Without it the onboarding form could only ever get one flat address string.
    url.searchParams.append(
      "fields",
      "name,formatted_address,address_components,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,geometry,types,editorial_summary,photos,opening_hours"
    );

    // Run alongside the legacy Details call rather than after it — v1 is an
    // independent REST surface (different host, different auth header), so
    // there's nothing to wait on it for.
    const primaryTypeDisplayNamePromise = this.getPrimaryTypeDisplayName(placeId);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error(`Google Places API error (${data.status}): ${data.error_message || 'no additional details'}`);
    }

    const r = data.result;
    const components: AddressComponent[] = r.address_components || [];
    const primaryTypeDisplayName = await primaryTypeDisplayNamePromise;

    return {
      placeId,
      name: r.name || '',
      formattedAddress: r.formatted_address || '',
      // Prefer E.164 ("+91 20 1234 5678") over the national format, since the
      // onboarding form validates against /^\+[1-9]\d{6,14}$/.
      phoneNumber: r.international_phone_number || r.formatted_phone_number || '',
      website: r.website || '',
      googleMapsUrl: r.url || '',
      rating: r.rating || 0,
      totalReviews: r.user_ratings_total || 0,
      latitude: r.geometry?.location?.lat,
      longitude: r.geometry?.location?.lng,
      categories: r.types || [],

      // Neighbourhood / locality within the city.
      area: pickComponent(components, [
        'sublocality_level_1',
        'sublocality',
        'neighborhood',
      ]),
      // `locality` is the city almost everywhere; postal_town covers the UK and
      // administrative_area_level_2 covers Indian districts where locality is absent.
      city: pickComponent(components, [
        'locality',
        'postal_town',
        'administrative_area_level_3',
        'administrative_area_level_2',
      ]),
      state: pickComponent(components, ['administrative_area_level_1']),
      country: pickComponent(components, ['country']),
      postalCode: pickComponent(components, ['postal_code']),
      // Prefer Places API (New)'s real category name; fall back to guessing
      // from the legacy `types` enum only if v1 was unavailable/unenabled.
      primaryCategory: primaryTypeDisplayName || deriveCategory(r.types),
      editorialSummary: r.editorial_summary?.overview || undefined,
      photoCount: Array.isArray(r.photos) ? r.photos.length : 0,
      hasHours: !!(r.opening_hours?.weekday_text?.length || r.opening_hours?.periods?.length),
    };
  }
}
