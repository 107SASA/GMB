import axios from "axios";

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = "https://serpapi.com/search.json";

export interface GMBData {
  title: string;
  category: string;
  address: string;
  phone?: string;
  website?: string;
  rating: number;
  reviews: number;
  place_id: string;
  reviews_data: any[];
  photos: any[];
  competitors: any[];
}

export async function fetchGMBData(query: string): Promise<GMBData> {
  if (!SERPAPI_KEY) {
    throw new Error("SERPAPI_KEY is not defined");
  }

  try {
    const response = await axios.get(BASE_URL, {
      params: {
        engine: "google_maps",
        q: query,
        api_key: SERPAPI_KEY,
      },
    });

    const result = response.data.place_results || response.data.local_results?.[0];

    if (!result) {
      throw new Error("No business data found for the given query");
    }

    // SerpApi usually includes reviews and photos in the main response or sub-endpoints
    return {
      title: result.title,
      category: result.category,
      address: result.address,
      phone: result.phone,
      website: result.website,
      rating: result.rating,
      reviews: result.reviews,
      place_id: result.place_id,
      reviews_data: result.reviews_highlight || [], // Or another reviews field
      photos: result.photos || [],
      competitors: response.data.local_results?.slice(1, 5) || [],
    };
  } catch (error: any) {
    console.error("Error fetching Google Maps data via SerpApi:", error.message);
    throw error;
  }
}
