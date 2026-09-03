import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import ScheduledAction from '@/models/ScheduledAction';
import { logLeadEvent } from '@/services/leadEvents';

/**
 * Cancels every still-PENDING ScheduledAction for a lead — called whenever
 * that lead's ownership/stage state changes in a way that could make an
 * already-scheduled action stale (see call sites: setLeadOwnership.ts on
 * any currentAgent/currentStage change, and anywhere currentStage becomes
 * DO_NOT_CONTACT or CUSTOMER). nurtureSchedulerTick ALSO re-validates fresh
 * at fire time regardless, so this is defense-in-depth (skip the noise of a
 * doomed-to-be-skipped row, cancel it outright) rather than the only thing
 * standing between a stale row and a bad send.
 *
 * Never throws — best-effort, same "never fail the workflow" contract as
 * every other side-effect logger in this codebase (services/leadEvents.ts,
 * services/push.ts). A cancellation failure must not block whatever
 * ownership/stage change triggered it.
 */
export async function cancelScheduledActions(
  leadId: string | mongoose.Types.ObjectId,
  reason: string
): Promise<number> {
  try {
    await dbConnect();
    const pending = await ScheduledAction.find({ leadId, status: 'PENDING' }).select('_id').lean();
    if (!pending.length) return 0;

    const ids = pending.map((p: any) => p._id);
    await ScheduledAction.updateMany({ _id: { $in: ids } }, { $set: { status: 'CANCELLED', reason } });

    logLeadEvent(
      'NURTURE_ACTION_CANCELLED',
      { reason, count: ids.length, scheduledActionIds: ids },
      'system',
      { leadId }
    );

    return ids.length;
  } catch (err: any) {
    console.warn('[cancelScheduledActions] failed:', err?.message);
    return 0;
  }
}
