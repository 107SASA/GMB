import type mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import LeadEvent, { type LeadEventType, type LeadEventConversationType } from '@/models/LeadEvent';

export interface LogLeadEventOptions {
  // Real Lead._id, when the call site already has one on hand — never
  // fetched specially for logging (see LeadEvent.ts's file-level comment).
  leadId?: string | mongoose.Types.ObjectId | null;
  // Phone the event is about — always pass this when available; it's the
  // one identifier every WhatsApp-originated event has, even pre-Lead.
  phone?: string | null;
  conversationType?: LeadEventConversationType;
  conversationId?: string | mongoose.Types.ObjectId | null;
}

/**
 * Fire-and-forget lead-timeline logger. Same "never fail the workflow"
 * contract as sendPushToBusinessUsers in services/push.ts: a logging
 * failure (bad connection, validation error, whatever) is swallowed and
 * warned, never thrown — this must never be able to break message delivery
 * or any other caller's own logic.
 *
 * Intentionally designed for fire-and-forget use (callers generally don't
 * `await` this) — but it does return the promise so a caller that wants the
 * row to exist before, say, returning an HTTP response can await it.
 *
 * At least one of `leadId`/`phone` should be given or the event has nothing
 * to be queried by later; passing neither is allowed (still never throws)
 * but the row will only be findable by type/actor/time.
 */
export async function logLeadEvent(
  type: LeadEventType,
  payload?: Record<string, unknown>,
  actor: string = 'system',
  opts: LogLeadEventOptions = {}
): Promise<void> {
  try {
    await dbConnect();
    await LeadEvent.create({
      leadId: opts.leadId || undefined,
      phone: opts.phone || undefined,
      conversationType: opts.conversationType ?? null,
      conversationId: opts.conversationId || undefined,
      type,
      payload,
      actor,
    });
  } catch (err: any) {
    console.warn('[leadEvents] logLeadEvent failed:', err?.message);
  }
}
