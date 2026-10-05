import { z } from 'zod';
import { api, businessHeaders } from '../client';
import { contentPostSchema, parsePostList, type ContentPost } from './content';

/**
 * Content Scheduler — buffer health + post actions. Generation runs as an
 * async Inngest job; the UI just refetches the buffer a few seconds later
 * (matches the web SchedulerDashboard).
 */

const postList = z.array(z.unknown()).transform((rows) => parsePostList(rows));

export const bufferSchema = z.object({
  // Posts-per-week model (matches the web /api/scheduler/buffer response). The
  // old `daysCovered` / `missingDays` fields were removed server-side; a plan
  // generates POSTS_PER_WEEK (4) posts on alternate days, so "days covered" is
  // no longer meaningful.
  weeklyTarget: z.number().catch(4),
  scheduledThisWeek: z.number().catch(0),
  postsNeeded: z.number().catch(0),
  unscheduledDrafts: z.number().catch(0),
  healthStatus: z.enum(['Healthy', 'Warning', 'Critical']).catch('Critical'),
  upcomingPosts: postList,
  allPosts: postList,
});
export type Buffer = z.infer<typeof bufferSchema>;

/** GET /api/scheduler/buffer — weekly post-buffer health + calendar posts. */
export async function fetchBuffer(businessId: string): Promise<Buffer> {
  const { data } = await api.get('/api/scheduler/buffer', businessHeaders(businessId));
  const parsed = z.object({ success: z.literal(true), data: bufferSchema }).safeParse(data);
  if (!parsed.success) {
    throw new Error('Unexpected scheduler response');
  }
  return parsed.data.data;
}


export type PublishResult = { outcome: 'published' } | { outcome: 'blocked'; message: string };

/**
 * POST /api/scheduler/publish — publishes a post immediately. `blocked`
 * means Google publishing is switched off: the post is NOT on Google.
 * A Google rejection comes back as an HTTP error (thrown).
 */
export async function publishPost(postId: string, businessId?: string): Promise<PublishResult> {
  const { data } = await api.post('/api/scheduler/publish', { postId }, businessId ? businessHeaders(businessId) : undefined);
  if (data?.blocked) {
    return { outcome: 'blocked', message: typeof data.message === 'string' ? data.message : 'Google publishing has not been executed.' };
  }
  return { outcome: 'published' };
}

/**
 * POST /api/scheduler/schedule — (re)schedules a post. Server rejects past
 * dates (400) and published posts (409).
 */
export async function schedulePost(postId: string, scheduledDate: Date, businessId?: string): Promise<void> {
  await api.post(
    '/api/scheduler/schedule',
    { postId, scheduledDate: scheduledDate.toISOString() },
    businessId ? businessHeaders(businessId) : undefined,
  );
}

/** PATCH /api/scheduler/posts/[id] — edits a draft/scheduled post. */
export async function updatePost(
  postId: string,
  patch: { title?: string; content?: string; cta?: string; hashtags?: string[] },
  businessId?: string,
): Promise<void> {
  await api.patch(`/api/scheduler/posts/${postId}`, patch, businessId ? businessHeaders(businessId) : undefined);
}

/** DELETE /api/scheduler/posts/[id] — published posts can't be deleted. */
export async function deletePost(postId: string, businessId?: string): Promise<void> {
  await api.delete(`/api/scheduler/posts/${postId}`, businessId ? businessHeaders(businessId) : undefined);
}

/** GET /api/scheduler/posts/[id] — single post, for the post-detail screen. */
export async function fetchPost(postId: string, businessId?: string): Promise<ContentPost> {
  const { data } = await api.get(`/api/scheduler/posts/${postId}`, businessId ? businessHeaders(businessId) : undefined);
  return z.object({ success: z.literal(true), post: contentPostSchema }).parse(data).post;
}
