import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import Business from '@/models/Business';
import Lead from '@/models/Lead';
import { setLeadOwnership } from '@/services/leadOwnership/setLeadOwnership';
import { cancelScheduledActions } from '@/services/scheduler/cancelScheduledActions';
import { logLeadEvent } from '@/services/leadEvents';
import { sendTemplateMessage } from '@/services/twilio/client';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Runs AFTER activatePlan()/activateBusinessPlan() have already succeeded
 * (called from the Razorpay webhook route, subscription.activated/charged
 * branch — see that file). Never runs BEFORE or INSTEAD of them; this is
 * purely additive on top of the existing in-app entitlement flip, which
 * this function never touches.
 *
 * Every step is individually idempotent so a webhook retry (Razorpay-style
 * redelivery, or this function being re-invoked after a partial failure
 * for any other reason) only re-attempts whatever hasn't actually
 * succeeded yet — never a duplicate WhatsApp send, never a duplicate
 * ownership transition:
 *   1. lead.currentStage === 'CUSTOMER' already → stop entirely (belt-and-
 *      braces guard on top of ProcessedWebhookEvent's own dedup).
 *   2. Ownership/stage transition to IN_HOUSE/CUSTOMER + nurture
 *      cancellation — driven by the SAME currentStage check as (1), so it
 *      only ever runs once.
 *   3. Invoice WhatsApp message — driven by Subscription.invoiceMessageSentAt
 *      being null.
 *   4. Welcome WhatsApp message — driven by Subscription.welcomeMessageSentAt
 *      being null.
 *   5. CUSTOMER_ACTIVATED LeadEvent — logged every time this function
 *      completes without an early return, same as setLeadOwnership's own
 *      "log either way" pattern; harmless to log more than once since it's
 *      an event record, not a guarded state field.
 *
 * No Lead is resolved/created as a side effect (see the file-level decision
 * this mirrors from every earlier phase with the same structural gap) — a
 * payment with no resolvable platform-side Lead by phone simply skips this
 * entire sequence. activatePlan()/activateBusinessPlan() already ran
 * unconditionally before this is even called, so the actual entitlement
 * unlock is never affected by whether a Lead exists.
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

    // Step 1 — belt-and-braces guard on top of ProcessedWebhookEvent's own
    // dedup. A second delivery of the same event never reaches this
    // function at all (the webhook route's dedup claims the event id
    // first) — this guard is for the case ProcessedWebhookEvent doesn't
    // cover: two DIFFERENT events (e.g. a genuine renewal charge) landing
    // for an already-converted lead.
    if (lead.currentStage === 'CUSTOMER') {
      return;
    }

    // Step 2 — ownership/stage transition + nurture cancellation. Only runs
    // while currentStage isn't already CUSTOMER (checked just above), so a
    // retry that reaches this far a second time (e.g. this function itself
    // failed partway through on a prior invocation, before ever reaching
    // the CUSTOMER stage write) safely repeats it — setLeadOwnership and
    // cancelScheduledActions are themselves idempotent no-ops when nothing
    // has actually changed.
    await setLeadOwnership(lead._id, 'IN_HOUSE', 'payment-verified', 'system', 'CUSTOMER');
    await cancelScheduledActions(lead._id, 'converted');

    const subscription = await Subscription.findOne({ userId });
    const firstName = (lead.name || '').trim().split(/\s+/)[0] || 'there';

    // Step 3 — invoice message, guarded by invoiceMessageSentAt.
    // The approved invoice_ready template has a single {{1}} = customer name
    // body variable and no link/button — it tells the customer their invoice
    // is available in their Growwmatics account. The payment amount/id are
    // still recorded on the CUSTOMER_ACTIVATED LeadEvent below for the audit
    // trail, just not shown in the WhatsApp message.
    if (subscription && !subscription.invoiceMessageSentAt) {
      const res = await sendInvoiceMessage(lead.phone, { name: firstName });
      if (res.success) {
        subscription.invoiceMessageSentAt = new Date();
        await subscription.save();
      } else {
        console.warn('[customerActivation] invoice message failed to send:', res.error);
      }
    }

    // Step 4 — welcome message, guarded by welcomeMessageSentAt. The approved
    // welcome_customer template also has a single {{1}} = customer name body
    // variable.
    if (subscription && !subscription.welcomeMessageSentAt) {
      const res = await sendWelcomeMessage(lead.phone, { name: firstName });
      if (res.success) {
        subscription.welcomeMessageSentAt = new Date();
        await subscription.save();
      } else {
        console.warn('[customerActivation] welcome message failed to send:', res.error);
      }
    }

    // Step 5 — always logged once this function reaches here without an
    // early return above; harmless to log more than once (an event record,
    // not a guarded state field like the two *SentAt fields).
    logLeadEvent(
      'CUSTOMER_ACTIVATED',
      { paymentId: payment.paymentId, amount: payment.amount, currency: payment.currency },
      'system',
      { leadId: lead._id, phone: lead.phone }
    );
  } catch (err: any) {
    // Never let a failure here affect the caller — activatePlan()/
    // activateBusinessPlan() already committed before this was even
    // called, and the Razorpay webhook route must still return 200 (same
    // "always ack the provider" reasoning as the WhatsApp webhook).
    console.error('[customerActivation] runCustomerActivationSequence failed:', err?.message);
  }
}

/**
 * Resolves the platform-side Lead (tenantId: 'gmbboost-internal') this
 * paying customer corresponds to, by phone — the same Business→owner
 * phone resolution the sales-nurture-skip check in
 * services/inngest/functions.ts's salesNurtureRequested already uses
 * (Business.userId → User.phone, falling back to Business.phone). There is
 * no direct Subscription→Lead linkage anywhere in this codebase to reuse
 * instead. Read-only — never creates a Lead (see this file's own doc
 * comment for why).
 */
async function resolveLeadForPayment(userId: string, businessId: string | null): Promise<any | null> {
  const user = await User.findById(userId).select('phone').lean() as any;
  let phone: string | null = user?.phone || null;

  if (!phone && businessId) {
    const business = await Business.findById(businessId).select('phone').lean() as any;
    phone = business?.phone || null;
  }
  if (!phone) return null;

  const normalized = normalizePhoneE164(phone) || phone;
  return Lead.findOne({ phone: normalized, tenantId: 'gmbboost-internal' });
}

async function sendInvoiceMessage(
  phone: string,
  vars: { name: string }
): Promise<{ success: boolean; error?: string }> {
  if (!WA_TEMPLATES.invoiceReady) {
    // Template not yet approved/configured — same graceful-degradation
    // pattern as every other WA_TEMPLATES.* consumer in this codebase
    // (see salesNurtureRequested's own fallback comment). Treated as a
    // failure so invoiceMessageSentAt is correctly left unset and a later
    // retry (once the template IS configured) will actually send it.
    console.warn('[customerActivation] TWILIO_TEMPLATE_INVOICE_READY not configured — skipping invoice message');
    return { success: false, error: 'invoiceReady template not configured' };
  }
  // Approved template has one body variable: {{1}} = customer first name.
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
  // Approved template has one body variable: {{1}} = customer first name.
  const res = await sendTemplateMessage(phone, WA_TEMPLATES.welcomeCustomer, {
    '1': vars.name,
  });
  return res;
}
