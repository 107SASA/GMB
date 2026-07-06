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
  totalScheduledPosts: z.number().catch(0),
  daysCovered: z.number().catch(0),
  healthStatus: z.enum(['Healthy', 'Warning', 'Critical']).catch('Critical'),
  missingDays: z.number().catch(0),
  upcomingPosts: postList,
  allPosts: postList,
});
export type Buffer = z.infer<typeof bufferSchema>;

/** GET /api/scheduler/buffer — 7-day health window + calendar posts. */
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
