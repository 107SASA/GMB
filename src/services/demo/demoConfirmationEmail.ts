/**
 * Pure HTML builder for the demo confirmation email so tests can assert
 * Meet-link inclusion without SendGrid/Resend.
 */
export function buildDemoConfirmationEmailHtml(input: {
  name: string;
  date: string;
  timeSlot: string;
  meetingLink?: string | null;
}): string {
  const linkBlock =
    input.meetingLink && String(input.meetingLink).trim()
      ? `<p style="margin: 16px 0 0;"><b>Meeting link:</b> <a href="${escapeHtml(input.meetingLink)}">${escapeHtml(input.meetingLink)}</a></p>`
      : `<p style="margin: 16px 0 0; color: #64748b;">Our team will contact you shortly to confirm the meeting link.</p>`;

  return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">Demo Confirmed!</h2>
              <p>Hi <b>${escapeHtml(input.name)}</b>,</p>
              <p>Your free demo has been successfully booked!</p>
              <div style="background: #f0f7ff; border-radius: 12px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0;"><b>Date:</b> ${escapeHtml(input.date)}</p>
                <p style="margin: 8px 0 0;"><b>Time:</b> ${escapeHtml(input.timeSlot)}</p>
                ${linkBlock}
              </div>
              <p style="color: #64748b; font-size: 14px;">Team GrowwMatics AI</p>
            </div>
          `;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
