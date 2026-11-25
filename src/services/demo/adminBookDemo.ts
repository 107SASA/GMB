import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import DemoBooking from '@/models/DemoBooking';
import BookingConversation from '@/models/BookingConversation';
import { phoneDedupeKey } from '@/lib/phone';
import { PLATFORM_TENANT } from '@/lib/admin/conversionFunnel';

/**
 * A super admin books a demo on a platform lead's behalf, typically right
 * after a phone call ("they said today 11 am"). From the customer's side it
 * is the same as booking the slot themselves: a Google Calendar event with a
 * Meet link, the WhatsApp confirmation, the 24h / 1h / 15m reminders and the
 * no-show check, all run by the Demo agent.
 *
 * Rules:
 *  - Only an open slot (same availability the website picker and WhatsApp
 *    agent use), so the team can't double-book a salesperson.
 *  - One live upcoming demo per lead — to change it, reschedule from Demos.
 *  - A lead the team took over (HUMAN) is handed to the Demo agent, because
 *    reminders are skipped for human-owned leads. Booking the demo is the
 *    team's decision to let the agent run it.
 *  - A Growth-Partner-managed lead stays with the partner: the calendar
 *    event is booked, but no AI WhatsApp message is sent.
 *  - An opted-out / do-not-contact lead gets the booking but no WhatsApp.
 */

export type AdminBookResult =
  | {
      ok: true;
      status: 'confirmed' | 'requested';
      bookingId: string;
      whenLabel: string;
      meetingLink?: string;
      whatsappSent: boolean;
      /** Why no WhatsApp went out, in plain words, when it didn't. */
      whatsappNote?: string;
    }
  | { ok: false; status: number; error: string; code?: string };

export async function adminBookDemo(input: {
  leadId: string;
  adminUserId: string;
  date: string; // YYYY-MM-DD in the demo timezone
  time: string; // HH:mm
  email?: string;
  note?: string;
  now?: Date;
}): Promise<AdminBookResult> {
  await dbConnect();
  const now = input.now || new Date();

  const lead: any = await Lead.findOne({ _id: input.leadId, tenantId: PLATFORM_TENANT });
  if (!lead) return { ok: false, status: 404, error: 'Lead not found.' };
  if (!lead.phone) return { ok: false, status: 400, error: 'This lead has no phone number, so WhatsApp reminders cannot be sent. Add a phone number first.' };

  const existing: any = await DemoBooking.findOne({
    leadId: lead._id,
    status: { $in: ['Pending', 'Confirmed'] },
    startUtc: { $gt: now },
  }).lean();
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'already_booked',
      error: `This lead already has a demo on ${existing.date} at ${existing.timeSlot}. To change it, use Reschedule on the Demos page.`,
    };
  }

  const { listOpenSlots } = await import('@/services/calendar/publicSlots');
  const open = await listOpenSlots(input.date, now);
  if (!open.slots.some((s) => s.time === input.time)) {
    return { ok: false, status: 409, code: 'slot_unavailable', error: 'That time is not open any more — please pick another slot.' };
  }

  const email = input.email?.trim().toLowerCase() || lead.email || undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: 'Please enter a valid email address.' };
  }
  if (email && !lead.email) {
    await Lead.updateOne({ _id: lead._id }, { $set: { email } }).catch(() => {});
  }

  const { isPartnerManagedLead } = await import('@/lib/partners/referral');
  const { isHumanOwned, isOptedOutOrDoNotContact } = await import('@/services/agentHandoff/isHumanOwned');
  const { setLeadOwnership } = await import('@/services/leadOwnership/setLeadOwnership');
  const { logLeadEvent } = await import('@/services/leadEvents');
  const actor = input.adminUserId;
  const partnerManaged = isPartnerManagedLead(lead);
  const optedOut = isOptedOutOrDoNotContact(lead);

  const { crmDisplayName } = await import('@/lib/admin/platformCrm');
  const name = crmDisplayName(lead);
  const businessName = lead.businessType || undefined;

  const { bookDemoSlotFromForm } = await import('@/services/demo/bookFromForm');
  const outcome = await bookDemoSlotFromForm({
    leadId: String(lead._id),
    name,
    phone: lead.phone,
    email,
    businessName,
    budget: lead.budget || undefined,
    date: input.date,
    time: input.time,
    channel: 'admin',
    note: input.note,
  });
  if (outcome.status === 'slot_taken') {
    return { ok: false, status: 409, code: 'slot_unavailable', error: 'Someone just took that slot — please pick another.' };
  }
  const booking: any = outcome.booking;

  // Only now that the slot is held: hand the lead to the Demo agent (see the
  // file comment). Before reminders are scheduled — a stage change cancels
  // pending actions.
  if (!partnerManaged) {
    if (isHumanOwned(lead)) {
      const { releaseFromHuman } = await import('@/services/leadOwnership/releaseFromHuman');
      await releaseFromHuman(lead._id, 'DEMO', 'demo-booked-by-admin', actor, 'DEMO_REQUESTED');
    } else {
      await setLeadOwnership(lead._id, 'DEMO', 'demo-booked-by-admin', actor, 'DEMO_REQUESTED');
    }
  }
  if (lead.intent !== 'DEMO_INTEREST') {
    await Lead.updateOne({ _id: lead._id }, { $set: { intent: 'DEMO_INTEREST' } }).catch(() => {});
  }

  // The booking chat the Demo agent uses, so the customer's WhatsApp replies
  // ("can we move it?") land in the booked thread.
  const phoneKey = phoneDedupeKey(lead.phone);
  let convo: any = await BookingConversation.findOne({ phoneKey, status: { $in: ['active', 'awaiting_slot_selection'] } });
  if (!convo) {
    convo = await BookingConversation.create({
      leadPhone: lead.phone,
      phoneKey,
      leadName: name,
      status: 'active',
      leadId: lead._id,
      bookingId: booking._id,
      details: {
        name,
        businessName: businessName || '',
        notes: ['Booked by our team on the customer\'s behalf', input.note].filter(Boolean).join(' | '),
      },
      messages: [],
    });
  } else {
    convo.leadId = convo.leadId || lead._id;
    convo.bookingId = booking._id;
    await convo.save();
  }

  await logLeadEvent(
    'DEMO_REQUESTED',
    { channel: 'super-admin', note: input.note || null, partnerManaged },
    actor,
    { leadId: lead._id, phone: lead.phone, conversationType: 'booking', conversationId: convo._id }
  );

  if (outcome.status === 'requested') {
    // No calendar connected / calendar error: the slot is held as Pending on
    // the Demos page. No WhatsApp yet — there is no Meet link to send.
    return {
      ok: true,
      status: 'requested',
      bookingId: String(booking._id),
      whenLabel: outcome.whenLabel,
      whatsappSent: false,
      whatsappNote: 'Google Calendar could not create the event, so the slot is saved as Pending on the Demos page. Confirm it there to send the Meet link.',
    };
  }

  const { finishConfirmedBooking } = await import('@/services/demo/finishConfirmedBooking');
  if (partnerManaged) {
    // Partner leads: keep them HUMAN-owned. Calendar event only.
    convo.status = 'booked';
    convo.bookedAt = new Date();
    await convo.save();
    await logLeadEvent(
      'DEMO_SCHEDULED',
      { date: booking.date, timeSlot: booking.timeSlot, bookingId: booking._id, meetingLink: outcome.meetingLink, channel: 'super-admin' },
      actor,
      { leadId: lead._id, phone: lead.phone, conversationType: 'booking', conversationId: convo._id }
    );
    return {
      ok: true,
      status: 'confirmed',
      bookingId: String(booking._id),
      whenLabel: outcome.whenLabel,
      meetingLink: outcome.meetingLink,
      whatsappSent: false,
      whatsappNote: 'This lead belongs to a Growth Partner, so the AI sends no WhatsApp. Share the Meet link with the partner.',
    };
  }

  const sent = await finishConfirmedBooking({
    lead,
    booking,
    convo,
    outcome,
    phone: lead.phone,
    actor,
    channel: 'super-admin',
    sendConfirmation: !optedOut,
  });

  return {
    ok: true,
    status: 'confirmed',
    bookingId: String(booking._id),
    whenLabel: outcome.whenLabel,
    meetingLink: outcome.meetingLink,
    whatsappSent: sent.confirmationSent,
    whatsappNote: optedOut
      ? 'This lead has opted out of messages, so no WhatsApp was sent. Share the Meet link yourself.'
      : sent.confirmationSent
        ? undefined
        : `The WhatsApp confirmation did not go out (${sent.confirmationError || 'unknown error'}). The demo is booked and reminders are scheduled.`,
  };
}
