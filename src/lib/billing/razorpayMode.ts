/**
 * Razorpay test/live mode — pure (no imports), so tests load it directly.
 *
 * Razorpay ids (plan_…, sub_…) look the same in both modes, and an id from one
 * mode does not exist in the other. The mode is therefore decided from the
 * configured key id and recorded next to every id we persist, so ids created
 * with test keys are never used after switching to live keys (or back).
 */

export type RazorpayMode = 'test' | 'live';

/** rzp_test_… → test, rzp_live_… → live, anything else → null (not a usable key). */
export function razorpayModeFromKeyId(keyId: unknown): RazorpayMode | null {
  const key = typeof keyId === 'string' ? keyId.trim() : '';
  if (key.startsWith('rzp_test_')) return 'test';
  if (key.startsWith('rzp_live_')) return 'live';
  return null;
}

export function isRazorpayMode(value: unknown): value is RazorpayMode {
  return value === 'test' || value === 'live';
}

/**
 * Whether an id saved in `savedMode` may be used under the current keys.
 * No recorded mode = saved before modes were tracked, when only test keys
 * were in use: compatible with test only, never reused under live keys.
 */
export function savedModeUsable(savedMode: unknown, currentMode: RazorpayMode | null): boolean {
  if (!currentMode) return false;
  if (savedMode === undefined || savedMode === null || savedMode === '') return currentMode === 'test';
  return savedMode === currentMode;
}

type ModeRecord = { subscriptionId?: string | null; mode?: unknown } | null | undefined;

/**
 * The mode recorded for `subscriptionId` on a workspace — from any record that
 * names exactly that id (paying subscription, checkout link, open recovery
 * checkout). Null when nothing names it, or records disagree: never inferred.
 */
export function recordedSubscriptionMode(
  ws: { billingSubscriptionEnv?: ModeRecord; razorpaySubscriptionEnv?: ModeRecord; recoveryCheckout?: ModeRecord } | null | undefined,
  subscriptionId: string | null | undefined
): RazorpayMode | null {
  if (!ws || !subscriptionId) return null;
  const modes = new Set<RazorpayMode>();
  for (const record of [ws.billingSubscriptionEnv, ws.razorpaySubscriptionEnv, ws.recoveryCheckout]) {
    if (record?.subscriptionId === subscriptionId && isRazorpayMode(record.mode)) modes.add(record.mode);
  }
  return modes.size === 1 ? [...modes][0] : null;
}

/**
 * The recorded mode of `subscriptionId` across records that each name an id
 * and a mode: 'test' / 'live' when every record naming it agrees, 'ambiguous'
 * when they disagree, null when none names it (never inferred from anything else).
 */
export function subscriptionModeVerdict(records: ModeRecord[], subscriptionId: string | null | undefined): RazorpayMode | 'ambiguous' | null {
  if (!subscriptionId) return null;
  const modes = new Set<RazorpayMode>();
  for (const record of records) {
    if (record?.subscriptionId === subscriptionId && isRazorpayMode(record.mode)) modes.add(record.mode);
  }
  if (modes.size === 0) return null;
  return modes.size === 1 ? [...modes][0] : 'ambiguous';
}

/** A subscription recorded in one mode while the other mode's keys are configured — it can't be managed here. */
export function recordedInOtherMode(recorded: RazorpayMode | null, current: RazorpayMode | null): boolean {
  return !!recorded && !!current && recorded !== current;
}

/** Customer-facing copy for a subscription created under the other Razorpay keys (never a raw provider error). */
export function otherModeSupportMessage(recorded: RazorpayMode): string {
  return recorded === 'test'
    ? 'This subscription was set up in test mode, so it can’t be changed here and no real payment is taken by it. Please contact support to finish setting up your plan.'
    : 'This subscription can’t be changed here right now. Please contact support and we’ll sort it out.';
}

/** A saved Razorpay plan id is reusable only for the price AND the mode it was created for. */
export function isPlanIdUsable(
  saved: { planId?: string | null; planPriceInr?: number | null; planMode?: unknown },
  current: { priceInr: number; mode: RazorpayMode | null }
): boolean {
  return !!saved.planId && saved.planPriceInr === current.priceInr && savedModeUsable(saved.planMode, current.mode);
}
