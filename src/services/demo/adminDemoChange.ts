import dbConnect from '@/lib/mongodb';
import DemoBooking from '@/models/DemoBooking';
import BookingConversation from '@/models/BookingConversation';
import Lead from '@/models/Lead';
import { demoTimeKey } from '@/lib/preSalesRules';

/**
 * A super admin cancels or reschedules a demo from the Demos page. Same
 * effects as the customer doing it on WhatsApp: the calendar slot is freed,
 * reminders are cancelled, and the booking chat no longer claims the demo is
 * on. The customer is told ONCE — only when the demo was still upcoming
 * (an admin tidying up a past booking sends nothing).
 */

const LIVE_STATUSES = ['Pending', 'Confirmed'];

function firstWord(name?: string | null): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/** The message a customer gets when the team cancels / moves their demo. */
export function adminDemoChangeMessage(input: { change: 'Cancelled' | 'Rescheduled'; name?: string | null; whenLabel?: string | null }): string {
  const hi = firstWord(input.name) ? `Hi ${firstWord(input.name)},` : 'Hi,';
  const when = input.whenLabel ? ` on ${input.whenLabel}` : '';
  if (input.change === 'Cancelled') {
    return `${hi} your Growwmatics demo${when} has been cancelled. If you'd still like one, reply DEMO and we'll find a new time.`;
  }
  return `${hi} we need to move your Growwmatics demo${when} — sorry for the change. Reply RESCHEDULE and I'll share the open slots.`;
}

export async function applyAdminDemoChange(input: {
  bookingId: string;
  change: 'Cancelled' | 'Rescheduled';
  /** Booking status before the admin's change. */
  previousStatus: string;
  now?: Date;
}): Promise<{ customerNotified: boolean; notifyError?: string }> {
  await dbConnect();
  const now = input.now || new Date();
  const booking: any = await DemoBooking.findById(input.bookingId);
  if (!booking) return { customerNotified: false, notifyError: 'booking-missing' };

  // Free the salesperson's slot and stop the reminders (both best-effort).
  if (booking.calendarEventId) {
    try {
      const { cancelBookedEvent } = await import('@/services/calendar/bookDemoOnCalendar');
      await cancelBookedEvent(booking);
    } catch (err: any) {
      console.warn('[admin-demo-change] calendar event cancel failed:', err?.message);
    }
  }
  if (booking.leadId) {
    const { cancelScheduledActions } = await import('@/services/scheduler/cancelScheduledActions');
    await cancelScheduledActions(booking.leadId, input.change === 'Cancelled' ? 'demo-cancelled' : 'demo-rescheduled');
  }

  if (input.change === 'Cancelled') {
    // The chat no longer describes a booked demo, and the lead goes back to
    // the Sales agent — the same hand-back as a customer's own cancel.
    await BookingConversation.updateMany({ bookingId: booking._id, status: { $ne: 'stopped' } }, { $set: { status: 'stopped' } });
    if (booking.leadId) {
      const lead: any = await Lead.findById(booking.leadId).select('currentAgent').lean();
      if (lead?.currentAgent === 'DEMO') {
        try {
          const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
          await setLeadOwnership(booking.leadId, 'SALES', 'demo-cancelled-by-admin', 'super-admin', 'NURTURING');
        } catch (err: any) {
          console.warn('[admin-demo-change] hand-back to SALES failed:', err?.message);
        }
      }
    }
  }
  // Rescheduled: the booking chat stays 'booked', so the customer's
  // "RESCHEDULE" reply runs the existing pick-a-new-time flow.

  const upcoming = !booking.startUtc || new Date(booking.startUtc).getTime() > now.getTime();
  if (!LIVE_STATUSES.includes(input.previousStatus) || !upcoming || !booking.phone) return { customerNotified: false };

  // Once per (change, demo time) — repeated dropdown edits never resend.
  const key = `${input.change}:${demoTimeKey(booking)}`;
  const claim = await DemoBooking.updateOne({ _id: booking._id, adminNoticeFor: { $ne: key } }, { $set: { adminNoticeFor: key } });
  if (claim.modifiedCount !== 1) return { customerNotified: false };

  const text = adminDemoChangeMessage({
    change: input.change,
    name: booking.name,
    whenLabel: booking.date && booking.timeSlot ? `${booking.date} at ${booking.timeSlot}` : null,
  });
  const { sendOutboundMessage } = await import('@/services/whatsapp/send');
  const res = await sendOutboundMessage(booking.phone, text, booking.leadId ? String(booking.leadId) : undefined);
  if (!res.success) {
    await DemoBooking.updateOne({ _id: booking._id, adminNoticeFor: key }, { $unset: { adminNoticeFor: '' } });
    return { customerNotified: false, notifyError: res.error };
  }
  // Keep the chat history truthful for whoever reads it next.
  await BookingConversation.updateOne(
    { bookingId: booking._id },
    { $push: { messages: { role: 'agent', text, at: new Date() } } }
  );
  return { customerNotified: true };
}
