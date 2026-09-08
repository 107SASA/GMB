import type { Schema } from 'mongoose';

/**
 * Shared safeguard against unbounded growth of an embedded `messages[]` array
 * on the WhatsApp conversation models (Sales / Booking / Support / Report).
 * An indefinitely-growing embedded array eventually hits MongoDB's 16 MB
 * document limit, at which point every `save()` on that conversation throws
 * and the thread is permanently broken.
 *
 * PRIMARY mechanism: the daily `dataRetentionCleanupCron`
 * (services/inngest/functions.ts) trims every over-cap conversation with an
 * atomic `$slice` aggregation-pipeline update — no read-modify-write, so it
 * can never race with an inbound message.
 *
 * This pre('save') hook is a same-day BACKSTOP: it only acts when an array
 * has run well past the cap (CAP + SLACK) between cron runs, which the
 * webhook's 10-messages/minute-per-phone inbound limit makes practically
 * impossible. When it does fire it slices in memory (one `$set` for that
 * save); normal appends stay untouched, so Mongoose keeps emitting an atomic
 * `$push` for them and concurrent inbound messages don't clobber each other.
 *
 * The ~28 `convo.messages.push(...)` call sites were deliberately left as-is
 * rather than rewritten to standalone atomic `updateOne`s — that would
 * destabilise the conversational core for no real gain, since `.push()` on a
 * hydrated document already compiles to `$push`, not a whole-array `$set`.
 */
export const CONVERSATION_MESSAGE_CAP = 500;
const SLACK = 100; // only trim once an array is meaningfully over the cap

export function applyConversationMessageCap(schema: Schema): void {
  // `schema.pre('save', …)` — cast to sidestep Mongoose 9's overload
  // resolution (it otherwise falls through to the query-middleware overload
  // and rejects the "save" string). Runtime behaviour is standard.
  (schema as { pre: (hook: string, fn: (next: (err?: unknown) => void) => void) => void }).pre(
    'save',
    function (this: { get(p: string): unknown; set(p: string, v: unknown): void }, next) {
      const msgs = this.get('messages');
      if (Array.isArray(msgs) && msgs.length > CONVERSATION_MESSAGE_CAP + SLACK) {
        this.set('messages', msgs.slice(-CONVERSATION_MESSAGE_CAP));
      }
      next();
    }
  );
}
