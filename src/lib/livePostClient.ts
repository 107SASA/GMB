/**
 * Website side of editing / deleting a post that is already live on Google
 * (server: services/content/livePost.ts). A live post published before
 * 30 Sep 2026 has no Google post id saved, so the server answers
 * code POST_NOT_LINKED and the owner is sent to Google to change it there.
 */

export const GOOGLE_BUSINESS_URL = 'https://business.google.com/';

/** An API error that keeps the server's `code`. */
export class PostApiError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export function isPostNotLinked(err: unknown): boolean {
  return err instanceof PostApiError && err.code === 'POST_NOT_LINKED';
}

export function openGoogleBusiness(): void {
  window.open(GOOGLE_BUSINESS_URL, '_blank', 'noopener,noreferrer');
}
