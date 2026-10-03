import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import { cancelScheduledActions } from '@/services/scheduler/cancelScheduledActions';
import { logLeadEvent } from '@/services/leadEvents';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Marks a platform Lead opted-out in response to an inbound STOP / UNSUBSCRIBE
 * / CANCEL, and stands down every automated flow that keys off the Lead.
 *
 * Why this exists: the WhatsApp webhook's STOP handling only ever set the
 * per-CONVERSATION status (`SalesConversation.status='stopped'`,
 * `Customer.optedOut=true`, `thread.aiEnabled=false`). The Lead-level opt-out
 * fields — `nurtureStatus='OPTED_OUT'` and (checked everywhere:
 * `isOptedOutOrDoNotContact`, `outboundOrchestrator` Step 3, the NBA rule
 * table's "Opted out" absolute row, `proactiveNbaScheduler`'s
 * `nurtureStatus:'ACTIVE'` candidate filter, the legacy follow-up cron) —
 * were NEVER set by a real user's STOP. So a lead who texted "STOP" could
 * still be picked up by proactive NBA nurture. This closes that gap with a
 * single shared write-path, mirroring setLeadOwnership.ts's structure.
 *
 * Idempotent: a Lead already OPTED_OUT is a no-op (returns { changed:false })
 * — safe to call on every STOP redelivery. Never throws — same "never fail
 * the workflow" contract as setLeadOwnership / logLeadEvent; a failure here
 * must not break the webhook's own STOP bookkeeping.
 *
 * Does NOT resolve/create a Lead as a side effect beyond the read below (same
 * decision as customerActivation.ts / every earlier phase) — a STOP from a
 * phone with no platform Lead simply has no Lead to opt out, and the caller's
 * own per-conversation STOP handling still runs.
 */
export async function optOutLeadByPhone(
  phone: string | null | undefined,
  reason: string = 'inbound-stop',
  actor: string = 'system'
): Promise<{ changed: boolean; leadId?: string }> {
  try {
    if (!phone) return { changed: false };
    await dbConnect();
    const normalized = normalizePhoneE164(phone) || phone;
    const lead = await Lead.findOne({ phone: normalized, tenantId: 'gmbboost-internal' });
    if (!lead) return { changed: false };
    return optOutLeadDoc(lead, reason, actor);
  } catch (err: any) {
    console.warn('[optOutLead] optOutLeadByPhone failed:', err?.message);
    return { changed: false };
  }
}

export async function optOutLeadById(
  leadId: string | mongoose.Types.ObjectId,
  reason: string = 'inbound-stop',
  actor: string = 'system'
): Promise<{ changed: boolean; leadId?: string }> {
  try {
    await dbConnect();
    const lead = await Lead.findById(leadId);
    if (!lead) return { changed: false };
    return optOutLeadDoc(lead, reason, actor);
  } catch (err: any) {
    console.warn('[optOutLead] optOutLeadById failed:', err?.message);
    return { changed: false };
  }
}

async function optOutLeadDoc(
  lead: any,
  reason: string,
  actor: string
): Promise<{ changed: boolean; leadId: string }> {
  const alreadyOptedOut =
    lead.nurtureStatus === 'OPTED_OUT' && lead.currentStage === 'DO_NOT_CONTACT';
  if (alreadyOptedOut) {
    return { changed: false, leadId: String(lead._id) };
  }

  const nurtureStatusFrom = lead.nurtureStatus || 'ACTIVE';
  lead.nurtureStatus = 'OPTED_OUT';
  await lead.save();

  // Also write currentStage DO_NOT_CONTACT via the canonical ownership path
  // so scheduled actions cancel the same way CUSTOMER does.
  const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
  await setLeadOwnership(
    lead._id,
    (lead.currentAgent as any) || 'NONE',
    `opted-out:${reason}`,
    actor,
    'DO_NOT_CONTACT'
  ).catch((err: any) => console.warn('[optOutLead] setLeadOwnership DO_NOT_CONTACT failed:', err?.message));

  // Stand down any still-PENDING scheduled nurture for this lead. Idempotent
  // (no-op when there are none). nurtureSchedulerTick / requestOutboundMessage
  // would also refuse now that nurtureStatus is OPTED_OUT — this is
  // defense-in-depth, matching setLeadOwnership's own cancellation.
  await cancelScheduledActions(lead._id, `opted-out:${reason}`);

  logLeadEvent(
    'OPT_OUT',
    {
      reason,
      nurtureStatusFrom,
      nurtureStatusTo: 'OPTED_OUT',
      stageTo: 'DO_NOT_CONTACT',
    },
    actor,
    { leadId: lead._id, phone: lead.phone }
  );

  return { changed: true, leadId: String(lead._id) };
}
