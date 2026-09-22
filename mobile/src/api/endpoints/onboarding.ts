import { z } from 'zod';
import { api } from '../client';

/**
 * In-app onboarding — the mobile counterpart of the website's two onboarding
 * phases:
 *
 *   1. Business creation. Find the business on Google (public autocomplete /
 *      place-details endpoints — same ones the web signup wizard uses), then
 *      POST /api/business/add-workspace to create the workspace. Only reached
 *      when a signed-in user somehow has no workspace at all.
 *   2. "Tell us about your business" intake — GET/POST /api/onboarding/intake,
 *      the richer marketing profile the web hard-gates the dashboard behind.
 *
 * Google Business Profile connection is not an API call here: it opens the web
 * OAuth flow in an in-app browser (see lib/connectGoogle.tsx), same as every
 * other GBP-connect entry point in the app.
 */

// --- Google Places search ---------------------------------------------------

export const placeSuggestionSchema = z.object({
  placeId: z.string(),
  mainText: z.string().catch(''),
  secondaryText: z.string().catch(''),
});
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

/** GET /api/google/autocomplete — public (IP rate-limited) on the backend. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const { data } = await api.get('/api/google/autocomplete', { params: { q: query } });
  return z
    .object({ success: z.boolean().catch(false), data: z.array(placeSuggestionSchema).catch([]) })
    .parse(data)
    .data;
}

export const placeDetailsSchema = z.object({
  name: z.string().catch(''),
  formattedAddress: z.string().nullable().catch(null),
  phoneNumber: z.string().nullable().catch(null),
  website: z.string().nullable().catch(null),
  googleMapsUrl: z.string().nullable().catch(null),
  latitude: z.number().nullable().catch(null),
  longitude: z.number().nullable().catch(null),
  area: z.string().nullable().catch(null),
  city: z.string().nullable().catch(null),
  state: z.string().nullable().catch(null),
  country: z.string().nullable().catch(null),
  primaryCategory: z.string().nullable().catch(null),
  editorialSummary: z.string().nullable().catch(null),
});
export type PlaceDetails = z.infer<typeof placeDetailsSchema>;

/** GET /api/google/place-details — public (IP rate-limited) on the backend. */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const { data } = await api.get('/api/google/place-details', { params: { placeId } });
  return z
    .object({ success: z.boolean().catch(false), data: placeDetailsSchema })
    .parse(data)
    .data;
}

// --- Workspace creation ---------------------------------------------------------

export interface CreateWorkspaceInput {
  businessName: string;
  category: string;
  city: string;
  area?: string;
  state?: string;
  country?: string;
  phone?: string;
  website?: string;
  address?: string;
  description?: string;
  googlePlaceId?: string;
  googleMapsUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
}

/** POST /api/business/add-workspace — returns the new workspace's id. */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<string> {
  const { data } = await api.post('/api/business/add-workspace', input);
  return z
    .object({ success: z.literal(true), businessId: z.string() })
    .parse(data)
    .businessId;
}

// --- Intake ("Tell us about your business") -----------------------------------

export const intakeSchema = z.object({
  category: z.string().catch(''),
  description: z.string().catch(''),
  services: z.string().catch(''),
  offers: z.string().catch(''),
  keywords: z.array(z.string()).catch([]),
  city: z.string().catch(''),
  area: z.string().catch(''),
  tone: z.string().catch('professional'),
  uniqueSellingPoints: z.string().catch(''),
  targetAudience: z.string().catch(''),
  competitorNames: z.array(z.string()).catch([]),
  primaryGoal: z.string().catch(''),
});
export type IntakeData = z.infer<typeof intakeSchema>;

export const EMPTY_INTAKE: IntakeData = {
  category: '', description: '', services: '', offers: '', keywords: [],
  city: '', area: '', tone: 'professional', uniqueSellingPoints: '',
  targetAudience: '', competitorNames: [], primaryGoal: '',
};

/** GET /api/onboarding/intake — prefill + whether it's already done. */
export async function fetchIntake(): Promise<{ intakeCompleted: boolean; data: IntakeData }> {
  const { data } = await api.get('/api/onboarding/intake');
  return z
    .object({
      success: z.boolean().catch(false),
      intakeCompleted: z.boolean().catch(false),
      data: intakeSchema.catch(EMPTY_INTAKE),
    })
    .parse(data);
}

/** POST /api/onboarding/intake — saves the profile + marks intakeCompleted. */
export async function saveIntake(input: IntakeData): Promise<void> {
  await api.post('/api/onboarding/intake', input);
}

/** POST /api/onboarding/suggest-keywords — AI target-keyword suggestions. */
export async function suggestKeywords(input: {
  category: string;
  description?: string;
  selectedKeywords?: string[];
  excludeKeywords?: string[];
}): Promise<string[]> {
  const { data } = await api.post('/api/onboarding/suggest-keywords', input);
  return z
    .object({ success: z.boolean().catch(false), keywords: z.array(z.string()).catch([]) })
    .parse(data)
    .keywords;
}
