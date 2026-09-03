import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import DemoBooking from '@/models/DemoBooking';
import Business from '@/models/Business';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/demos
 *
 * The demo dashboard. Works entirely off the existing DemoBooking model —
 * NO Google Calendar dependency: calendar fields (meetingLink,
 * calendarEventId) are surfaced when present and shown as "not linked"
 * otherwise, never blocking the view.
 *
 * Groups: today / upcoming / scheduled (all future+pending) / completed /
 * cancelled / rescheduled / no-show. Each row carries the lead + business +
 * post-demo outcome (derived from the lead's intent/stage after the demo).
 *
 * `date`/`timeSlot` on DemoBooking are friendly strings, not Date objects, so
 * "today"/"upcoming" is best-effort parsed and falls back to createdAt-based
 * ordering when a string can't be parsed.
 */
export async function GET(_req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    // Platform leads only.
    const platformLeads = await Lead.find({ tenantId: PLATFORM_TENANT })
      .select('_id name phone businessId intent currentStage currentAgent')
      .lean();
    const leadMap = new Map((platformLeads as any[]).map((l) => [String(l._id), l]));
    const leadIds = (platformLeads as any[]).map((l) => l._id);

    const bookings = await DemoBooking.find({ leadId: { $in: leadIds } })
      .sort({ createdAt: -1 })
      .lean();

    const bizIds = [
      ...new Set(
        (platformLeads as any[])
          .map((l) => l.businessId && String(l.businessId))
          .filter(Boolean)
      ),
    ];
    const businesses = bizIds.length
      ? await Business.find({ _id: { $in: bizIds } }).select('name').lean()
      : [];
    const bizMap = new Map((businesses as any[]).map((b) => [String(b._id), b.name]));

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    const rows = (bookings as any[]).map((b) => {
      const lead = leadMap.get(String(b.leadId));
      const parsed = tryParseDemoDate(b.date, b.timeSlot);
      // Post-demo outcome: derived from the lead's post-demo intent/stage.
      let outcome: string | null = null;
      if (b.status === 'Completed' && lead) {
        if (lead.currentAgent === 'IN_HOUSE' || lead.currentStage === 'CUSTOMER') outcome = 'Converted';
        else if (['PURCHASE_INTEREST', 'READY_TO_BUY'].includes(lead.intent || '')) outcome = 'High interest';
        else if (lead.intent === 'NOT_INTERESTED') outcome = 'Not interested';
        else outcome = 'Following up';
      } else if (b.status === 'No Show') outcome = 'No-show';

      return {
        _id: String(b._id),
        leadId: String(b.leadId),
        lead: lead?.name ?? b.name ?? null,
        phone: lead?.phone ?? b.phone ?? null,
        business: lead?.businessId ? bizMap.get(String(lead.businessId)) ?? null : b.company ?? null,
        date: b.date,
        timeSlot: b.timeSlot,
        parsedStart: parsed ? parsed.toISOString() : null,
        status: b.status,
        channel: b.channel,
        meetingLink: b.meetingLink ?? null,
        calendarLinked: !!b.calendarEventId,
        outcome,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      };
    });

    const isFuture = (r: any) => (r.parsedStart ? new Date(r.parsedStart) >= now : false);
    const isToday = (r: any) =>
      r.parsedStart ? new Date(r.parsedStart) >= startOfToday && new Date(r.parsedStart) < endOfToday : false;

    const scheduledStatuses = ['Pending', 'Confirmed'];

    return NextResponse.json({
      success: true,
      counts: {
        total: rows.length,
        scheduled: rows.filter((r) => scheduledStatuses.includes(r.status)).length,
        today: rows.filter((r) => isToday(r) && scheduledStatuses.includes(r.status)).length,
        upcoming: rows.filter((r) => isFuture(r) && scheduledStatuses.includes(r.status)).length,
        completed: rows.filter((r) => r.status === 'Completed').length,
        cancelled: rows.filter((r) => r.status === 'Cancelled').length,
        rescheduled: rows.filter((r) => r.status === 'Rescheduled').length,
        noShow: rows.filter((r) => r.status === 'No Show').length,
      },
      groups: {
        today: rows.filter((r) => isToday(r) && scheduledStatuses.includes(r.status)),
        upcoming: rows.filter((r) => isFuture(r) && !isToday(r) && scheduledStatuses.includes(r.status)),
        needsScheduling: rows.filter((r) => r.status === 'Pending' && !r.parsedStart),
        completed: rows.filter((r) => r.status === 'Completed').slice(0, 50),
        cancelledOrNoShow: rows
          .filter((r) => ['Cancelled', 'No Show', 'Rescheduled'].includes(r.status))
          .slice(0, 50),
      },
      all: rows,
    });
  } catch (error: any) {
    console.error('[admin/conversion/demos] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}

/**
 * Best-effort parse of DemoBooking's friendly `date` + `timeSlot` strings.
 * Returns null if it can't — callers then order by createdAt instead.
 */
function tryParseDemoDate(date?: string, timeSlot?: string): Date | null {
  if (!date) return null;
  const combined = timeSlot ? `${date} ${timeSlot.split(/[-–—]/)[0].trim()}` : date;
  const d = new Date(combined);
  if (!Number.isNaN(d.getTime())) return d;
  const d2 = new Date(date);
  return Number.isNaN(d2.getTime()) ? null : d2;
}
