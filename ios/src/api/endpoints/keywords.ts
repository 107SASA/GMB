import { z } from 'zod';
import { api } from '../client';

/**
 * Keywords — mirrors the website's SEO Plan → Keywords tab
 * (src/components/seo/KeywordsPanel.tsx) and its routes:
 *   GET  /api/keywords                    owner keywords, targets, competitors, gaps, GBP searches
 *   POST /api/keywords                    pin / unpin a focus keyword
 *   POST /api/onboarding/keyword-volume   Google monthly searches for typed keywords
 * Every number is measured server-side (Google Ads volume, Google Maps rank);
 * the labels ("2,400 / month", "#9", "Not in top 20") come ready-made from the
 * server, so the app and the website always show the same text.
 */

const tone = z.enum(['good', 'warn', 'bad', 'neutral']).catch('neutral');
const competitor = z.object({
  name: z.string().catch(''),
  rank: z.number().catch(0),
  reviews: z.number().nullable().catch(null),
  rating: z.number().nullable().catch(null),
});

export const keywordRowSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  role: z.enum(['core', 'rotating', 'owner', 'watch', 'pending']).catch('watch'),
  roleLabel: z.string().catch(''),
  owner: z.boolean().catch(false),
  pinned: z.boolean().catch(false),
  volumeText: z.string().catch('—'),
  volumeNote: z.string().nullable().catch(null),
  volume: z.number().nullable().catch(null),
  rankText: z.string().catch('—'),
  rank: z.number().nullable().catch(null),
  trend: z.number().nullable().catch(null),
  topCompetitor: z.object({ name: z.string(), rank: z.number() }).nullable().catch(null),
  competitorsAbove: z.array(competitor).catch([]),
  verdictLabel: z.string().catch(''),
  tone,
  reason: z.string().catch(''),
});
export type KeywordRow = z.infer<typeof keywordRowSchema>;
export type KeywordTone = z.infer<typeof tone>;

const rows = z.array(keywordRowSchema.nullable().catch(null)).catch([]).transform((list) => list.filter((r): r is KeywordRow => !!r));

export const keywordsSchema = z.object({
  success: z.literal(true),
  hasResearch: z.boolean().catch(false),
  yours: rows,
  targets: rows,
  competitors: rows,
  gaps: z
    .array(z.object({
      keyword: z.string(),
      volumeText: z.string().catch('Few searches'),
      competitor: z.string().catch(''),
      competitorRank: z.number().nullable().catch(null),
    }).nullable().catch(null))
    .catch([])
    .transform((list) => list.filter((g): g is NonNullable<typeof g> => !!g)),
  searchTerms: z.array(z.object({ keyword: z.string(), impressions: z.number().catch(0) })).catch([]),
  searchTermsMonth: z.string().nullable().catch(null),
  research: z
    .object({ candidates: z.number().catch(0), withVolume: z.number().catch(0), rankChecked: z.number().catch(0), ranAt: z.string().catch('') })
    .nullable()
    .catch(null),
  googleConnected: z.boolean().catch(false),
});
export type KeywordsData = z.infer<typeof keywordsSchema>;

export async function fetchKeywords(): Promise<KeywordsData> {
  const { data } = await api.get('/api/keywords');
  return keywordsSchema.parse(data);
}

export async function setKeywordPinned(id: string, pinned: boolean): Promise<boolean> {
  const { data } = await api.post('/api/keywords', { action: pinned ? 'pin' : 'unpin', id });
  return z.object({ success: z.literal(true), pinned: z.boolean() }).parse(data).pinned;
}

/** keyword → monthly searches (null = too few); absent = not looked up. Capped server-side. */
export async function fetchKeywordVolumes(keywords: string[]): Promise<Record<string, number | null>> {
  if (!keywords.length) return {};
  const { data } = await api.post('/api/onboarding/keyword-volume', { keywords: keywords.slice(0, 30) });
  return z.object({ success: z.literal(true), volumes: z.record(z.string(), z.number().nullable()).catch({}) }).parse(data).volumes;
}

/** "320/mo" / "few searches" — the same short label the website's tags use. */
export function volumeLabel(v: number | null | undefined): string {
  return v == null || v <= 0 ? 'few searches' : `${v.toLocaleString('en-IN')}/mo`;
}
