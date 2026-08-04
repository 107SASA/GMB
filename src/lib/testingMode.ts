/**
 * QA-testing-only bypass for the onboarding security gates (phone-reuse
 * block + rate limits) — added so repeated manual testing with the same
 * phone number / IP doesn't get blocked by protections that are meant for
 * real, unauthenticated traffic.
 *
 * Gated behind an explicit env var that must be ABSENT (or 'false') in
 * production — .env.production / .env.production.example deliberately do
 * not set it. Before going live, set QA_TESTING_MODE=false (or remove the
 * line) in whatever env the deploy actually reads.
 */
export function isQaTestingMode(): boolean {
  return process.env.QA_TESTING_MODE === 'true';
}
