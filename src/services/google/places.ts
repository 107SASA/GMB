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
}

export class GooglePlacesService {
  private static getApiKey() {
    return process.env.GOOGLE_MAPS_API_KEY || '';
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
      throw new Error(`Google API Error: ${data.status}`);
    }

    return (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || p.description,
      secondaryText: p.structured_formatting?.secondary_text || ""
    }));
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
    url.searchParams.append("fields", "name,formatted_address,formatted_phone_number,website,url,rating,user_ratings_total,geometry,types");

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error(`Google API Error: ${data.status}`);
    }

    const r = data.result;
    return {
      placeId,
      name: r.name || '',
      formattedAddress: r.formatted_address || '',
      phoneNumber: r.formatted_phone_number || '',
      website: r.website || '',
      googleMapsUrl: r.url || '',
      rating: r.rating || 0,
      totalReviews: r.user_ratings_total || 0,
      latitude: r.geometry?.location?.lat,
      longitude: r.geometry?.location?.lng,
      categories: r.types || []
    };
  }
}
