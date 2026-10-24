import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import ReviewRequest from '@/models/ReviewRequest';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Inbound WhatsApp from a customer who received a review request on the
 * GrowwMatics platform number (the shared line review requests go out on).
 * That person is a business's customer — not a Growwmatics prospect — so:
 *  - STOP / UNSUBSCRIBE / CANCEL opts out exactly the Customer records that
 *    were messaged at this number and have a recent or still-open review
 *    request, and stops their open requests (pending follow-ups and a
 *    not-yet-sent first message). A customer record with the same number but
 *    no such request (another business, or an old finished one) is not touched.
 *  - any other reply gets no automatic message: no sales menu, no support
 *    thread (handled in the webhook's platform pipeline).
 *
 * Matching: Customer.phone is stored in several formats (E.164 from the
 * dashboard and quick-add, bare digits or raw text from CSV uploads). The
 * Twilio sender normalizes every number with normalizePhoneE164 before
 * sending, so a customer is "this recipient" exactly when normalizePhoneE164
 * of their stored phone equals that of the inbound number. Candidates are
 * found by their last 10 digits (any separators), then compared exactly —
 * a number that only shares the last 10 digits (another country code) is
 * not matched.
 */

/** A phone counts as a review recipient for this long after the last review-request message to it. */
export const REVIEW_RECIPIENT_WINDOW_DAYS = 30;

/** Mongo regex for stored phones whose last 10 digits are these, allowing spaces, dashes or brackets between them. */
export function last10DigitsPattern(phone: string): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `${digits.slice(-10).split('').join('\\D*')}\\D*$`;
}

/**
 * Customers whose stored phone is the same WhatsApp address as `phone` —
 * across all businesses, or within one (`businessId`: the tenant's own
 * number; that query uses the { businessId, phone } index prefix).
 */
export async function customersAt(phone: string, businessId?: unknown): Promise<Array<{ _id: unknown }>> {
  const target = normalizePhoneE164(phone);
  const pattern = last10DigitsPattern(phone);
  if (!target || !pattern) return [];
  const candidates = await Customer.find({ ...(businessId ? { businessId } : {}), phone: { $regex: pattern } }).select('_id phone').lean();
  return (candidates as Array<{ _id: unknown; phone?: string }>).filter((c) => !!c.phone && normalizePhoneE164(c.phone) === target);
}

/**
 * Review requests to this number that make it a recipient now: a message
 * went out within the window, or the request is still running (its follow-up
 * can be weeks after the first message when Super Admin sets long delays).
 */
export async function recipientRequests(phone: string, now = new Date()): Promise<Array<{ _id: unknown; customerId: unknown; businessId: unknown }>> {
  const customers = await customersAt(phone);
  if (!customers.length) return [];
  const since = new Date(now.getTime() - REVIEW_RECIPIENT_WINDOW_DAYS * 86_400_000);
  return ReviewRequest.find({
    customerId: { $in: customers.map((c) => c._id) },
    $or: [
      { sentAt: { $gte: since } },
      { 'messageHistory.sentAt': { $gte: since } },
      { sentAt: { $exists: true }, automationStatus: 'Active', status: { $nin: ['Failed', 'Cancelled'] } },
    ],
  }).select('_id customerId businessId').lean() as any;
}

/** True when this phone was sent a review request recently, or one is still running. */
export async function isRecentReviewRecipient(phone: string, now = new Date()): Promise<boolean> {
  await dbConnect();
  return (await recipientRequests(phone, now)).length > 0;
}

/**
 * STOP from a review recipient: opt out the customers behind those requests
 * and stop every open request of those customers. Idempotent; throws on a
 * database error so the caller can retry. Returns what changed and which
 * businesses the recipient was opted out of (for the persistent suppression).
 */
export async function optOutReviewRecipient(phone: string, now = new Date()): Promise<{ customers: number; requests: number; businessIds: string[] }> {
  await dbConnect();
  const requests = await recipientRequests(phone, now);
  if (!requests.length) return { customers: 0, requests: 0, businessIds: [] };
  const businessIds = Array.from(new Set(requests.map((r) => String(r.businessId))));
  const customerIds = Array.from(new Set(requests.map((r) => String(r.customerId))));
  const res = await stopCustomers(customerIds);
  return { ...res, businessIds };
}

/** Opt out these customers and stop their open review requests (idempotent). */
export async function stopCustomers(customerIds: string[]): Promise<{ customers: number; requests: number }> {
  if (!customerIds.length) return { customers: 0, requests: 0 };
  const customers = await Customer.updateMany({ _id: { $in: customerIds } }, { $set: { optedOut: true } });
  const pending = await ReviewRequest.updateMany(
    { customerId: { $in: customerIds }, status: 'Pending' },
    { $set: { status: 'Cancelled', automationStatus: 'Stopped' } }
  );
  const open = await ReviewRequest.updateMany(
    { customerId: { $in: customerIds }, status: { $nin: ['Pending', 'Failed', 'Cancelled'] }, automationStatus: 'Active' },
    { $set: { automationStatus: 'Stopped' } }
  );
  return { customers: customers.modifiedCount ?? 0, requests: (pending.modifiedCount ?? 0) + (open.modifiedCount ?? 0) };
}
