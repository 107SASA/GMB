/**
 * Turns a raw, technical error (Mongo, JWT, network, or anything else that
 * wasn't already thrown as a clean user-facing message) into text a
 * non-technical business owner can read and, where possible, act on.
 *
 * This is the general-purpose counterpart to googleApiError.ts (which
 * already does the same job specifically for Google Business Profile API
 * failures). Use it as the fallback in an API route's outer catch block —
 * NOT to replace an error you already threw with a clear message yourself;
 * `toFriendlyMessage` passes those through unchanged.
 *
 *   } catch (err: any) {
 *     return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
 *   }
 */
export function toFriendlyMessage(err: unknown): string {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error);

  // Mongo duplicate-key violation — e.g. "E11000 duplicate key error
  // collection: gmbboost.users index: phone_1 dup key: { phone: \"+91...\" }".
  // Pull out just the field name so the message stays specific and useful
  // without exposing collection/index internals.
  const dupMatch = /E11000 duplicate key error.*index:\s*(\w+?)_\d*\s/.exec(error.message);
  if (dupMatch) {
    const field = dupMatch[1];
    const label = FIELD_LABELS[field] ?? 'value';
    return `This ${label} is already in use — please use a different one.`;
  }

  // Mongoose schema validation — its own message is usually already
  // reasonably readable ("Path `email` is required."), but strip the
  // "ValidationError: " noise and any embedded stack-style detail.
  if (error.name === 'ValidationError') {
    return 'Some of the information provided is invalid or missing — please check and try again.';
  }

  // JWT — expired/garbled session or reset/verification token.
  if (error.name === 'TokenExpiredError') {
    return 'Your session has expired — please log in again.';
  }
  if (error.name === 'JsonWebTokenError') {
    return 'That link or session is no longer valid — please try again from the start.';
  }

  // Network-level failures calling an external service (Google, Razorpay,
  // WhatsApp/Meta, Resend, etc.) — Node's fetch wraps these as TypeErrors.
  if (
    error instanceof TypeError && /fetch failed/i.test(error.message) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/.test(error.message)
  ) {
    return "We couldn't reach an external service just now — please try again in a moment.";
  }

  if (error.name === 'MongooseServerSelectionError' || /MongoNetworkError/.test(error.name)) {
    return "We're having trouble reaching the database right now — please try again shortly.";
  }

  // Anything already written as a short, plain sentence (no stack-trace
  // markers, file paths, or raw JSON) is almost certainly a message a
  // developer already wrote deliberately for the user to see — pass it
  // through as-is rather than second-guessing it.
  const looksHandWritten =
    error.message.length < 200 &&
    !/^\s*at\s|\{|\}|\.(ts|js|tsx|jsx):\d|node_modules/.test(error.message);
  if (looksHandWritten) {
    return error.message;
  }

  return 'Something went wrong on our end. Please try again, and contact support if this keeps happening.';
}

const FIELD_LABELS: Record<string, string> = {
  email: 'email address',
  phone: 'phone number',
  slug: 'link',
  name: 'name',
};
