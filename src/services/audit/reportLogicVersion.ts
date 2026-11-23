/**
 * Version of the logic that turns Google / website data into a report's
 * rankings and competitors. Bump it whenever that logic changes (history in
 * auditService.ts above CACHE_LOGIC_VERSION).
 *
 * Used twice:
 *  - the per-listing rank / competitor cache (PlaceInsightCache) is reused
 *    only when it was built by this version;
 *  - a finished free report is reused for 30 days only when it was made by
 *    this version (services/leads/freeReport.ts) — otherwise a customer who
 *    asks again would get the old, wrong report back.
 *
 * Kept in its own file so the lead flow can read it without loading the
 * whole audit engine.
 */
export const REPORT_LOGIC_VERSION = 20;
