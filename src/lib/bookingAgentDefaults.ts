/**
 * Defaults + helpers for the WhatsApp BOOKING AGENT (platform → prospect demo
 * bookings). This is a GrowwMatics-owned, owner-only facility: prospects who
 * tap "Book a Demo" on the website land in a WhatsApp chat with this agent,
 * which qualifies them, books a demo, confirms it, and files a CRM lead.
 *
 * Client-safe (no server deps) so the super-admin UI and the server both import
 * from here. The agent's PERSONA (agentSystemPrompt) and confirmation copy are
 * super-admin editable; the JSON/booking machinery lives server-side in
 * services/booking/bookingAgent.ts so editing the persona can never break it.
 */

/** Brand the agent always represents. */
export const BOOKING_BRAND_NAME = 'GrowwMatics AI';

/** Variables available in the confirmation-message template. */
export const BOOKING_TEMPLATE_VARS = [
  '{{name}}',      // prospect first name
  '{{business}}',  // their business name
  '{{date}}',      // agreed demo date
  '{{time}}',      // agreed demo time
] as const;

export interface BookingAgentConfigShape {
  enabled: boolean;
  /** Persona / tone for the conversational agent (appended to the fixed JSON contract). */
  agentSystemPrompt: string;
  /** Sent once the booking is confirmed. Supports the template vars above. */
  confirmationMessage: string;
}

export const DEFAULT_BOOKING_AGENT_PROMPT =
`You are the friendly WhatsApp booking assistant for ${BOOKING_BRAND_NAME}, which helps local businesses grow on Google. A prospect has just messaged to book a free demo.

Your job: warmly qualify them and book the demo. Collect, one question at a time:
1. Their name
2. Their business name (and what it does, briefly)
3. City / location
4. A preferred day and time for the demo

Style:
- Warm, concise, human — like a helpful person, not a form. One question per message.
- WhatsApp formatting: *bold* with single asterisks, a few tasteful emojis.
- Never invent details the prospect didn't give. If they're vague on timing, offer a couple of options.
- Once you have their name, business, and a specific preferred day + time, confirm the booking clearly, restating the day and time.`;

export const DEFAULT_BOOKING_CONFIRMATION =
`Perfect, {{name}}! ✅ Your ${BOOKING_BRAND_NAME} demo for *{{business}}* is booked for *{{date}} at {{time}}*.

Our team will call you on this number at that time to walk you through how we'll grow your Google presence. See you then! 🚀`;

export function defaultBookingAgentConfig(): BookingAgentConfigShape {
  return {
    enabled: false,
    agentSystemPrompt: DEFAULT_BOOKING_AGENT_PROMPT,
    confirmationMessage: DEFAULT_BOOKING_CONFIRMATION,
  };
}

/**
 * Fills {{var}} placeholders. A missing, empty, or unrecognised placeholder
 * is dropped to '' rather than left as literal "{{var}}" text — matching the
 * guarantee the review-campaign template builder (fillTemplate() in
 * services/inngest/functions.ts) gives its callers, that templating syntax
 * never reaches the customer. That builder gets this for free because its
 * four vars are always pre-filled with a real fallback string by its caller;
 * this function's vars are optional by design (super-admin-edited templates
 * can reference any subset), so the same guarantee has to live here instead.
 */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? '' : String(v);
  });
}
