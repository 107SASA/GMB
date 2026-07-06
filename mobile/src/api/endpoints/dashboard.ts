import { z } from 'zod';
import { api } from '../client';

/**
 * GET /api/dashboard/stats — same aggregate the web dashboard renders.
 * Only the fields the mobile dashboard shows are validated; the charts the
 * web renders (donut, stars distribution) are ignored here.
 */
const recentLeadSchema = z.object({
  _id: z.string(),
  name: z.string().catch('Unknown'),
  source: z.string().nullable().optional(),
  pipelineStage: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type RecentLead = z.infer<typeof recentLeadSchema>;

const dashboardStatsSchema = z.object({
  success: z.literal(true),
  data: z.object({
    metrics: z.object({
      totalLeads: z.number().catch(0),
      convertedLeads: z.number().catch(0),
      conversionRate: z.number().catch(0),
      totalReviews: z.number().catch(0),
      avgRating: z.number().catch(0),
      unansweredReviews: z.number().catch(0),
      postsPublished: z.number().catch(0),
    }),
    charts: z.object({
      // Used to derive "new leads in range" (each point is one day's count).
      leadsOverTime: z.array(z.object({ date: z.string(), leads: z.number() })).catch([]),
    }),
    panels: z.object({
      recentLeads: z.array(recentLeadSchema.nullable().catch(null)).catch([]),
    }),
  }),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>['data'];

export async function fetchDashboardStats(rangeDays = 30): Promise<DashboardStats> {
  const { data } = await api.get('/api/dashboard/stats', { params: { range: rangeDays } });
  return dashboardStatsSchema.parse(data).data;
}

/**
 * GET /api/gbp/insights — Google Business Profile performance. Returns
 * { connected: false } until the business has linked its Google account.
 */
const gbpInsightsSchema = z.object({
  connected: z.boolean(),
  // Same fields the web GBPSection renders — keep 1:1 so numbers match the site.
  summary: z
    .object({
      totalViews: z.number().catch(0),
      totalCallClicks: z.number().catch(0),
      totalWebsiteClicks: z.number().catch(0),
      totalDirectionRequests: z.number().catch(0),
      totalConversations: z.number().catch(0),
    })
    .optional(),
  changes: z
    .object({
      views: z.number().nullable().catch(null),
      callClicks: z.number().nullable().catch(null),
      websiteClicks: z.number().nullable().catch(null),
      directionRequests: z.number().nullable().catch(null),
      conversations: z.number().nullable().catch(null),
    })
    .optional(),
  timeSeries: z
    .array(
      z.object({
        date: z.string(),
        views: z.number().catch(0),
        callClicks: z.number().catch(0),
        websiteClicks: z.number().catch(0),
        directionRequests: z.number().catch(0),
      })
    )
    .catch([])
    .optional(),
});
export type GbpInsights = z.infer<typeof gbpInsightsSchema>;

export async function fetchGbpInsights(rangeDays: 7 | 14 | 28 | 90 = 28): Promise<GbpInsights> {
  const { data } = await api.get('/api/gbp/insights', { params: { range: rangeDays } });
  return gbpInsightsSchema.parse(data);
}

/**
 * GET /api/posts?status=scheduled — the posts API returns a bare page of
 * posts (no total), so the dashboard shows the count of the first page,
 * capped at 99.
 */
export async function fetchScheduledPostsCount(): Promise<number> {
  const { data } = await api.get('/api/posts', {
    params: { status: 'scheduled', page: 1, limit: 99 },
  });
  return Array.isArray(data) ? data.length : 0;
}
