import dbConnect from '@/lib/mongodb';
import DemoBooking from '@/models/DemoBooking';
import { bookDemoOnCalendar, loadSchedule } from '@/services/calendar/bookDemoOnCalendar';
import { zonedLocalToUtc } from '@/services/calendar/demoScheduling';
import { CalendarError, SlotUnavailableError } from '@/services/calendar/googleCalendar';
import { friendlyDateLabel, friendlyTimeLabel } from '@/services/whatsapp-agent/dateTimeUtils';

export type FormSlotOutcome =
  | { status: 'confirmed'; booking: any; whenLabel: string; meetingLink: string; startUtc: Date; durationMinutes: number }
  /** Slot recorded but no calendar event (no calendar connected / calendar error) — an admin confirms it. */
  | { status: 'requested'; booking: any; whenLabel: string; startUtc: Date; durationMinutes: number }
  /** Someone took the slot between the picker and submit. */
  | { status: 'slot_taken' };

/**
 * Turns the date/time chosen on /book-demo into a DemoBooking.
 *
 *  - Calendar available and slot free  → Confirmed, with a real Meet link
 *    (never invented — bookDemoOnCalendar throws without one).
 *  - No calendar connected / calendar error → Pending *with the requested slot
 *    stored* (startUtc set), so it shows under Upcoming in Admin → Demos and an
 *    admin can confirm it, instead of vanishing into "needs scheduling".
 *  - Slot genuinely just taken → slot_taken, so the form can ask for another.
 */
export async function bookDemoSlotFromForm(input: {
  leadId: string;
  name: string;
  phone: string;
  email?: string;
  businessName?: string;
  budget?: string;
  date: string; // YYYY-MM-DD in the demo timezone
  time: string; // HH:mm
}): Promise<FormSlotOutcome> {
  await dbConnect();
  const { config } = await loadSchedule();
  const startUtc = zonedLocalToUtc(input.date, input.time, config.timezone);
  const durationMinutes = config.demoDurationMinutes;
  const dateLabel = friendlyDateLabel(input.date);
  const timeLabel = friendlyTimeLabel(input.time);
  const whenLabel = `${dateLabel} at ${timeLabel}`;
  const details = {
    name: input.name,
    email: input.email || undefined,
    company: input.businessName,
    challenges: input.budget ? `Monthly marketing budget: ${input.budget}` : undefined,
    channel: 'form' as const,
  };

  try {
    const created = await bookDemoOnCalendar({
      leadId: input.leadId,
      name: input.name,
      phone: input.phone,
      dateLabel,
      timeLabel,
      title: `GrowwMatics Demo — ${input.businessName || input.name}`,
      description: `Lead: ${input.name}\nBusiness: ${input.businessName || ''}\nPhone: ${input.phone}\nBooked from the website demo form.`,
      start: startUtc,
      durationMinutes,
      attendeeEmail: input.email,
    });
    if (!created.meetingLink?.startsWith('https://')) throw new CalendarError('Calendar event created without a Meet link');

    // bookDemoOnCalendar claimed/confirmed the row under its idempotency key —
    // enrich it, and drop the "To be scheduled" placeholder so there is one row.
    const booking: any = await DemoBooking.findOneAndUpdate(
      { idempotencyKey: created.idempotencyKey },
      { $set: { ...details, date: dateLabel, timeSlot: timeLabel, status: 'Confirmed', timezone: config.timezone } },
      { new: true }
    );
    await DemoBooking.deleteMany({ leadId: input.leadId, status: 'Pending', startUtc: { $exists: false }, _id: { $ne: booking._id } });
    return { status: 'confirmed', booking, whenLabel, meetingLink: created.meetingLink, startUtc, durationMinutes };
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (err instanceof SlotUnavailableError && /just taken|No salesperson is free|already being processed|not bookable/i.test(msg)) {
      return { status: 'slot_taken' };
    }
    console.warn('[book-demo] calendar booking unavailable, filing as a requested slot:', msg);
  }

  const endUtc = new Date(startUtc.getTime() + durationMinutes * 60 * 1000);
  const fields = { ...details, date: dateLabel, timeSlot: timeLabel, status: 'Pending', startUtc, endUtc, timezone: config.timezone };
  let booking: any = await DemoBooking.findOneAndUpdate(
    { leadId: input.leadId, status: 'Pending', calendarEventId: { $exists: false } },
    { $set: fields },
    { new: true }
  );
  if (!booking) booking = await DemoBooking.create({ leadId: input.leadId, phone: input.phone, ...fields });
  return { status: 'requested', booking, whenLabel, startUtc, durationMinutes };
}
