import axios from 'axios';
import { z } from 'zod';
import { api } from '../client';
import { PlanLimitError } from './reviews';

/**
 * Content Generator — mirrors the web ContentWorkspace:
 *   POST /api/content/generate is synchronous but slow (~30–60s), so that
 *   one call gets its own long timeout. Generated posts are saved server-side
 *   as drafts; history and scheduling reuse the scheduler endpoints.
 */

export const generatedPostSchema = z.object({
  _id: z.string().nullable().catch(null),
  title: z.string().catch(''),
  body: z.string().catch(''),
  postType: z.string().nullable().catch(null),
  hashtags: z.array(z.string().catch('')).catch([]),
  cta: z.string().nullable().catch(null),
  imageUrl: z.string().nullable().catch(null),
});
export type GeneratedPost = z.infer<typeof generatedPostSchema>;

const faqSchema = z.object({
  question: z.string().catch(''),
  answer: z.string().catch(''),
});
export type Faq = z.infer<typeof faqSchema>;

export const generateResultSchema = z.object({
  posts: z.array(generatedPostSchema.nullable().catch(null)).catch([]),
  seoDescription: z.string().nullable().catch(null),
  seoScore: z.number().nullable().catch(null),
  faqs: z.array(faqSchema.nullable().catch(null)).catch([]),
});
export type GenerateResult = z.infer<typeof generateResultSchema>;

export interface GenerateContentInput {
  tone: string;
  keywords: string[];
  contentTypes: string[];
  topic?: string;
}

/** POST /api/content/generate — long-running single request (no polling). */
export async function generateContent(input: GenerateContentInput): Promise<GenerateResult> {
  try {
    const { data } = await api.post('/api/content/generate', input, { timeout: 120_000 });
    return z.object({ data: generateResultSchema }).parse(data).data;
  } catch (error) {
    if (axios.isAxiosError(error) && (error.response?.data as any)?.code === 'UPGRADE_REQUIRED') {
      throw new PlanLimitError("This feature isn't included in your current plan.");
    }
    throw error;
  }
}

// --- Content history --------------------------------------------------------

export const contentPostSchema = z.object({
  _id: z.string(),
  title: z.string().catch(''),
  content: z.string().catch(''),
  status: z.string().catch('draft'),
  postType: z.string().nullable().catch(null),
  hashtags: z.array(z.string().catch('')).catch([]),
  cta: z.string().nullable().catch(null),
  scheduledDate: z.string().nullable().catch(null),
  publishedAt: z.string().nullable().catch(null),
  createdAt: z.string().optional(),
});
export type ContentPost = z.infer<typeof contentPostSchema>;

export interface ContentPostsPage {
  posts: ContentPost[];
  total: number;
  hasMore: boolean;
}

/** GET /api/content/posts — paged, AI-generated posts for this business. */
export async function fetchContentPosts(page: number): Promise<ContentPostsPage> {
  const { data } = await api.get('/api/content/posts', { params: { page, limit: 20 } });
  const parsed = z
    .object({
      posts: z.array(contentPostSchema.nullable().catch(null)).catch([]),
      total: z.number().catch(0),
      hasMore: z.boolean().catch(false),
    })
    .parse(data);
  return { ...parsed, posts: parsed.posts.filter((p): p is ContentPost => p !== null) };
}

/**
 * POST /api/content/auto-schedule — schedules the given drafts one per day
 * at 9AM after the last scheduled post.
 */
export async function autoSchedulePosts(postIds: string[]): Promise<{ count: number }> {
  const { data } = await api.post('/api/content/auto-schedule', { postIds });
  return z.object({ count: z.number().catch(postIds.length) }).parse(data);
}
