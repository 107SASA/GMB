/**
 * Click-to-chat WhatsApp CTA for the public marketing site.
 *
 * The "Book a Demo" buttons open a WhatsApp conversation with the GrowwMatics
 * sales agent, which qualifies the visitor, books the appointment, and files
 * them as a lead in the CRM. The target number comes from
 * NEXT_PUBLIC_WHATSAPP_NUMBER (digits only, e.g. "919876543210").
 *
 * Demos are handled entirely by the WhatsApp booking agent — there is no web
 * form. If no number is configured yet (the number is still being provisioned)
 * we fall back to /contact so the CTA is never a dead end.
 */

/** Digits-only sales/demo WhatsApp number, from env. Empty string if unset. */
export const SALES_WHATSAPP_NUMBER = (
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || ""
).replace(/[^0-9]/g, "");

const DEFAULT_DEMO_MESSAGE =
  "Hi GrowwMatics! I'd like to book a demo and see how you can grow my Google Business Profile.";

/**
 * Builds the "Book a Demo" link. Returns a wa.me click-to-chat URL when a
 * number is configured, otherwise /contact as a fallback (demos are
 * WhatsApp-only — there is no web form).
 */
export function bookDemoLink(message: string = DEFAULT_DEMO_MESSAGE): string {
  if (!SALES_WHATSAPP_NUMBER) return "/contact";
  return `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** True when the CTA opens WhatsApp (vs. the internal fallback form). */
export const bookDemoOpensWhatsApp = SALES_WHATSAPP_NUMBER.length > 0;
