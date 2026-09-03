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
 *  - invoiceReady:   {{1}} customer first name — only variable. The approved
 *                     template body just tells the customer their invoice is
 *                     available in their Growwmatics account (no amount, no
 *                     payment ID, no link/button). The payment amount/id are
 *                     still recorded on the CUSTOMER_ACTIVATED LeadEvent for
 *                     the audit trail — see customerActivation.ts.
 *  - welcomeCustomer: {{1}} customer first name — only variable. Welcomes the
 *                     newly-activated customer and mentions the Growwmatics
 *                     Assistant, now that ownership has moved to IN_HOUSE —
 *                     sent once, after the invoice message, on payment
 *                     confirmation.
 */
export const WA_TEMPLATES = {
  salesIntro: process.env.TWILIO_TEMPLATE_SALES_INTRO || '',
  reportReady: process.env.TWILIO_TEMPLATE_REPORT_READY || '',
  reviewRequest: process.env.TWILIO_TEMPLATE_REVIEW_REQUEST || '',
  notification: process.env.TWILIO_TEMPLATE_NOTIFICATION || '',
  invoiceReady: process.env.TWILIO_TEMPLATE_INVOICE_READY || '',
  welcomeCustomer: process.env.TWILIO_TEMPLATE_WELCOME_CUSTOMER || '',
} as const;
