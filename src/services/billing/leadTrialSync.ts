import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { logLeadEvent } from '@/services/leadEvents';
import { resolveLeadForPayment } from '@/services/billing/customerActivation';
import { stageOnPaymentFailure } from '@/services/billing/paymentLeadStages';
import { setLeadOwnership } from '@/services/leadOwnership/setLeadOwnership';

/**
 * Keeps the platform CRM lead in step with the workspace's free trial, so
 * Super Admin → Leads shows "Free trial" from the moment autopay is set up,
 * and what happened after (cancelled, ended unpaid, paid). Called from the
 * billing event handler and the daily trial job. Never throws: a CRM miss
 * must not affect billing.
 */
export type LeadTrialChange =
  | { kind: 'started'; endsAt: Date; cancelled?: boolean }
  | { kind: 'cancelled' }
  | { kind: 'ended' }
  | { kind: 'converted' };

export async function syncLeadTrial(userId: string | null, businessId: string | null, change: LeadTrialChange): Promise<void> {
  if (!userId && !businessId) return;
  try {
    await dbConnect();
    const lead = await resolveLeadForPayment(userId || '', businessId);
    if (!lead) {
      console.warn(`[lead-trial] no CRM lead found for user ${userId} / business ${businessId} — trial ${change.kind} not shown in Leads`);
      return;
    }
    const now = new Date();
    const prev = lead.trial as any;
    let event: 'TRIAL_STARTED' | 'TRIAL_CANCELLED' | 'TRIAL_ENDED' | null = null;

    if (change.kind === 'started') {
      lead.trial = {
        status: change.cancelled ? 'cancelled' : 'active',
        startedAt: prev?.startedAt && prev.status !== 'ended' ? prev.startedAt : now,
        endsAt: change.endsAt,
        ...(businessId && { businessId }),
        updatedAt: now,
      } as any;
      event = prev?.status === 'active' ? null : 'TRIAL_STARTED';
    } else if (!prev) {
      // Nothing recorded for this trial (started before this sync existed):
      // only a payment is worth noting, and activation already does that.
      return;
    } else if (change.kind === 'cancelled') {
      if (prev.status !== 'active') return;
      lead.trial = { ...prev, status: 'cancelled', updatedAt: now };
      event = 'TRIAL_CANCELLED';
    } else if (change.kind === 'ended') {
      if (prev.status === 'ended' || prev.status === 'converted') return;
      lead.trial = { ...prev, status: 'ended', updatedAt: now };
      event = 'TRIAL_ENDED';
    } else {
      if (prev.status === 'converted') return;
      lead.trial = { ...prev, status: 'converted', updatedAt: now };
    }

    lead.markModified('trial');
    await lead.save();
    if (change.kind === 'ended') {
      // Ended without paying: back to the team as purchase intent (through
      // the ownership engine, so the stage change is on the timeline).
      const next = stageOnPaymentFailure(lead.currentStage);
      if (next) await setLeadOwnership(lead._id, (lead.currentAgent as any) || 'SALES', 'trial-ended', 'system', next);
    }
    if (event) {
      await logLeadEvent(
        event,
        { businessId, ...(change.kind === 'started' && { endsAt: change.endsAt.toISOString() }) },
        'system',
        { leadId: lead._id, phone: lead.phone },
      );
    }
  } catch (err: any) {
    console.error(`[lead-trial] could not update the CRM lead (${change.kind}):`, err?.message ?? err);
  }
}
