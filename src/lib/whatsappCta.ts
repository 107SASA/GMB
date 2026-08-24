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
 * Prefilled text for the "boost my profile" CTA (the WhatsApp-first free
 * report flow — see the report agent / D3). Exported as a constant, not just
 * a default param, because the webhook's first-touch routing keyword-matches
 * on this exact string to tell a fresh "report" thread apart from a fresh
 * "demo" thread (see processPlatformInbound in api/whatsapp/webhook/route.ts).
 */
export const BOOST_PROFILE_MESSAGE =
  "Hi, help me boost my Google Business Profile";

/**
 * Builds the "Book a Demo" link. Returns a wa.me click-to-chat URL when a
 * number is configured, otherwise /contact as a fallback (demos are
 * WhatsApp-only — there is no web form).
 */
export function bookDemoLink(message: string = DEFAULT_DEMO_MESSAGE): string {
  if (!SALES_WHATSAPP_NUMBER) return "/contact";
  return `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/**
 * Builds the "get my free report" link — same platform WhatsApp number as
 * Book a Demo, distinct prefilled text so first-touch routing can tell the
 * two apart. Falls back to /free-report (the form-first flow) so the CTA is
 * never a dead end if the number isn't configured yet.
 */
export function boostProfileLink(message: string = BOOST_PROFILE_MESSAGE): string {
  if (!SALES_WHATSAPP_NUMBER) return "/free-report";
  return `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/**
 * Prefilled text for the "get help" CTA — an existing customer reaching out
 * for product support (mobile app's Help button; a future web equivalent
 * could reuse this too). Exported as a constant for the same reason as
 * BOOST_PROFILE_MESSAGE: the webhook's first-touch routing exact-matches
 * this string to tell a fresh "support" thread apart from "report"/"demo"
 * (see classifyIntent in api/whatsapp/webhook/route.ts).
 */
export const SUPPORT_MESSAGE = "Hi, I need help with my GrowwMatics account";

/**
 * Builds the "get help" link — same platform WhatsApp number, distinct
 * prefilled text so first-touch routing can tell it apart from the other
 * two. Falls back to /contact (no WhatsApp-only assumption here — support
 * should always have *some* reachable fallback) if the number isn't
 * configured yet.
 */
export function getSupportLink(message: string = SUPPORT_MESSAGE): string {
  if (!SALES_WHATSAPP_NUMBER) return "/contact";
  return `https://wa.me/${SALES_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** True when the CTA opens WhatsApp (vs. the internal fallback form/page). */
export const bookDemoOpensWhatsApp = SALES_WHATSAPP_NUMBER.length > 0;
