/**
 * Twilio Content Template SIDs for GrowwMatics' own WhatsApp sender
 * (+919405070323, Twilio Content Template Builder — approved 2026-08-05).
 * Only valid to send FROM that number (see resolveTwilioCredentials in
 * src/services/twilio/client.ts) — a business's own Twilio number cannot
 * use these SIDs.
 *
 * Each constant's variable numbers below must match the approved template
 * exactly (Twilio rejects a contentVariables payload that doesn't match):
 *
 *  - salesIntro:     {{1}} lead name, {{2}} business name.
 *                     Quick-reply button "YES" — no URL variable.
 *  - reportReady:    {{1}} lead name, {{2}} business name,
 *                     {{3}} auditId (button URL: /free-report/result?auditId={{3}}).
 *  - reviewRequest:  {{1}} customer name, {{2}} business name,
 *                     {{3}} Google Place ID (button URL: google.com/local/writereview?placeid={{3}}).
 *  - notification:   {{1}} recipient name, {{2}} free-text body.
 *                     Generic fallback for any business-initiated message
 *                     that doesn't have its own approved template.
 */
export const WA_TEMPLATES = {
  salesIntro: process.env.TWILIO_TEMPLATE_SALES_INTRO || '',
  reportReady: process.env.TWILIO_TEMPLATE_REPORT_READY || '',
  reviewRequest: process.env.TWILIO_TEMPLATE_REVIEW_REQUEST || '',
  notification: process.env.TWILIO_TEMPLATE_NOTIFICATION || '',
} as const;
