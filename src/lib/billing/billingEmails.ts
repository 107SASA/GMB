import { sendTransactionalEmail } from '@/services/email';

/**
 * Billing-lifecycle transactional emails. Content lives here (next to the
 * entitlement logic that triggers it) rather than in services/email.ts,
 * which only owns the provider transport — same separation as
 * buildOtpEmailHtml vs sendEmailOtp there.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function wrapEmailHtml(heading: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; padding: 24px; max-width: 520px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px;">
      <h2 style="color: #1a1a2e; font-size: 22px; margin-bottom: 8px;">${heading}</h2>
      ${bodyHtml}
      <p style="color: #aaa; font-size: 12px; margin-top: 32px;">GrowwMatics AI</p>
    </div>
  `;
}

interface BillingEmailContext {
  fullName?: string;
  businessName?: string;
}

export async function sendPaymentFailedEmail(to: string, ctx: BillingEmailContext) {
  const name = ctx.fullName || 'there';
  const workspace = ctx.businessName ? `<strong>${ctx.businessName}</strong>'s` : 'your';
  const billingUrl = `${APP_URL}/dashboard/billing`;

  const html = wrapEmailHtml("We couldn't process your payment", `
    <p style="color:#555;font-size:15px;line-height:1.6;">Hi ${name},</p>
    <p style="color:#555;font-size:15px;line-height:1.6;">Your card was declined for ${workspace} GrowwMatics AI subscription. The workspace has been marked past-due — update your payment method to keep everything running.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:#4f6ef7;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Update payment method</a>
    </div>
    <p style="color:#888;font-size:13px;line-height:1.6;">If this was a temporary issue — an expired card, insufficient funds — retrying the same card is often all it takes.</p>
  `);

  return sendTransactionalEmail(to, "Action needed: we couldn't process your payment", html);
}

export async function sendCancellationEmail(to: string, ctx: BillingEmailContext) {
  const name = ctx.fullName || 'there';
  const workspace = ctx.businessName ? `<strong>${ctx.businessName}</strong>'s` : 'Your';
  const billingUrl = `${APP_URL}/dashboard/billing`;

  const html = wrapEmailHtml('Your subscription has been canceled', `
    <p style="color:#555;font-size:15px;line-height:1.6;">Hi ${name},</p>
    <p style="color:#555;font-size:15px;line-height:1.6;">${workspace} GrowwMatics AI subscription is now canceled and paid features are turned off.</p>
    <p style="color:#555;font-size:15px;line-height:1.6;">Changed your mind? Reactivate any time — same plan, no setup, and we'll pick up right where you left off.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:#4f6ef7;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Reactivate my subscription</a>
    </div>
  `);

  return sendTransactionalEmail(to, 'Your GrowwMatics AI subscription has been canceled', html);
}
