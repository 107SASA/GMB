import { phoneVariants } from '@/services/billing/customerActivation';
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import DemoBooking from '@/models/DemoBooking';
import SalesConversation from '@/models/SalesConversation';
import BookingConversation from '@/models/BookingConversation';
import ReportConversation from '@/models/ReportConversation';
import SupportConversation from '@/models/SupportConversation';
import User from '@/models/User';
import Business from '@/models/Business';
import ScheduledAction from '@/models/ScheduledAction';
import { PLATFORM_TENANT, deriveFunnelStage } from '@/lib/admin/conversionFunnel';
import { computeScoreBand } from '@/services/nba/rules';
import { crmDisplayName, crmStageLabel } from '@/lib/admin/platformCrm';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/leads/:id
 *
 * Full detail for ONE platform lead: profile + intelligence + ownership +
 * the NEWEST LeadEvent timeline entries (shown oldest first) + every agent
 * conversation with this lead (sales, demo booking, report, support) + any
 * DemoBooking + pending ScheduledActions + the workspace it signed up with.
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
    // The workspace this lead signed up with: its own businessId, else one
    // owned by an account on the same phone (platform prospects rarely have a businessId).
    let business: any = lead.businessId
      ? await Business.findById(lead.businessId).select('name subscriptionStatus category city trialEndsAt trialCancelledAt').lean()
      : null;
    if (!business && phone) {
      const owner: any = await User.findOne({ phone: { $in: phoneVariants(phone) } }).select('_id').lean();
      if (owner) {
        const owned: any[] = await Business.find({ userId: owner._id }).select('name subscriptionStatus category city trialEndsAt trialCancelledAt').lean();
        const rank = (st?: string) => { const i = ['active', 'trial_active', 'past_due'].indexOf(st || ''); return i === -1 ? 9 : i; };
        business = owned.sort((a, b) => rank(a.subscriptionStatus) - rank(b.subscriptionStatus))[0] ?? null;
      }
    }

    // Timeline — by leadId, or by phone for events logged before the Lead
    // existed (never a customer tenant's event, never one naming another
    // lead). The NEWEST 400, shown oldest first.
    const TIMELINE_LIMIT = 400;
    const eventOr: any[] = [{ leadId: lead._id }];
    if (phone) eventOr.push({ leadId: { $exists: false }, phone, conversationType: { $ne: 'tenant' } });
    const newest = await LeadEvent.find({ $or: eventOr })
      .sort({ createdAt: -1 })
      .limit(TIMELINE_LIMIT + 1)
      .select('type payload actor conversationType createdAt')
      .lean();
    const timelineTruncated = newest.length > TIMELINE_LIMIT;
    const rawEvents = (newest as any[]).slice(0, TIMELINE_LIMIT).reverse();
    const seen = new Set<string>();
    const timeline = (rawEvents as any[]).filter((e) => {
      const k = `${e.type}|${new Date(e.createdAt).getTime()}|${JSON.stringify(e.payload ?? {})}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const latest = (Model: any, match: Record<string, unknown>) =>
      Model.findOne(match).sort({ updatedAt: -1 }).lean();
    const [salesConvo, bookingConvo, reportConvo, supportConvo, demo, pendingActions] = await Promise.all([
      phone ? latest(SalesConversation, { leadPhone: phone }) : Promise.resolve(null),
      latest(BookingConversation, phone ? { $or: [{ leadId: lead._id }, { leadPhone: phone }] } : { leadId: lead._id }),
      phone ? latest(ReportConversation, { leadPhone: phone }) : Promise.resolve(null),
      phone ? latest(SupportConversation, { leadPhone: phone }) : Promise.resolve(null),
      DemoBooking.find({ leadId: lead._id }).sort({ updatedAt: -1 }).lean(),
      ScheduledAction.find({ leadId: lead._id, status: 'PENDING' })
        .sort({ dueAt: 1 })
        .select('actionType dueAt createdBy payload')
        .lean(),
    ]);

    const sc = salesConvo as any;
    // Who wrote each message: the lead, the AI agent, or a team member (Inbox).
    const transcript = (c: any) => (c?.messages ?? []).slice(-60).map((m: any) => ({
      role: m.role, text: m.text, at: m.at, by: m.role === 'lead' ? 'lead' : m.sender === 'human' ? 'team' : 'ai',
    }));

    // Team members behind notes / edits / stage changes, by their user id.
    const actorIds = [...new Set((rawEvents as any[]).map((e) => e.actor).filter((a) => mongoose.Types.ObjectId.isValid(a)))];
    const users: any[] = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select('fullName email').lean() : [];
    const actorName = new Map(users.map((u) => [String(u._id), u.fullName || u.email]));
    const assigned: any = lead.assignedUserId ? await User.findById(lead.assignedUserId).select('fullName email').lean() : null;
    const conversations = [
      sc && { type: 'sales', label: 'Sales agent', status: sc.status, followUpsSent: sc.followUpsSent ?? 0, messages: transcript(sc), updatedAt: sc.updatedAt },
      bookingConvo && { type: 'booking', label: 'Demo booking agent', status: (bookingConvo as any).status, messages: transcript(bookingConvo), updatedAt: (bookingConvo as any).updatedAt },
      reportConvo && { type: 'report', label: 'Report agent', status: (reportConvo as any).status, messages: transcript(reportConvo), updatedAt: (reportConvo as any).updatedAt },
      supportConvo && { type: 'support', label: 'Support', status: (supportConvo as any).status, messages: transcript(supportConvo), updatedAt: (supportConvo as any).updatedAt },
    ].filter(Boolean);

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
        businessName: business?.name ?? lead.businessType ?? null,
        displayName: crmDisplayName({ name: lead.name, businessType: business?.name ?? lead.businessType, phone }),
        businessType: lead.businessType ?? null,
        city: lead.city ?? null,
        tags: lead.tags ?? [],
        interest: lead.interest ?? null,
        lostReason: lead.lostReason ?? null,
        captureSources: lead.captureSources?.length ? lead.captureSources : lead.source ? [lead.source] : [],
        subStageId: lead.subStageId ?? null,
        subStage: lead.subStage ?? null,
        dealValue: lead.deal?.value ?? null,
        stageLabel: crmStageLabel(lead.currentStage),
        assignedUser: assigned ? { id: String(assigned._id), name: assigned.fullName || assigned.email } : null,
        // Intelligence
        leadScore: lead.leadScore ?? 0,
        scoreBand: computeScoreBand(lead.leadScore ?? 0),
        aiLeadScore: lead.aiLeadScore ?? null,
        aiInsights: lead.aiInsights ?? null,
        intent: lead.intent ?? null,
        painPoints: lead.painPoints ?? [],
        buyingSignals: (lead.buyingSignals ?? []).map((s: any) => ({
          type: s.type,
          note: s.note ?? null,
          detectedAt: s.detectedAt ?? null,
        })),
        objections: (lead.objections ?? []).map((o: any) => ({
          type: o.type,
          note: o.note ?? null,
          resolved: !!o.resolved,
          detectedAt: o.detectedAt ?? null,
        })),
        businessProfile: lead.businessProfile ?? null,
        auditId: lead.auditId ? String(lead.auditId) : null,
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
        actorName: actorName.get(String(e.actor)) ?? null,
        conversationType: e.conversationType ?? null,
        at: e.createdAt,
      })),
      timelineTruncated,
      conversations,
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
        salespersonUserId: d.salespersonUserId ? String(d.salespersonUserId) : null,
        googleEmail: d.googleEmail ?? null,
        calendarId: d.calendarId ?? null,
        timezone: d.timezone ?? null,
        startUtc: d.startUtc ?? null,
        reminderActionIds: (d.reminderActionIds || []).map((id: any) => String(id)),
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
