import { z } from 'zod';
import { api } from '../client';
import { contentPostSchema, type ContentPost } from './content';

/**
 * Content Scheduler — buffer health + post actions. Generation runs as an
 * async Inngest job; the UI just refetches the buffer a few seconds later
 * (matches the web SchedulerDashboard).
 */

const postList = z
  .array(contentPostSchema.nullable().catch(null))
  .catch([])
  .transform((posts) => posts.filter((p): p is ContentPost => p !== null));

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
export async function fetchBuffer(): Promise<Buffer> {
  const { data } = await api.get('/api/scheduler/buffer');
  return z.object({ data: bufferSchema }).parse(data).data;
}

/** POST /api/scheduler/generate — dispatches the background generate job. */
export async function generateBufferPosts(): Promise<void> {
  await api.post('/api/scheduler/generate', {});
}

/** POST /api/scheduler/publish — publishes a post immediately. */
export async function publishPost(postId: string): Promise<void> {
  await api.post('/api/scheduler/publish', { postId });
}

/**
 * POST /api/scheduler/schedule — (re)schedules a post. Server rejects past
 * dates (400) and published posts (409).
 */
export async function schedulePost(postId: string, scheduledDate: Date): Promise<void> {
  await api.post('/api/scheduler/schedule', { postId, scheduledDate: scheduledDate.toISOString() });
}

/** PATCH /api/scheduler/posts/[id] — edits a draft/scheduled post. */
export async function updatePost(
  postId: string,
  patch: { title?: string; content?: string; cta?: string; hashtags?: string[] }
): Promise<void> {
  await api.patch(`/api/scheduler/posts/${postId}`, patch);
}

/** DELETE /api/scheduler/posts/[id] — published posts can't be deleted. */
export async function deletePost(postId: string): Promise<void> {
  await api.delete(`/api/scheduler/posts/${postId}`);
}

/** GET /api/scheduler/posts/[id] — single post, for the post-detail screen. */
export async function fetchPost(postId: string): Promise<ContentPost> {
  const { data } = await api.get(`/api/scheduler/posts/${postId}`);
  return z.object({ success: z.literal(true), post: contentPostSchema }).parse(data).post;
}
