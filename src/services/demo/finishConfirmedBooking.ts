import type { FormSlotOutcome } from '@/services/demo/bookFromForm';

/**
 * Everything the WhatsApp booking agent does after it confirms a slot, for a
 * demo confirmed outside the chat (the website form, or a super admin booking
 * on the customer's behalf): ownership -> DEMO_SCHEDULED, reminders,
 * admin/customer email, and a WhatsApp confirmation with the Meet link.
 *
 * Returns whether the WhatsApp confirmation actually went out.
 */
export async function finishConfirmedBooking(ctx: {
  lead: any;
  booking: any;
  convo: any;
  phone: string;
  outcome: Extract<FormSlotOutcome, { status: 'confirmed' }>;
  /** Who did it, for LeadEvents / ownership audit ('book-demo-form', or the admin's user id). */
  actor: string;
  /** LeadEvent channel label, e.g. 'website-form' or 'super-admin'. */
  channel: string;
  /** false = book + remind, but send no WhatsApp confirmation (e.g. opted-out lead). */
  sendConfirmation?: boolean;
}): Promise<{ confirmationSent: boolean; confirmationError?: string }> {
  const { lead, booking, convo, outcome, phone, actor, channel } = ctx;
  const sendConfirmation = ctx.sendConfirmation !== false;
  const tag = `[demo:${channel}]`;

  const [{ setLeadOwnership }, { logLeadEvent }, { inngest }] = await Promise.all([
    import('@/services/leadOwnership/setLeadOwnership'),
    import('@/services/leadEvents'),
    import('@/services/inngest/client'),
  ]);

  convo.status = 'booked';
  convo.bookedAt = new Date();
  convo.bookingId = booking._id;
  const { demoConfirmationText } = await import('@/lib/whatsappOutbound');
  const confirmation = demoConfirmationText({
    whenLabel: outcome.whenLabel,
    meetingLink: outcome.meetingLink,
    timezone: booking.timezone,
  });
  await convo.save();

  await setLeadOwnership(lead._id, 'DEMO', 'demo-scheduled', actor, 'DEMO_SCHEDULED').catch((err: any) =>
    console.warn(`${tag} DEMO_SCHEDULED ownership failed:`, err?.message)
  );

  // After ownership: setLeadOwnership cancels pending actions on a stage change.
  try {
    const { scheduleDemoReminders } = await import('@/services/inngest/functions');
    booking.reminderActionIds = await scheduleDemoReminders(lead._id, booking, outcome.startUtc, outcome.durationMinutes);
    await booking.save();
  } catch (err: any) {
    console.warn(`${tag} scheduling reminders failed:`, err?.message);
  }

  await logLeadEvent(
    'DEMO_SCHEDULED',
    { date: booking.date, timeSlot: booking.timeSlot, bookingId: booking._id, meetingLink: outcome.meetingLink, channel },
    actor,
    { leadId: lead._id, phone, conversationType: 'booking', conversationId: convo._id }
  );

  await inngest
    .send({ name: 'demo/booked', data: { bookingId: String(booking._id) } })
    .catch((err: any) => console.warn(`${tag} demo/booked dispatch failed:`, err?.message));

  if (!sendConfirmation) return { confirmationSent: false };

  const { claimDemoConfirmationSend, releaseDemoConfirmationSend } = await import('@/services/demo/confirmationClaim');
  try {
    const claim = await claimDemoConfirmationSend(booking._id);
    if (claim === 'skip') return { confirmationSent: false, confirmationError: 'already-sent' };
    const { sendOutboundMessage } = await import('@/services/whatsapp/send');
    const sent = await sendOutboundMessage(phone, confirmation, String(lead._id));
    if (!sent.success) {
      await releaseDemoConfirmationSend(booking._id);
      console.warn(`${tag} WhatsApp confirmation failed (booking is still confirmed):`, sent.error);
      return { confirmationSent: false, confirmationError: sent.error || 'send-failed' };
    }
    convo.messages.push({ role: 'agent', text: confirmation, at: new Date() });
    await convo.save();
    return { confirmationSent: true };
  } catch (err: any) {
    await releaseDemoConfirmationSend(booking._id).catch(() => {});
    console.warn(`${tag} WhatsApp confirmation failed (booking is still confirmed):`, err?.message);
    return { confirmationSent: false, confirmationError: err?.message || 'send-failed' };
  }
}
