import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * POST /api/admin/leads/return-to-ai — release ANY HUMAN-owned platform lead
 * back to an AI agent.
 *
 * The demo-bookings admin route already has a "Return to AI" control, but it
 * only reaches leads that have a DemoBooking. A lead handed to a human from a
 * sales / support / report conversation (no booking) had no release path —
 * calling setLeadOwnership directly would skip releaseFromHuman's transient
 * handoff-trigger-state cleanup and risk an immediate re-handoff on the next
 * message. This endpoint is that missing generic path; it takes a raw leadId.
 *
 * Body: { leadId: string, targetAgent: 'SALES' | 'IN_HOUSE' }
 * (DEMO is intentionally omitted here — a demo release belongs with its
 * booking, via the demo-bookings route, so reminders/no-show checks line up.)
 */
export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    const leadId = body?.leadId;
    const targetAgent = body?.targetAgent;

    if (!leadId || !mongoose.Types.ObjectId.isValid(leadId)) {
      return NextResponse.json({ success: false, error: 'Valid leadId is required.' }, { status: 400 });
    }
    const validAgents = ['SALES', 'IN_HOUSE'];
    if (!validAgents.includes(targetAgent)) {
      return NextResponse.json({ success: false, error: `targetAgent must be one of: ${validAgents.join(', ')}` }, { status: 400 });
    }

    await dbConnect();
    const { default: Lead } = await import('@/models/Lead');
    const lead: any = await Lead.findById(leadId).select('_id currentAgent humanHandoff').lean();
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 });
    }
    const isHuman = lead.currentAgent === 'HUMAN' || lead.humanHandoff?.active === true;
    if (!isHuman) {
      return NextResponse.json(
        { success: false, error: `Lead is not HUMAN-owned (currentAgent=${lead.currentAgent ?? 'NONE'}).` },
        { status: 409 },
      );
    }

    const resumeStage = targetAgent === 'IN_HOUSE' ? 'CUSTOMER' : 'NURTURING';
    const { releaseFromHuman } = await import('@/services/leadOwnership/releaseFromHuman');
    await releaseFromHuman(leadId, targetAgent, 'human-released', auth.userId, resumeStage);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[admin/leads/return-to-ai] POST failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
