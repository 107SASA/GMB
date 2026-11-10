/**
 * The ONE rule for "may Google-dependent background work run for this
 * business?" — first report, SEO plan, AI posts and images, publishing,
 * digests, weekly monitoring and task reminders all ask here.
 *
 * Signed in (googleConnected) is not enough: Google must have confirmed
 * access on a sync (Business.googleAccess.state === 'verified'). See
 * services/gbp/access/evaluate.ts for the states.
 *
 * Kill switch: GOOGLE_ACCESS_GATE_ENABLED=false restores the old
 * "googleConnected only" behaviour (states are still recorded and shown).
 */
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { googleAccessAllows, NOT_READY_STATES } from '@/services/gbp/access/evaluate';

export function googleAccessGateEnabled(): boolean {
  return process.env.GOOGLE_ACCESS_GATE_ENABLED !== 'false';
}

/** Fields `hasGoogleAccess` needs on a lean Business. */
export const GOOGLE_ACCESS_FIELDS = 'googleConnected googleAccess';

export function hasGoogleAccess(business: { googleConnected?: boolean | null; googleAccess?: { state?: string | null } | null } | null | undefined): boolean {
  return googleAccessAllows(business, googleAccessGateEnabled());
}

/** Mongo filter matching businesses `hasGoogleAccess` allows. Spread into a Business.find query. */
export function googleAccessReadyFilter(): Record<string, unknown> {
  return googleAccessGateEnabled()
    ? { googleConnected: true, 'googleAccess.state': { $nin: NOT_READY_STATES } }
    : { googleConnected: true };
}

/** Business ids (as strings) among `ids` whose Google access allows background work. */
export async function businessesWithGoogleAccess(ids: Array<string | { toString(): string }>): Promise<Set<string>> {
  const wanted = [...new Set(ids.map(String))].filter(Boolean);
  if (!wanted.length) return new Set();
  await dbConnect();
  const rows: any[] = await Business.find({ _id: { $in: wanted } }).select(GOOGLE_ACCESS_FIELDS).lean();
  return new Set(rows.filter((b) => hasGoogleAccess(b)).map((b) => String(b._id)));
}

export async function businessHasGoogleAccess(businessId: string): Promise<boolean> {
  return (await businessesWithGoogleAccess([businessId])).has(String(businessId));
}
