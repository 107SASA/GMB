import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import Business from '@/models/Business';
import Lead from '@/models/Lead';
import Audit from '@/models/Audit';
import { setLeadOwnership } from '@/services/leadOwnership/setLeadOwnership';
import { cancelScheduledActions } from '@/services/scheduler/cancelScheduledActions';
import { logLeadEvent } from '@/services/leadEvents';
import { sendTemplateMessage } from '@/services/twilio/client';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';
import { normalizePhoneE164 } from '@/lib/phone';
import { paymentSuccessStageSequence } from '@/services/billing/paymentLeadStages';

/**
 * Runs AFTER activatePlan()/activateBusinessPlan() have already succeeded
 * (called from the Razorpay webhook route, subscription.activated/charged
 * branch — see that file). Never runs BEFORE or INSTEAD of them; this is
 * purely additive on top of the existing in-app entitlement flip, which
 * this function never touches.
 *
 * Stage order (hard requirement): PAYMENT_VERIFIED, then invoice/welcome,
 * then CUSTOMER / IN_HOUSE. Never mark CUSTOMER before verification.
 *
 * Every step is individually idempotent so a webhook retry only re-attempts
 * whatever hasn't actually succeeded yet.
 */
export interface PaymentReference {
  paymentId?: string;
  amount?: number; // paise, as Razorpay sends it
  currency?: string;
}

export async function runCustomerActivationSequence(
  userId: string,
  businessId: string | null,
  payment: PaymentReference
): Promise<void> {
  try {
    await dbConnect();

    const lead = await resolveLeadForPayment(userId, businessId);
    if (!lead) {
      console.warn('[customerActivation] no platform-side Lead resolved for userId', userId, '— skipping WhatsApp/ownership sequence');
      return;
    }

    if (lead.currentStage === 'CUSTOMER') {
      return;
    }

    const [verifiedStage, customerStage] = paymentSuccessStageSequence();

    // Step 2a — PAYMENT_VERIFIED before any customer-facing messages.
    if (lead.currentStage !== verifiedStage && lead.currentStage !== customerStage) {
      await setLeadOwnership(lead._id, 'SALES', 'payment-verified', 'system', verifiedStage);
      logLeadEvent(
        'PAYMENT_SUCCESS',
        { paymentId: payment.paymentId, amount: payment.amount, currency: payment.currency, stage: verifiedStage },
        'system',
        { leadId: lead._id, phone: lead.phone }
      );
    }

    const subscription = await Subscription.findOne({ userId });
    const firstName = (lead.name || '').trim().split(/\s+/)[0] || 'there';

    // Step 3 — invoice message, guarded by invoiceMessageSentAt.
    if (subscription && !subscription.invoiceMessageSentAt) {
      const res = await sendInvoiceMessage(lead.phone, { name: firstName });
      if (res.success) {
        subscription.invoiceMessageSentAt = new Date();
        await subscription.save();
      } else {
        console.warn('[customerActivation] invoice message failed to send:', res.error);
      }
    }

    // Step 4 — welcome message, guarded by welcomeMessageSentAt.
    if (subscription && !subscription.welcomeMessageSentAt) {
      const res = await sendWelcomeMessage(lead.phone, { name: firstName });
      if (res.success) {
        subscription.welcomeMessageSentAt = new Date();
        await subscription.save();
      } else {
        console.warn('[customerActivation] welcome message failed to send:', res.error);
      }
    }

    // Step 5 — CUSTOMER / IN_HOUSE only after PAYMENT_VERIFIED + helpers above.
    await setLeadOwnership(lead._id, 'IN_HOUSE', 'payment-verified', 'system', customerStage);
    await cancelScheduledActions(lead._id, 'converted');

    logLeadEvent(
      'CUSTOMER_ACTIVATED',
      { paymentId: payment.paymentId, amount: payment.amount, currency: payment.currency },
      'system',
      { leadId: lead._id, phone: lead.phone }
    );
  } catch (err: any) {
    console.error('[customerActivation] runCustomerActivationSequence failed:', err?.message);
  }
}

/**
 * Resolves the platform Lead for a paying customer.
 * Prefer Lead.auditId → Audit.businessId → Business.userId → User.phone chain
 * when it points at the same person as the phone match; otherwise phone match.
 * Never creates a Lead.
 */
export async function resolveLeadForPayment(userId: string, businessId: string | null): Promise<any | null> {
  const user = await User.findById(userId).select('phone').lean() as any;
  let phone: string | null = user?.phone || null;

  if (!phone && businessId) {
    const business = await Business.findById(businessId).select('phone').lean() as any;
    phone = business?.phone || null;
  }
  if (!phone) return null;

  const normalized = normalizePhoneE164(phone) || phone;
  const byPhone = await Lead.findOne({ phone: normalized, tenantId: 'gmbboost-internal' });

  // Stronger link: auditId on a platform lead whose audit belongs to this business.
  if (businessId) {
    const audit = await Audit.findOne({ businessId }).sort({ createdAt: -1 }).select('_id').lean() as any;
    if (audit?._id) {
      const byAudit = await Lead.findOne({ auditId: audit._id, tenantId: 'gmbboost-internal' });
      if (byAudit) {
        // Same person as phone match (or no phone lead) → prefer audit link.
        if (!byPhone || String(byPhone._id) === String(byAudit._id)) {
          return byAudit;
        }
        // Different person → keep phone match; do not guess.
      }
    }
  }

  return byPhone;
}

async function sendInvoiceMessage(
  phone: string,
  vars: { name: string }
): Promise<{ success: boolean; error?: string }> {
  if (!WA_TEMPLATES.invoiceReady) {
    console.warn('[customerActivation] TWILIO_TEMPLATE_INVOICE_READY not configured — skipping invoice message');
    return { success: false, error: 'invoiceReady template not configured' };
  }
  const res = await sendTemplateMessage(phone, WA_TEMPLATES.invoiceReady, {
    '1': vars.name,
  });
  return res;
}

async function sendWelcomeMessage(
  phone: string,
  vars: { name: string }
): Promise<{ success: boolean; error?: string }> {
  if (!WA_TEMPLATES.welcomeCustomer) {
    console.warn('[customerActivation] TWILIO_TEMPLATE_WELCOME_CUSTOMER not configured — skipping welcome message');
    return { success: false, error: 'welcomeCustomer template not configured' };
  }
  const res = await sendTemplateMessage(phone, WA_TEMPLATES.welcomeCustomer, {
    '1': vars.name,
  });
  return res;
}
