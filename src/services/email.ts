import nodemailer from 'nodemailer';
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const transporter = process.env.SENDGRID_API_KEY
  ? nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    })
  : null;

// Fires once per server process start — makes misconfiguration visible in the
// logs immediately instead of only surfacing after a user complains an email
// never arrived.
if (!resend && !transporter) {
  console.warn(
    '⚠️  No email provider configured (missing RESEND_API_KEY and SENDGRID_API_KEY). ' +
      'All OTP emails will be mocked — codes will only appear in the server console.'
  );
} else if (resend && !process.env.RESEND_FROM_EMAIL) {
  console.warn(
    '⚠️  RESEND_API_KEY is set but RESEND_FROM_EMAIL is not. Falling back to the Resend ' +
      'sandbox sender (onboarding@resend.dev), which can ONLY deliver to the email address ' +
      'you signed up to Resend with — every other recipient will silently fail to receive ' +
      'the email. Verify a domain in Resend and set RESEND_FROM_EMAIL to fix this for real users.'
  );
}

export const sendEmail = async (to: string, customerName: string, service: string, reviewLink: string, businessName: string, requestId?: string) => {
  if (!transporter) {
    console.warn('Nodemailer transporter not initialized (missing SendGrid key). Mocking Email send.');
    return { success: true, messageId: 'mock_msg_id' };
  }

  try {
    const trackingLink = requestId
      ? `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/reviews/track/${requestId}`
      : reviewLink;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
  .card { background: #fff; border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 32px; }
  h2 { color: #1a1a2e; font-size: 22px; margin-bottom: 8px; }
  p { color: #555; line-height: 1.6; }
  .btn { display: inline-block; background: #4f6ef7; color: #fff; padding: 14px 28px;
         border-radius: 8px; text-decoration: none; font-weight: 700; margin: 20px 0; font-size: 15px; }
  .stars { font-size: 28px; color: #fbbf24; letter-spacing: 4px; margin: 12px 0; }
  .footer { color: #aaa; font-size: 12px; margin-top: 24px; }
</style></head>
<body>
  <div class="card">
    <div class="stars">★★★★★</div>
    <h2>Hi ${customerName}! 👋</h2>
    <p>Thank you for visiting <strong>${businessName}</strong> for your recent <em>${service || 'visit'}</em>. We hope you had a wonderful experience!</p>
    <p>Could you take 30 seconds to share your feedback on Google? It helps us grow and serve you better.</p>
    <a href="${trackingLink}" class="btn">⭐ Leave a Google Review</a>
    <p style="font-size:13px;color:#888;">Or copy this link: <a href="${trackingLink}">${trackingLink}</a></p>
    <div class="footer">
      You received this because you recently visited ${businessName}.<br>
      <a href="#">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;

    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || businessName}" <${process.env.EMAIL_FROM || 'noreply@example.com'}>`,
      to,
      subject: `${customerName}, your review means the world to us ⭐`,
      html,
    });

    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error('❌ Email error:', error.message);
    return { success: false, error: error.message };
  }
};

function buildOtpEmailHtml(otp: string, purpose: 'verify' | 'reset', expiryMinutes: number) {
  const subject = purpose === 'reset' ? 'Reset Your Password' : 'Verify Your Email';
  const intro = purpose === 'reset'
    ? 'We received a request to reset the password for your account. Use the code below to continue:'
    : 'Your one-time password is:';
  const disclaimer = purpose === 'reset'
    ? 'If you did not request a password reset, no action is needed — your password will remain unchanged and it is safe to ignore this email.'
    : 'If you did not request this, please ignore this email.';

  return {
    subject,
    html: `
      <div style="font-family: sans-serif; padding: 20px; max-width: 500px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px;">
        <h2 style="color: #1a1a2e; text-align: center;">${subject}</h2>
        <p style="color: #555; font-size: 16px;">Hello,</p>
        <p style="color: #555; font-size: 16px;">${intro}</p>
        <div style="text-align: center; margin: 30px 0;">
          <h1 style="color: #4f6ef7; letter-spacing: 5px; font-size: 40px; margin: 0;">${otp}</h1>
        </div>
        <p style="color: #888; font-size: 14px; text-align: center;">This code will expire in ${expiryMinutes} minutes.</p>
        <p style="color: #888; font-size: 12px; text-align: center; margin-top: 40px;">${disclaimer}</p>
      </div>
    `,
  };
}

export const sendEmailOtp = async (
  to: string,
  otp: string,
  purpose: 'verify' | 'reset' = 'verify',
  expiryMinutes: number = 15
) => {
  // Logged before any send attempt so the code is recoverable in the server
  // console even if every provider below fails or throws unexpectedly.
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n================================`);
    console.log(`🔑 [DEV MODE] OTP for ${to}: ${otp}`);
    console.log(`================================\n`);
  }

  if (!resend && !transporter) {
    console.warn(`Mocking OTP Email to ${to}: ${otp} (No email provider configured)`);
    return { success: true, messageId: 'mock_otp_id' };
  }

  const { subject, html } = buildOtpEmailHtml(otp, purpose, expiryMinutes);

  // Prefer Resend when configured.
  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'GMB Boost <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      });

      if (!error) {
        return { success: true, messageId: data?.id };
      }

      console.error(
        `Resend API Error sending OTP to ${to}:`,
        error.message,
        '— falling back to SendGrid if configured. ' +
          'Common cause: sending to an address other than your Resend account email ' +
          'without a verified domain set via RESEND_FROM_EMAIL.'
      );
    } catch (error: any) {
      console.error('Resend threw while sending OTP:', error.message);
    }
  }

  // Fall back to SendGrid/nodemailer if Resend is unavailable or just failed.
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'GMB Boost'}" <${process.env.EMAIL_FROM || 'noreply@example.com'}>`,
        to,
        subject,
        html,
      });
      console.log(`✅ OTP email sent to ${to} via SendGrid: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      console.error('SendGrid OTP email error:', error.message);
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'All configured email providers failed to send the OTP.' };
};
