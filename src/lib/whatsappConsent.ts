import SalesConversation from '@/models/SalesConversation';
import BookingConversation from '@/models/BookingConversation';
import ReportConversation from '@/models/ReportConversation';

/**
 * Has this phone number ever sent an INBOUND WhatsApp message to the
 * platform before, across any of the three platform-owned conversation
 * types? A phone that has already texted the platform's own WhatsApp line
 * (booking, report-connect, or an earlier sales reply) has functionally
 * already opted in to being messaged there — a brand-new number sourced
 * from the public /free-report web form has not, since nobody has verified
 * the submitter actually controls that number.
 */
export async function hasPhoneMessagedPlatformBefore(phoneKey: string | null | undefined): Promise<boolean> {
  if (!phoneKey) return false;

  const leadMessageFilter = { phoneKey, messages: { $elemMatch: { role: 'lead' } } };

  const [sales, booking, report] = await Promise.all([
    SalesConversation.exists(leadMessageFilter),
    BookingConversation.exists(leadMessageFilter),
    ReportConversation.exists(leadMessageFilter),
  ]);

  return Boolean(sales || booking || report);
}

export const CONSENT_REQUEST_MESSAGE =
  "Hi! 👋 We just finished your free Google Business report. Reply *YES* if you'd like us to send you the key insights here on WhatsApp.";

const AFFIRMATIVE_REPLIES = new Set(['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay']);

/** Loose match on purpose — a real person replying "Yes please!" should count. */
export function isAffirmativeReply(body: string): boolean {
  const normalized = (body || '').trim().toLowerCase().replace(/[.!?]+$/, '');
  return AFFIRMATIVE_REPLIES.has(normalized);
}
