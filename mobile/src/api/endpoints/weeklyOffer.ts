import { z } from 'zod';
import { api } from '../client';

/**
 * Weekly "Anything to promote this week?" question — mirrors the web
 * WeeklyOfferPrompt (GET/POST /api/content/weekly-offer). Asked once per
 * business per week; only the owner's own words become an offer post.
 */
const stateSchema = z.object({
  success: z.boolean().catch(false),
  eligible: z.boolean().catch(false),
  weekKey: z.string().catch(''),
  answered: z.string().nullable().catch(null),
  festivals: z
    .array(z.object({ name: z.string(), date: z.string(), approximate: z.boolean().catch(false) }))
    .catch([]),
  photos: z.array(z.object({ id: z.string(), url: z.string() })).catch([]),
});
export type WeeklyOfferState = z.infer<typeof stateSchema>;

export async function fetchWeeklyOffer(): Promise<WeeklyOfferState> {
  const { data } = await api.get('/api/content/weekly-offer');
  return stateSchema.parse(data);
}

export async function answerWeeklyOffer(
  input: { answer: 'no' | 'dismiss' } | { answer: 'yes'; text: string; festivalName?: string; imageId?: string }
): Promise<void> {
  await api.post('/api/content/weekly-offer', input);
}
