import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import DemoBooking from '@/models/DemoBooking';
import Business from '@/models/Business';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';
import { attendanceEditable, confirmedAttendance, demoHasEnded } from '@/lib/preSalesRules';

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
    // "Today" is the India day, whatever timezone the server runs in.
    const startOfToday = startOfDayIn(DEMO_TIMEZONE, now);
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    const rows = (bookings as any[]).map((b) => {
      const lead = leadMap.get(String(b.leadId));
      // startUtc is the authoritative instant (set by the calendar/form booking
      // paths). The friendly date/timeSlot strings are only a fallback for
      // older rows — and they carry NO year, which is what used to make every
      // WhatsApp-booked demo parse as 2001 and fall out of every tab.
      const parsed = b.startUtc ? new Date(b.startUtc) : tryParseDemoDate(b.date, b.timeSlot);
      // Post-demo outcome: derived from the lead's post-demo intent/stage.
      // Attendance a person recorded for THIS demo time, or the automatic
      // timeout's 'unconfirmed' — never shown as a confirmed no-show.
      const staffOutcome = confirmedAttendance(b);
      const autoUnconfirmed = !staffOutcome && b.status === 'No Show' && b.attendance?.source === 'auto-timeout';
      let outcome: string | null = null;
      if (staffOutcome) {
        outcome = { attended: 'Attended', no_show: 'No-show (confirmed)', declined: 'Declined', not_ready: 'Not ready', team_missed: 'Our team missed it' }[staffOutcome];
      } else if (autoUnconfirmed) {
        outcome = 'No-show (auto, unconfirmed)';
      } else if (b.status === 'Completed' && lead) {
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
        business: (lead?.businessId ? bizMap.get(String(lead.businessId)) : null) ?? b.company ?? null,
        email: b.email ?? null,
        date: b.date,
        timeSlot: b.timeSlot,
        parsedStart: parsed ? parsed.toISOString() : null,
        status: b.status,
        channel: b.channel,
        meetingLink: b.meetingLink ?? null,
        calendarLinked: !!b.calendarEventId,
        outcome,
        attendance: staffOutcome,
        attendanceUnconfirmed: autoUnconfirmed,
        // Outcome buttons appear once the recorded demo time has passed.
        canConfirmAttendance: attendanceEditable(b) && demoHasEnded(b, now) === true,
        // Over (recorded end, else ~1h after a parsed start) and nobody has said what happened.
        needsOutcome: !staffOutcome && ['Pending', 'Confirmed'].includes(b.status) && (
          demoHasEnded(b, now) ?? (parsed ? parsed.getTime() + 60 * 60 * 1000 <= now.getTime() : false)
        ),
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
        overdue: rows.filter((r) => r.needsOutcome || r.attendanceUnconfirmed).length,
      },
      groups: {
        today: rows.filter((r) => isToday(r) && scheduledStatuses.includes(r.status)),
        upcoming: rows.filter((r) => isFuture(r) && !isToday(r) && scheduledStatuses.includes(r.status)),
        // Scheduled (Pending/Confirmed), already over, and nobody has recorded
        // what happened — as soon as it ends, not from the next day.
        overdue: rows.filter((r) => r.needsOutcome || r.attendanceUnconfirmed),
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

const DEMO_TIMEZONE = 'Asia/Kolkata';

/** Midnight of `now`'s calendar day in `timeZone`, as a UTC instant. */
function startOfDayIn(timeZone: string, now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMs);
}

/**
 * Best-effort parse of DemoBooking's friendly `date` + `timeSlot` strings.
 * Returns null if it can't — callers then order by createdAt instead.
 */
function tryParseDemoDate(date?: string, timeSlot?: string): Date | null {
  if (!date) return null;
  const time = timeSlot ? timeSlot.split(/[-–—]/)[0].trim() : '';
  const hasYear = /\b(19|20)\d{2}\b/.test(date);
  const now = Date.now();
  // Legacy labels ("Monday, 7 October") have no year and were written in IST.
  // Without a year V8 assumes 2001, so supply one: this year, rolling to next
  // year if that lands more than ~2 months in the past.
  const attempt = (year?: number) => {
    const d = new Date(`${date}${hasYear || !year ? '' : ` ${year}`} ${time} GMT+0530`.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  };
  if (hasYear) return attempt();
  const thisYear = new Date().getFullYear();
  const a = attempt(thisYear);
  if (!a) return null;
  return a.getTime() < now - 60 * 24 * 60 * 60 * 1000 ? attempt(thisYear + 1) : a;
}
