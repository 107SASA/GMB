import DemoBooking from '@/models/DemoBooking';
import { shouldDispatchConfirmation } from '@/lib/whatsappOutbound';

/**
 * One confirmation WhatsApp per confirmed booking. The timestamp is claimed
 * before the send so a second submit cannot send another message. It is
 * cleared when the send fails, so a failure is not stored as delivered.
 */
export async function claimDemoConfirmationSend(bookingId: unknown): Promise<'claimed' | 'skip'> {
  const booking = await DemoBooking.findById(bookingId)
    .select('status calendarEventId meetingLink whatsappConfirmationSentAt')
    .lean() as {
      status?: string;
      calendarEventId?: string;
      meetingLink?: string;
      whatsappConfirmationSentAt?: Date;
    } | null;
  if (!booking) return 'skip';
  if (!shouldDispatchConfirmation({
    calendarConfirmed: booking.status === 'Confirmed' && !!booking.calendarEventId,
    meetingLink: booking.meetingLink,
    alreadySentAt: booking.whatsappConfirmationSentAt,
  })) return 'skip';

  const updated = await DemoBooking.updateOne(
    { _id: bookingId, whatsappConfirmationSentAt: { $exists: false } },
    { $set: { whatsappConfirmationSentAt: new Date() } }
  );
  return updated.modifiedCount === 1 ? 'claimed' : 'skip';
}

export async function releaseDemoConfirmationSend(bookingId: unknown): Promise<void> {
  await DemoBooking.updateOne({ _id: bookingId }, { $unset: { whatsappConfirmationSentAt: 1 } });
}
