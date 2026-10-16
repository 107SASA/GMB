import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Records that the account's phone number is proven to belong to whoever is
 * using it. Written once: an already-verified phone keeps its original
 * timestamp and method. Callers must only use this after real proof — a
 * correct WhatsApp code, or an inbound WhatsApp message whose Twilio
 * signature was actually checked.
 */
export async function markPhoneVerified(userId: unknown, via: 'whatsapp_otp' | 'whatsapp_inbound'): Promise<void> {
  await dbConnect();
  await User.updateOne(
    { _id: userId, isPhoneVerified: { $ne: true } },
    { $set: { isPhoneVerified: true, phoneVerifiedAt: new Date(), phoneVerifiedVia: via } }
  );
}

/**
 * An inbound message on GrowwMatics' own WhatsApp line, with a verified
 * Twilio signature, proves the sender owns that number. Exact E.164 match
 * only — never a last-10-digits match that could hit another country's number.
 */
export async function markPhoneVerifiedBySender(rawPhone: string): Promise<void> {
  const phone = normalizePhoneE164(rawPhone.replace(/^whatsapp:/i, ''));
  if (!phone) return;
  await dbConnect();
  const user = await User.findOne({ phone, isPhoneVerified: { $ne: true } }).select('_id').lean<{ _id: unknown }>();
  if (user) await markPhoneVerified(user._id, 'whatsapp_inbound');
}
