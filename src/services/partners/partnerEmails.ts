import { sendTransactionalEmail } from '@/services/email';
import { escapeHtml } from '@/lib/partners/partnerRules';

/**
 * Growth Partner program emails. Every value the applicant typed is escaped
 * before it goes into HTML. All sends are best-effort (sendTransactionalEmail
 * never throws), so an email outage never fails an approval.
 */

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

function wrap(heading: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; padding: 24px; max-width: 520px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px;">
      <h2 style="color: #101613; font-size: 22px; margin-bottom: 8px;">${heading}</h2>
      ${bodyHtml}
      <p style="color: #aaa; font-size: 12px; margin-top: 32px;">Growwmatics AI · Growth Partner Program</p>
    </div>
  `;
}

const P = 'color:#555;font-size:15px;line-height:1.6;';

function button(href: string, label: string): string {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:#006e2c;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">${label}</a>
  </div>`;
}

export async function sendApplicationReceivedEmail(to: string, name: string) {
  const html = wrap('We received your application', `
    <p style="${P}">Hi ${escapeHtml(name)},</p>
    <p style="${P}">Thank you for applying to become a Growwmatics AI Growth Partner. Our team will review your application and get back to you by email, usually within 2 working days.</p>
  `);
  return sendTransactionalEmail(to, 'Your Growth Partner application is received', html);
}

export async function sendApplicationApprovedEmail(
  to: string,
  name: string,
  inviteLink: string,
  validDays: number
) {
  const html = wrap('You are approved as a Growth Partner', `
    <p style="${P}">Hi ${escapeHtml(name)},</p>
    <p style="${P}">Good news — your Growth Partner application is approved. Create your partner account with this email address (${escapeHtml(to)}) and set your password:</p>
    ${button(inviteLink, 'Create my partner account')}
    <p style="color:#888;font-size:13px;line-height:1.6;">This link works once and expires in ${validDays} days. After you sign in, we'll ask for your company / KYC and bank details for commission payouts.</p>
    <p style="color:#888;font-size:13px;line-height:1.6;">Partner login: <a href="${APP_URL}/partner-login">${APP_URL}/partner-login</a></p>
  `);
  return sendTransactionalEmail(to, 'Approved: create your Growwmatics AI Growth Partner account', html);
}

export async function sendApplicationRejectedEmail(to: string, name: string, reason: string | null) {
  const html = wrap('About your Growth Partner application', `
    <p style="${P}">Hi ${escapeHtml(name)},</p>
    <p style="${P}">Thank you for your interest in the Growwmatics AI Growth Partner Program. After reviewing your application, we are not able to approve it at this time.</p>
    ${reason ? `<p style="${P}"><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''}
    <p style="${P}">You are welcome to apply again later.</p>
  `);
  return sendTransactionalEmail(to, 'Your Growth Partner application', html);
}

/** Alert to the team (ADMIN_EMAIL) that a new application is waiting. */
export async function sendNewApplicationAdminAlert(app: {
  fullName: string;
  companyName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
}) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return { success: false, error: 'ADMIN_EMAIL not set' };
  const html = wrap('New Growth Partner application', `
    <p style="${P}"><strong>${escapeHtml(app.fullName)}</strong> — ${escapeHtml(app.companyName)}</p>
    <p style="${P}">${escapeHtml(app.email)} · ${escapeHtml(app.phone)}<br/>${escapeHtml(app.city)}, ${escapeHtml(app.state)}</p>
    ${button(`${APP_URL}/admin/growth-partners`, 'Review application')}
  `);
  return sendTransactionalEmail(to, `New Growth Partner application: ${app.companyName}`, html);
}

export async function sendKycSubmittedAdminAlert(p: { companyName: string; fullName: string; partnerCode: string }) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return { success: false, error: 'ADMIN_EMAIL not set' };
  const html = wrap('Partner KYC ready for review', `
    <p style="${P}"><strong>${escapeHtml(p.companyName)}</strong> (${escapeHtml(p.fullName)}, ${escapeHtml(p.partnerCode)}) submitted their KYC and bank details.</p>
    ${button(`${APP_URL}/admin/growth-partners`, 'Review KYC')}
  `);
  return sendTransactionalEmail(to, `KYC to review: ${p.companyName}`, html);
}

export async function sendKycVerifiedEmail(to: string, name: string) {
  const html = wrap('Your KYC is verified', `
    <p style="${P}">Hi ${escapeHtml(name)},</p>
    <p style="${P}">Your KYC and bank details are verified. Your commissions can now be paid out to your bank account.</p>
    ${button(`${APP_URL}/partner`, 'Open partner dashboard')}
  `);
  return sendTransactionalEmail(to, 'Your Growth Partner KYC is verified', html);
}

export async function sendKycRejectedEmail(to: string, name: string, reason: string) {
  const html = wrap('Your KYC needs changes', `
    <p style="${P}">Hi ${escapeHtml(name)},</p>
    <p style="${P}">We could not verify your KYC yet. Please update it and submit again.</p>
    <p style="${P}"><strong>What to fix:</strong> ${escapeHtml(reason)}</p>
    ${button(`${APP_URL}/partner/kyc`, 'Update my KYC')}
  `);
  return sendTransactionalEmail(to, 'Action needed: update your Growth Partner KYC', html);
}
