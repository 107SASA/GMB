'use client';

/**
 * Client-side counterpart to friendlyMessage.ts (server). API routes now
 * return a clean, human `error` field in almost all cases — but a
 * try/catch around `fetch()` also catches failures that never reach our
 * backend at all: no network connection, a request that times out, the
 * browser refusing a mixed-content/CORS request, or a 502/504 gateway page
 * that isn't valid JSON. Those show up as raw browser/runtime text like
 * "Failed to fetch" or "Unexpected token < in JSON at position 0" — this
 * translates those into something a user can actually act on, and passes
 * everything else (almost always already our own friendly `data.error`
 * message, thrown as-is by the calling code) straight through.
 */
export function friendlyClientMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!(err instanceof Error)) return fallback;

  if (
    /Failed to fetch|NetworkError|Load failed|network request failed/i.test(err.message) ||
    err.name === 'TypeError' && /fetch/i.test(err.message)
  ) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  if (/Unexpected token|is not valid JSON|JSON\.parse/i.test(err.message)) {
    return 'Something went wrong on our end. Please try again in a moment.';
  }
  if (err.name === 'AbortError' || /timed?\s?out/i.test(err.message)) {
    return 'That took too long to respond — please try again.';
  }

  return err.message || fallback;
}
