import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { buildGrowthReport, resolveReportMonth, type GrowthReport } from './growthReport';

/**
 * Customer CRM — Monthly Growth Report data access. Calculated on request
 * from the authoritative CRM records (no stored copies, no AI). The business
 * id always comes from the server-resolved workspace, never from the client.
 */

const PLATFORM_TENANT = 'gmbboost-internal';

async function deps() {
  const [{ default: Business }, { default: Lead }, { default: FollowUp }, { default: CallEvent }, { default: Appointment }] = await Promise.all([
    import('@/models/Business'), import('@/models/Lead'), import('@/models/FollowUp'), import('@/models/CallEvent'), import('@/models/Appointment'),
  ]);
  return { Business, Lead, FollowUp, CallEvent, Appointment };
}

export type GrowthReportResult = { ok: true; report: GrowthReport } | { ok: false; status: number; error: string };

export async function loadGrowthReport(businessId: string, month: string | null | undefined, now = new Date()): Promise<GrowthReportResult> {
  await dbConnect();
  if (!mongoose.isValidObjectId(businessId)) return { ok: false, status: 404, error: 'Workspace not found' };
  const { Business, Lead, FollowUp, CallEvent, Appointment } = await deps();
  const bid = new mongoose.Types.ObjectId(businessId);
  const biz: any = await Business.findById(bid).select('name timezone crmInvestment').lean();
  if (!biz) return { ok: false, status: 404, error: 'Workspace not found' };

  const resolved = resolveReportMonth(month, now, biz.timezone);
  if (!resolved) return { ok: false, status: 400, error: 'Choose a month up to the current month (YYYY-MM).' };
  const windowFrom = resolved.previous.from;
  const windowTo = resolved.period.live ? resolved.period.monthEnd : resolved.period.to;

  const [leads, tasks, calls, callsMeasured, booked] = await Promise.all([
    Lead.find({ businessId: bid, tenantId: { $ne: PLATFORM_TENANT } })
      .select('source lifeCycleStage status createdAt convertedAt lastContactedAt deal')
      .lean(),
    FollowUp.find({
      businessId: bid, kind: 'task',
      $or: [{ scheduledFor: { $gte: windowFrom, $lt: windowTo } }, { status: 'pending' }],
    }).select('leadId status scheduledFor').lean(),
    CallEvent.find({ businessId: bid, startedAt: { $gte: windowFrom, $lt: windowTo } })
      .select('direction startedAt outcome leadState handledAt')
      .lean(),
    CallEvent.exists({ businessId: bid }),
    Appointment.distinct('leadId', { businessId: bid, status: { $in: ['Scheduled', 'Pending Confirmation'] } }),
  ]);

  const report = buildGrowthReport({
    resolved,
    now,
    businessName: biz.name || 'Your business',
    leads: leads as any[],
    tasks: (tasks as any[]).map((t) => ({ leadId: String(t.leadId), status: t.status, scheduledFor: t.scheduledFor })),
    calls: (calls as any[]).map((c) => ({ direction: c.direction, startedAt: c.startedAt, outcome: c.outcome, leadState: c.leadState, handled: !!c.handledAt })),
    callsMeasured: !!callsMeasured,
    monthlyInvestment: biz.crmInvestment?.monthlyAmount ?? null,
    bookedLeadIds: new Set((booked as any[]).map(String)),
  });
  return { ok: true, report };
}

/**
 * "Your September Growth Report is ready" — in-app + push to the business's
 * users, ONCE per business per month (atomic claim on
 * Business.crmGrowthReportNotifiedFor). Runs daily; a business is handled
 * once its own month (in its timezone) has completed. Only businesses that
 * use the Customer CRM, have CRM activity in that month, and whose plan
 * includes the CRM are notified. Never WhatsApp, never the lead, no AI.
 */
export async function sendGrowthReportReadyNotifications(now = new Date()): Promise<{ notified: number; skipped: number }> {
  await dbConnect();
  const { Business, Lead, FollowUp, CallEvent } = await deps();
  const businessIds: any[] = await Lead.distinct('businessId', { businessId: { $ne: null }, tenantId: { $ne: PLATFORM_TENANT } });
  const businesses: any[] = await Business.find({ _id: { $in: businessIds }, isDeleted: { $ne: true } })
    .select('name timezone userId crmGrowthReportNotifiedFor').lean();
  let notified = 0;
  let skipped = 0;
  for (const biz of businesses) {
    const resolved = resolveReportMonth(null, now, biz.timezone);
    if (!resolved) continue;
    const key = resolved.period.key; // latest completed month in the business's timezone
    if (biz.crmGrowthReportNotifiedFor === key) continue;
    // Atomic claim first — a parallel run never notifies twice.
    const claim = await Business.updateOne(
      { _id: biz._id, crmGrowthReportNotifiedFor: { $ne: key } },
      { $set: { crmGrowthReportNotifiedFor: key } },
      { timestamps: false },
    );
    if (!claim.modifiedCount) continue;

    const { from, to } = resolved.period;
    const [leadsIn, wonIn, tasksIn, callsIn] = await Promise.all([
      Lead.countDocuments({ businessId: biz._id, tenantId: { $ne: PLATFORM_TENANT }, createdAt: { $gte: from, $lt: to } }),
      Lead.countDocuments({ businessId: biz._id, tenantId: { $ne: PLATFORM_TENANT }, convertedAt: { $gte: from, $lt: to } }),
      FollowUp.countDocuments({ businessId: biz._id, kind: 'task', scheduledFor: { $gte: from, $lt: to } }),
      CallEvent.countDocuments({ businessId: biz._id, startedAt: { $gte: from, $lt: to } }),
    ]);
    if (leadsIn + wonIn + tasksIn + callsIn === 0) { skipped++; continue; } // nothing happened → no "report ready" noise
    if (biz.userId) {
      const { requireModule } = await import('@/lib/moduleGating');
      const gate = await requireModule(String(biz.userId), 'sales_agent');
      if (!gate.ok) { skipped++; continue; } // CRM not on this plan → the report page would be locked
    }

    const month = resolved.period.label.split(' ')[0];
    const title = `Your ${month} Growth Report is ready`;
    const body = 'See your leads, revenue, ROI and follow-up performance.';
    try {
      const { notifyBusinessUsers } = await import('@/services/notifications');
      await notifyBusinessUsers(String(biz._id), { type: 'crm_growth_report_ready', title, body, link: `/dashboard/crm/growth-report?month=${key}` });
    } catch { /* best-effort */ }
    try {
      const { sendPushToBusinessUsers } = await import('@/services/push');
      await sendPushToBusinessUsers(String(biz._id), { title, body, data: { growthReportMonth: key } });
    } catch { /* best-effort */ }
    notified++;
  }
  return { notified, skipped };
}
