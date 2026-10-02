import { z } from 'zod';
import { api } from '../client';

/**
 * Content — mirrors the web ContentWorkspace: the weekly posts the autopilot
 * created (read + manage). There is no client call that generates posts: the
 * 4 weekly posts are created by the weekly job only.
 */

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
  // The backend's buffer/posts endpoints return raw .lean() Post docs, which
  // already include imageUrl — this was just never declared here before, so
  // zod silently stripped it on every parse.
  imageUrl: z.string().nullable().optional().catch(null),
  /** failed = Google rejected (reason); blocked = Google publishing is off (not on Google). */
  failureReason: z.string().nullable().optional().catch(null),
  /** true only when Google confirmed the post. */
  liveWriteApplied: z.boolean().nullable().optional().catch(null),
  /** Weekly content engine trace (absent on manual posts). */
  contentMeta: z
    .object({
      purpose: z.string().nullable().catch(null).optional(),
      service: z.string().nullable().catch(null).optional(),
      keyword: z.string().nullable().catch(null).optional(),
      keywordMeasured: z.boolean().nullable().catch(null).optional(),
      keywordSource: z.string().nullable().catch(null).optional(),
      /** Why this keyword was chosen — built only from stored evidence. */
      keywordReason: z.string().nullable().catch(null).optional(),
      seoTheme: z.string().nullable().catch(null).optional(),
      festivalName: z.string().nullable().catch(null).optional(),
      draftReason: z.string().nullable().catch(null).optional(),
      /** AI_GENERATED / OWNER_SELECTED / FALLBACK / NONE — where the post image came from. */
      imageOrigin: z.string().nullable().catch(null).optional(),
      imageGeneration: z
        .object({ status: z.string().catch(''), error: z.string().optional() })
        .nullable()
        .catch(null)
        .optional(),
    })
    .nullable()
    .optional()
    .catch(null),
  /** Location metadata written into the image (server geotag policy). */
  imageGeotag: z
    .object({ status: z.string().catch('none'), lat: z.number().optional(), lng: z.number().optional(), source: z.string().optional() })
    .nullable()
    .optional()
    .catch(null),
});
export type ContentPost = z.infer<typeof contentPostSchema>;

const PURPOSE_LABEL: Record<string, string> = {
  seo_theme: 'SEO plan theme', service: 'Service', local: 'Local', festival: 'Festival greeting', offer: 'Your offer', education: 'Educational',
};

/**
 * One status vocabulary for every post surface (matches the web calendar):
 * a post is "Published" only when Google confirmed it; "Not on Google" when
 * it was due but Google publishing is switched off.
 */
export function postStatusView(p: Pick<ContentPost, 'status' | 'scheduledDate' | 'failureReason' | 'contentMeta'>): {
  label: string;
  tone: 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
  note: string | null;
} {
  switch (p.status) {
    case 'published':
      return { label: 'Published', tone: 'positive', note: null };
    case 'blocked':
      return { label: 'Not on Google', tone: 'warning', note: p.failureReason || 'Scheduled in GrowwMatics — Google publishing has not been executed.' };
    case 'failed':
      return { label: 'Failed', tone: 'negative', note: p.failureReason || 'Google did not accept this post.' };
    case 'publishing':
      return { label: 'Publishing', tone: 'info', note: null };
    case 'scheduled':
      return { label: 'Scheduled', tone: 'info', note: null };
    case 'draft':
      return p.contentMeta?.draftReason
        ? { label: 'Needs review', tone: 'warning', note: p.contentMeta.draftReason }
        : { label: 'Draft', tone: 'neutral', note: null };
    default:
      return { label: p.scheduledDate ? 'Scheduled' : 'Draft', tone: p.scheduledDate ? 'info' : 'neutral', note: null };
  }
}

/** "SEO plan theme · bathroom renovation nashik (measured keyword)" — or null for manual posts. */
export function postPlanLine(p: Pick<ContentPost, 'contentMeta'>): string | null {
  const m = p.contentMeta;
  if (!m?.purpose) return null;
  return [
    PURPOSE_LABEL[m.purpose] ?? m.purpose,
    m.festivalName || m.service || null,
    m.keyword
      ? `“${m.keyword}” (${m.keywordSource === 'search_term' ? 'customer search on Google' : m.keywordMeasured ? 'measured keyword' : 'proposed — not measured'})`
      : null,
  ].filter(Boolean).join(' · ');
}

/** Where the post image came from — stated plainly, never calls a fallback "AI-generated". */
export function imageOriginLine(m: ContentPost['contentMeta']): string | null {
  switch (m?.imageOrigin) {
    case 'AI_GENERATED': return 'Image: new AI image made for this post';
    case 'OWNER_SELECTED': return 'Image: the photo you chose for this post';
    case 'FALLBACK': return 'Image: branded graphic (the AI image could not be created)';
    default: return null;
  }
}

/** Short description of the image's location metadata, or null. */
export function geotagLine(g: { status: string; source?: string } | null | undefined): string | null {
  if (!g) return null;
  switch (g.status) {
    case 'original_gps_preserved': return 'Location: kept from your photo';
    case 'photo_location_added': return g.source === 'device_at_capture' ? 'Location: where the photo was taken' : 'Location: kept from your photo';
    case 'business_location_added': return 'Location: your Google Business Profile location';
    case 'video_location_recorded':
      return g.source === 'video_metadata' ? 'Location: recorded in your video'
        : g.source === 'device_at_capture' ? 'Location: where the video was recorded'
        : g.source === 'photo_exif_app' ? 'Location: from your video'
        : 'Location: your Google Business Profile location';
    case 'video_unmodified': return 'No location for this video';
    case 'none': return 'No location metadata added';
    default: return null;
  }
}

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
 * GET /api/posts?status=published — paginated post history for "Recent
 * Posts". Deliberately NOT /api/content/posts (that route hardcodes
 * aiGenerated:true, which would hide manually-created posts — see
 * createPost below). This route returns a bare array (two existing callers,
 * web's history page and fetchScheduledPostsCount, already depend on that
 * shape — not changing it), so there's no `total` here; pair this with
 * fetchDashboardStats().metrics.postsPublished for the real total count.
 */
export async function fetchPublishedPosts(page: number, limit = 20): Promise<{ posts: ContentPost[]; hasMore: boolean }> {
  const { data } = await api.get('/api/posts', { params: { status: 'published', page, limit } });
  const posts = z
    .array(contentPostSchema.nullable().catch(null))
    .catch([])
    .parse(data)
    .filter((p): p is ContentPost => p !== null);
  return { posts, hasMore: posts.length === limit };
}

export interface CreatePostInput {
  title: string;
  content: string;
  postType?: string;
  scheduledDate?: string;
}

/** POST /api/posts — manual post creation (not AI-generated). */
export async function createPost(input: CreatePostInput): Promise<ContentPost> {
  const { data } = await api.post('/api/posts', {
    ...input,
    status: input.scheduledDate ? 'scheduled' : 'draft',
  });
  return z.object({ message: z.string(), post: contentPostSchema }).parse(data).post;
}

