/**
 * Editing and deleting a post that is already live on Google.
 *
 * A post is 'published' only once Google returned the created post
 * (services/content/publishPost.ts). Since 30 Sep 2026 Google's resource
 * name is kept on Post.gbpPostName; older published posts don't have it, so
 * they can't be changed through the API and the owner is sent to Google.
 *
 * Google is changed first, our copy second: if Google refuses, nothing here
 * changes, so the app never shows text that isn't what's on Google.
 */

/** Text sent to Google for a post — the same as at publish. */
export function buildPostSummary(post: { title?: string | null; content?: string | null }): string {
  return [post.title, post.content].filter(Boolean).join('\n\n').slice(0, 1500);
}

export const POST_NOT_LINKED_CODE = 'POST_NOT_LINKED';
export const POST_NOT_LINKED_MESSAGE =
  'This post was published before editing was available, so it can only be changed on Google. Open your Google Business Profile to edit or delete it.';
export const LIVE_WRITES_OFF_MESSAGE =
  'Changes to Google are turned off right now, so this live post can\'t be changed yet. Please try again later.';

export class LivePostError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type LivePost = {
  status?: string | null;
  businessId: unknown;
  gbpPostName?: string | null;
  title?: string | null;
  content?: string | null;
};

type Deps = {
  updateLocalPost?: (businessId: string, postName: string, input: { summary: string }) => Promise<{ liveWriteApplied: boolean }>;
  deleteLocalPost?: (businessId: string, postName: string) => Promise<{ liveWriteApplied: boolean }>;
};

function linkedName(post: LivePost): string {
  const name = typeof post.gbpPostName === 'string' ? post.gbpPostName.trim() : '';
  if (!name) throw new LivePostError(POST_NOT_LINKED_MESSAGE, POST_NOT_LINKED_CODE, 409);
  return name;
}

/**
 * Pushes the post's new text to Google. Call with the post already holding
 * the edited title/content, before saving it. No-op for posts not on Google.
 */
export async function pushLivePostEdit(post: LivePost, deps: Deps = {}): Promise<void> {
  if (post.status !== 'published') return;
  const name = linkedName(post);
  const update = deps.updateLocalPost ?? (await import('@/lib/gbpClient')).updateLocalPost;
  const res = await update(String(post.businessId), name, { summary: buildPostSummary(post) });
  if (!res.liveWriteApplied) throw new LivePostError(LIVE_WRITES_OFF_MESSAGE, 'LIVE_WRITES_OFF', 409);
}

/** Removes the post from Google before our copy is deleted. No-op for posts not on Google. */
export async function removeLivePost(post: LivePost, deps: Deps = {}): Promise<void> {
  if (post.status !== 'published') return;
  const name = linkedName(post);
  const remove = deps.deleteLocalPost ?? (await import('@/lib/gbpClient')).deleteLocalPost;
  const res = await remove(String(post.businessId), name);
  if (!res.liveWriteApplied) throw new LivePostError(LIVE_WRITES_OFF_MESSAGE, 'LIVE_WRITES_OFF', 409);
}
