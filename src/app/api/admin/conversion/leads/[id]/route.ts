import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import DemoBooking from '@/models/DemoBooking';
import SalesConversation from '@/models/SalesConversation';
import Business from '@/models/Business';
import ScheduledAction from '@/models/ScheduledAction';
import { PLATFORM_TENANT, deriveFunnelStage } from '@/lib/admin/conversionFunnel';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/leads/:id
 *
 * Full detail for ONE platform lead: profile + intelligence + ownership +
 * a chronological LeadEvent timeline (oldest first) + the matched
 * SalesConversation transcript + any DemoBooking + pending ScheduledActions.
 *
 * Reuses the existing LeadEvent timeline — no second event system. The
 * timeline is pulled by leadId AND by phone (platform conversations often
 * have no leadId — see LeadEvent.ts's file comment), then de-duped + sorted.
 *
 * Tenant-scoped: 404 for any lead that isn't tenantId 'gmbboost-internal'.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const { id } = await ctx.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: 'Invalid lead id.' }, { status: 400 });
    }

    const lead = await Lead.findOne({ _id: id, tenantId: PLATFORM_TENANT }).lean() as any;
    if (!lead) return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 });

    const phone = lead.phone as string | undefined;
    const business = lead.businessId
      ? ((await Business.findById(lead.businessId).select('name subscriptionStatus category city').lean()) as any)
      : null;

    // Timeline — by leadId OR by phone, de-duped, oldest first.
    const eventOr: any[] = [{ leadId: lead._id }];
    if (phone) eventOr.push({ phone });
    const rawEvents = await LeadEvent.find({ $or: eventOr })
      .sort({ createdAt: 1 })
      .limit(400)
      .select('type payload actor conversationType createdAt')
      .lean();
    const seen = new Set<string>();
    const timeline = (rawEvents as any[]).filter((e) => {
      const k = `${e.type}|${new Date(e.createdAt).getTime()}|${JSON.stringify(e.payload ?? {})}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const [salesConvo, demo, pendingActions] = await Promise.all([
      phone
        ? SalesConversation.findOne({ leadPhone: phone }).sort({ updatedAt: -1 }).lean()
        : Promise.resolve(null),
      DemoBooking.find({ leadId: lead._id }).sort({ updatedAt: -1 }).lean(),
      ScheduledAction.find({ leadId: lead._id, status: 'PENDING' })
        .sort({ dueAt: 1 })
        .select('actionType dueAt createdBy payload')
        .lean(),
    ]);

    const sc = salesConvo as any;

    return NextResponse.json({
      success: true,
      lead: {
        _id: String(lead._id),
        name: lead.name,
        phone: phone ?? null,
        email: lead.email ?? null,
        source: lead.source ?? null,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        business: business
          ? { name: business.name, subscriptionStatus: business.subscriptionStatus ?? null, category: business.category ?? null, city: business.city ?? null }
          : null,
        // Intelligence
        leadScore: lead.leadScore ?? 0,
        aiLeadScore: lead.aiLeadScore ?? null,
        aiInsights: lead.aiInsights ?? null,
        intent: lead.intent ?? null,
        painPoints: lead.painPoints ?? [],
        objections: (lead.objections ?? []).map((o: any) => ({
          type: o.type,
          note: o.note ?? null,
          resolved: !!o.resolved,
          detectedAt: o.detectedAt ?? null,
        })),
        businessProfile: lead.businessProfile ?? null,
        // Ownership / stage
        currentAgent: lead.currentAgent ?? 'NONE',
        currentStage: lead.currentStage ?? 'NEW',
        funnelStage: deriveFunnelStage(lead),
        nurtureStatus: lead.nurtureStatus ?? 'ACTIVE',
        nextBestAction: lead.nextBestAction ?? null,
        nextActionAt: lead.nextActionAt ?? null,
        lastActivityAt: lead.lastMeaningfulInteractionAt ?? lead.lastActivityAt ?? null,
        humanHandoff: lead.humanHandoff?.active
          ? {
              active: true,
              reason: lead.humanHandoff.reason ?? null,
              since: lead.humanHandoff.since ?? null,
              assignedUserId: lead.humanHandoff.assignedUserId ? String(lead.humanHandoff.assignedUserId) : null,
            }
          : { active: false },
        isCustomer: lead.currentAgent === 'IN_HOUSE' || lead.currentStage === 'CUSTOMER',
      },
      timeline: timeline.map((e: any) => ({
        type: e.type,
        payload: e.payload ?? null,
        actor: e.actor,
        conversationType: e.conversationType ?? null,
        at: e.createdAt,
      })),
      conversation: sc
        ? {
            status: sc.status,
            consentStatus: sc.consentStatus,
            followUpsSent: sc.followUpsSent ?? 0,
            lastLeadReplyAt: sc.lastLeadReplyAt ?? null,
            lastAgentAt: sc.lastAgentAt ?? null,
            messages: (sc.messages ?? []).slice(-40).map((m: any) => ({ role: m.role, text: m.text, at: m.at })),
          }
        : null,
      demos: (demo as any[]).map((d) => ({
        _id: String(d._id),
        status: d.status,
        date: d.date,
        timeSlot: d.timeSlot,
        channel: d.channel,
        meetingLink: d.meetingLink ?? null,
        calendarEventId: d.calendarEventId ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      pendingActions: (pendingActions as any[]).map((a) => ({
        actionType: a.actionType,
        dueAt: a.dueAt,
        createdBy: a.createdBy,
        payload: a.payload ?? null,
      })),
    });
  } catch (error: any) {
    console.error('[admin/conversion/leads/:id] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
