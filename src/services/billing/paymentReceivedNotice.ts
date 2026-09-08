import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import Business from '@/models/Business';
import { sendTemplateMessage } from '@/services/twilio/client';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * "Thank you — payment received, log in to the web portal or download our app"
 * WhatsApp message.
 *
 * Runs from the Razorpay webhook (subscription.activated / subscription.charged)
 * right AFTER activatePlan() has flipped entitlements, and BEFORE
 * runCustomerActivationSequence(). Deliberately separate from that sequence:
 *
 *  - It goes to EVERY paying customer. The invoice/welcome messages in
 *    customerActivation.ts only fire when a platform-side Lead (tenantId
 *    'gmbboost-internal') resolves by phone; a self-serve customer who signed
 *    up and paid on the website without ever being a sales lead has no such
 *    Lead, so that whole sequence is skipped for them. This message must not
 *    be.
 *  - It never touches entitlements and swallows all of its own errors, so a
 *    failure here can never affect the webhook's 200 response or the
 *    activation that already committed.
 *
 * Idempotency: Subscription.paymentReceivedMessageSentAt is the single guard.
 * Null → not sent yet. It is stamped only on a real send success, so a webhook
 * retry (or the renewal `subscription.charged` events that follow) re-checks
 * and no-ops instead of resending.
 */
export async function sendPaymentReceivedMessage(
  userId: string,
  businessId: string | null,
): Promise<void> {
  try {
    await dbConnect();

    const subscription = await Subscription.findOne({ userId });
    if (!subscription) {
      console.warn('[paymentReceivedNotice] no Subscription for userId', userId, '— skipping');
      return;
    }
    if (subscription.paymentReceivedMessageSentAt) {
      return; // already sent (first activation, or a prior retry)
    }

    if (!WA_TEMPLATES.paymentReceived) {
      // Template not configured/approved yet — same graceful-degradation
      // pattern as every other WA_TEMPLATES.* consumer. Left unstamped so a
      // later payment event (or a manual replay) sends it once it's set.
      console.warn('[paymentReceivedNotice] TWILIO_TEMPLATE_PAYMENT_RECEIVED not configured — skipping');
      return;
    }

    // Recipient: the account owner's phone, falling back to the workspace's
    // business phone — same resolution order customerActivation.ts uses.
    const user = await User.findById(userId).select('phone fullName').lean() as
      | { phone?: string; fullName?: string }
      | null;
    let phone: string | null = user?.phone || null;
    if (!phone && businessId) {
      const business = await Business.findById(businessId).select('phone').lean() as { phone?: string } | null;
      phone = business?.phone || null;
    }
    if (!phone) {
      console.warn('[paymentReceivedNotice] no phone resolved for userId', userId, '— skipping');
      return;
    }
    const normalized = normalizePhoneE164(phone) || phone;

    const firstName = (user?.fullName || '').trim().split(/\s+/)[0] || 'there';

    // Approved template: {{1}} = customer first name; a static "Download the
    // app" URL button (no variable). The web-portal link lives in the body text.
    const res = await sendTemplateMessage(normalized, WA_TEMPLATES.paymentReceived, {
      '1': firstName,
    });

    if (res.success) {
      subscription.paymentReceivedMessageSentAt = new Date();
      await subscription.save();
    } else {
      console.warn('[paymentReceivedNotice] send failed (will retry on next payment event):', res.error);
    }
  } catch (err: any) {
    // Never let this affect the caller — activatePlan() already committed.
    console.error('[paymentReceivedNotice] sendPaymentReceivedMessage failed:', err?.message);
  }
}
