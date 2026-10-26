import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import DemoBooking from '@/models/DemoBooking';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { demoHasEnded } from '@/lib/preSalesRules';

// The shared connection (lib/mongodb) — same settings as every other route.
const connectDB = dbConnect;

// Fetch all demo bookings for Super Admin dashboard
export async function GET() {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await connectDB();

    // We populate the leadId if needed, but the core info is on DemoBooking
    const bookings = await DemoBooking.find().sort({ createdAt: -1 }).lean();

    // Phase 8 — join each booking's Lead.currentAgent/humanHandoff so the
    // admin UI can show/act on a HUMAN-owned lead's "Return to AI" control.
    // Manual map (not .populate()) since bookings came back as plain lean
    // objects above and this only needs two small fields, same lightweight
    // join style already used by api/admin/sales-leads/route.ts.
    const { default: Lead } = await import('@/models/Lead');
    const leadIds = bookings.map((b: any) => b.leadId).filter(Boolean);
    const leads = leadIds.length
      ? await Lead.find({ _id: { $in: leadIds } }).select('currentAgent humanHandoff').lean()
      : [];
    const leadMap = new Map(leads.map((l: any) => [String(l._id), l]));

    const bookingsWithLead = bookings.map((b: any) => ({
      ...b,
      leadCurrentAgent: b.leadId ? leadMap.get(String(b.leadId))?.currentAgent ?? null : null,
      leadHumanHandoff: b.leadId ? leadMap.get(String(b.leadId))?.humanHandoff ?? null : null,
    }));

    return NextResponse.json({ success: true, bookings: bookingsWithLead });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}

// Update demo booking status
export async function PATCH(req: Request) {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await connectDB();
    const { bookingId, status, action, targetAgent, attendance } = await req.json();

    // A person records what happened at a demo that has ended: attended,
    // no_show, declined or not_ready. The only path that can schedule a
    // post-demo WhatsApp message (one per demo time) — see
    // services/sales/preSalesPolicy.ts confirmDemoAttendance.
    if (attendance !== undefined) {
      if (!bookingId) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      const { confirmDemoAttendance } = await import('@/services/sales/preSalesPolicy');
      const result = await confirmDemoAttendance({ bookingId, outcome: attendance, staffUserId: authResult.userId });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ success: true, followUpScheduled: result.scheduled });
    }

    // Phase 8 — "Return to AI": a human admin releases a HUMAN-owned lead
    // back to an agent (SALES/DEMO/IN_HOUSE), clearing humanHandoff.active.
    // Separate action from the status-change branch below since it mutates
    // the LEAD, not the booking's own status.
    if (action === 'returnToAI') {
      if (!bookingId || !targetAgent) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }
      const validAgents = ['SALES', 'DEMO', 'IN_HOUSE'];
      if (!validAgents.includes(targetAgent)) {
        return NextResponse.json({ error: 'Invalid targetAgent' }, { status: 400 });
      }

      const booking = await DemoBooking.findById(bookingId).select('leadId').lean() as any;
      if (!booking?.leadId) {
        return NextResponse.json({ error: 'Booking has no associated lead' }, { status: 404 });
      }

      // P0 fix (post-implementation-audit) — releaseFromHuman wraps
      // setLeadOwnership with the transient handoff-trigger-state cleanup
      // that must happen alongside a release, so the same handoff reason
      // that caused the original HUMAN transition can't immediately
      // re-fire from stale state on the very next message. See that
      // function's own doc comment for exactly what is and isn't reset
      // per handoff reason (leadScore/followUpsSent history is never
      // erased — only a release-time baseline is recorded).
      const { releaseFromHuman } = await import('@/services/leadOwnership/releaseFromHuman');
      // The stage a released lead resumes at is a judgment call per target
      // agent — NURTURING/DEMO_REQUESTED are the natural "back in the AI's
      // hands, mid-journey" stages for Sales/Demo; IN_HOUSE keeps CUSTOMER
      // (a released support conversation doesn't change the lead's
      // customer status).
      const resumeStage = targetAgent === 'DEMO' ? 'DEMO_REQUESTED' : targetAgent === 'IN_HOUSE' ? 'CUSTOMER' : 'NURTURING';
      await releaseFromHuman(booking.leadId, targetAgent, 'human-released', authResult.userId, resumeStage);

      return NextResponse.json({ success: true });
    }

    if (!bookingId || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show', 'Rescheduled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const before: any = await DemoBooking.findById(bookingId).lean();
    if (!before) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    // A demo can't be "completed" before it has happened — that would mark the
    // lead as having had a demo and stop its reminders.
    if (status === 'Completed' && demoHasEnded(before) === false) {
      return NextResponse.json(
        { error: "This demo hasn't ended yet. Once it has, record what happened with the Attendance buttons." },
        { status: 409 }
      );
    }

    const booking = await DemoBooking.findByIdAndUpdate(
      bookingId,
      { status },
      { new: true }
    );

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Optionally: if status is 'Converted', we can trigger customer onboarding logic or update the Lead pipelineStage
    if (status === 'Completed') {
      const { default: Lead } = await import('@/models/Lead');
      await Lead.findByIdAndUpdate(booking.leadId, { pipelineStage: 'Demo Completed' });

      // Post-demo analysis (Phase 6) — classifies the outcome from the real
      // conversation transcript and updates Lead.intent/objections/
      // leadScore/currentStage, then hands ownership back to SALES. This is
      // the "manual mark complete" trigger the task specifies (the automatic
      // no-show timeout no longer runs it — a timeout is not attendance
      // data; see runNoShowCheck). Best-effort — never fails this admin request if
      // the analysis itself fails; the status update above still stands.
      if (booking.leadId) {
        try {
          const { default: BookingConversation } = await import('@/models/BookingConversation');
          const convo = await BookingConversation.findOne({ bookingId: booking._id }).lean() as any;
          const history = (convo?.messages || []).map((m: any) => ({
            role: m.role === 'lead' ? ('lead' as const) : ('agent' as const),
            text: m.text,
          }));
          const { runPostDemoAnalysis } = await import('@/services/demo/postDemoAnalysis');
          await runPostDemoAnalysis(booking.leadId, history);
        } catch (err) {
          console.warn('[demo-bookings PATCH] post-demo analysis failed:', err instanceof Error ? err.message : err);
        }
      }
    }
    // A status edit never sends a post-demo WhatsApp message: only the
    // explicit attendance confirmation above (attendance: ...) does.

    // Cancelled / Rescheduled by the team: free the calendar slot, stop the
    // reminders, make the booking chat stop claiming the demo is on, and
    // tell the customer once if the demo was still upcoming.
    let customerNotified = false;
    let notifyError: string | undefined;
    if ((status === 'Cancelled' || status === 'Rescheduled') && before.status !== status) {
      const { applyAdminDemoChange } = await import('@/services/demo/adminDemoChange');
      ({ customerNotified, notifyError } = await applyAdminDemoChange({ bookingId: String(booking._id), change: status, previousStatus: before.status }));
    }

    return NextResponse.json({ success: true, booking, customerNotified, ...(notifyError ? { notifyError } : {}) });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
