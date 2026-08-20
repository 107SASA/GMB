/**
 * Turns a raw Google Business Profile API error response into a message a
 * business owner can actually read and act on.
 *
 * Every GBP write in gbpClient.ts used to throw `new Error(\`GBP xxx failed:
 * ${status} ${rawJsonBody}\`)` — that raw Google JSON then flowed straight
 * through to the UI (failure badges, alerts, the scheduler's "Publish
 * failed" panel) completely unfiltered. This is the single choke point all
 * of those calls go through, so fixing it here fixes every one of them at
 * once.
 *
 * The full raw response is still logged server-side for debugging — only
 * what reaches the user gets simplified.
 */
export function describeGoogleApiError(action: string, status: number, rawBody: string): Error {
  console.error(`[GBP] ${action} failed (${status}):`, rawBody);

  // The My Business v4 API wraps field-level validation failures in a nested
  // ValidationError shape — that's usually the one genuinely useful,
  // human-readable line buried in the payload, e.g. "Image too large. Got:
  // 1024px/1536px (max: 2120px/1192px w/h)." Pull just that out.
  let detail: string | undefined;
  try {
    const parsed = JSON.parse(rawBody);
    const errorDetails: any[] =
      parsed?.error?.details?.flatMap((d: any) => d.errorDetails ?? []) ?? [];
    detail =
      errorDetails.map((e: any) => e.message).filter(Boolean).join(' ') ||
      parsed?.error?.message ||
      undefined;
  } catch {
    // Not JSON, or an unexpected shape — fall through to the status-based
    // message below rather than showing raw text.
  }

  if (status === 401 || status === 403) {
    return new Error(
      'Your Google Business Profile connection needs to be reconnected — go to Settings → Google Business Profile and reconnect, then try again.'
    );
  }
  if (status === 429) {
    return new Error('Google is temporarily rate-limiting requests — please wait a few minutes and try again.');
  }
  if (status >= 500) {
    return new Error("Google's servers are having an issue right now — this isn't something on our end. Please try again shortly.");
  }
  if (detail) {
    return new Error(detail);
  }
  return new Error(
    `Google rejected this request (couldn't complete "${action}"). Please try again, and contact support if it keeps happening.`
  );
}
