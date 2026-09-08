/**
 * QA-testing-only bypass for the onboarding security gates (phone-reuse
 * block + rate limits) — added so repeated manual testing with the same
 * phone number / IP doesn't get blocked by protections that are meant for
 * real, unauthenticated traffic.
 *
 * DOUBLE-GATED (Sep 2026 hardening — SEC-3): a single env var must never be
 * able to disable production security controls. This is only ever active when
 * BOTH:
 *   1. NODE_ENV !== 'production'  (a real production build can never opt in), and
 *   2. QA_TESTING_MODE === 'true'
 * So a production deployment that accidentally carries `QA_TESTING_MODE=true`
 * (e.g. a copy-pasted .env.local) still enforces every rate limit, signup
 * protection and dev-route lockout. The dev/QA routes that key off this
 * (`/api/dev/*`) therefore also stay 404 in production regardless.
 */
export function isQaTestingMode(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.QA_TESTING_MODE === 'true';
}
