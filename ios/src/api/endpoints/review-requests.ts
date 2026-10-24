import { z } from 'zod';
import { api } from '../client';

/**
 * Same ReviewRequest backend the web Review Management page reads
 * (GET /api/review-requests). Provider error codes and message SIDs are
 * not part of this response.
 */
const summarySchema = z.object({
  statusLabel: z.string().catch('Pending'),
  sentAt: z.string().nullable().catch(null),
  deliveredAt: z.string().nullable().catch(null),
  readAt: z.string().nullable().catch(null),
  clickedAt: z.string().nullable().catch(null),
  lastRequestAt: z.string().nullable().catch(null),
  followUpLabel: z.string().catch('Not started'),
});

const reviewRequestsSchema = z.object({
  success: z.literal(true),
  metrics: z.object({
    reviewRequests: z.number().catch(0),
    delivered: z.number().catch(0),
    read: z.number().catch(0),
    clicked: z.number().catch(0),
    failed: z.number().catch(0),
  }),
  latestByCustomer: z.record(z.string(), summarySchema).catch({}),
  recent: z.array(z.object({
    customerName: z.string().catch('Customer'),
  }).merge(summarySchema)).catch([]),
});

export type ReviewRequestOverview = z.infer<typeof reviewRequestsSchema>;

export async function fetchReviewRequests(): Promise<ReviewRequestOverview> {
  const { data } = await api.get('/api/review-requests');
  return reviewRequestsSchema.parse(data);
}
