import { z } from 'zod';

import { api } from '../client';

/**
 * The free Google profile report of a Free CRM workspace — shown on the
 * locked tabs (components/free-report-card.tsx). GET /api/app/free-report.
 */
const reportSchema = z.object({
  auditId: z.string(),
  status: z.enum(['preparing', 'ready', 'failed']).catch('preparing'),
  score: z.number().nullable().catch(null),
  topFixes: z.array(z.string()).catch([]),
  createdAt: z.string().nullable().catch(null),
  /** Full report in "app mode" (no prices / buy buttons). */
  reportUrl: z.string().nullable().catch(null),
});
export type FreeReport = z.infer<typeof reportSchema>;

const responseSchema = z.object({
  success: z.literal(true),
  hasListing: z.boolean().catch(false),
  businessName: z.string().nullable().catch(null),
  report: reportSchema.nullable().catch(null),
});
export type FreeReportState = z.infer<typeof responseSchema>;

export async function fetchFreeReport(): Promise<FreeReportState> {
  const { data } = await api.get('/api/app/free-report');
  return responseSchema.parse(data);
}

/** POST /api/app/free-report — attach a Google listing (if none yet) and start / reuse the report. */
export async function startFreeReport(googlePlaceId?: string): Promise<void> {
  await api.post('/api/app/free-report', googlePlaceId ? { googlePlaceId } : {});
}
