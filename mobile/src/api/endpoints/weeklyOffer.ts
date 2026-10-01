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

/** This week's stored offer exactly as the owner entered it (same endpoint, more fields). */
const offerSchema = z.object({
  answered: z.string().nullable().catch(null),
  offer: z
    .object({
      text: z.string(),
      festivalName: z.string().nullable().catch(null),
      endsAt: z.string().nullable().catch(null),
      appliedToPost: z.boolean().catch(false),
    })
    .nullable()
    .catch(null),
});
export type StoredWeeklyOffer = z.infer<typeof offerSchema>;

export async function fetchStoredWeeklyOffer(): Promise<StoredWeeklyOffer> {
  const { data } = await api.get('/api/content/weekly-offer');
  return offerSchema.parse(data);
}

/**
 * GET /api/content/autopilot-status — also starts autopilot right away when
 * the business qualifies (server-side, idempotent). `generating` = a batch
 * is being made right now; `stalled` = it was started over 75 min ago and
 * no posts arrived.
 */
const autopilotSchema = z.object({
  hasKeywords: z.boolean().catch(false),
  qualified: z.boolean().catch(false),
  nextRunAt: z.string().nullable().catch(null),
  generating: z.boolean().catch(false),
  stalled: z.boolean().catch(false),
});
export type AutopilotStatus = z.infer<typeof autopilotSchema>;

export async function fetchAutopilotStatus(): Promise<AutopilotStatus> {
  const { data } = await api.get('/api/content/autopilot-status');
  return autopilotSchema.parse(data);
}
