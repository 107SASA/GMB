import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import Business from '@/models/Business';
import Review from '@/models/Review';
import { encrypt } from '@/lib/crypto';
import { inngest } from '@/services/inngest/client';

export interface FinalizeGbpConnectionInput {
  businessId: string;
  organizationId: string;
  googleAccountId: string;
  googleEmail: string;
  /** Raw (unencrypted) — encrypted internally before being persisted. */
  accessToken: string;
  /** Raw (unencrypted) — encrypted internally before being persisted. */
  refreshToken: string;
  expiresAt: Date;
  locationId: string;
  accountId: string;
  scopes: string[];
}

/**
 * Persists a resolved GBP connection for one workspace: upserts GBPToken,
 * flips Business.googleConnected, and fires the background sync job.
 *
 * Extracted from the OAuth callback (src/app/api/auth/google/callback/route.ts)
 * so the exact same finalize step can also run from the multi-location picker
 * (src/app/api/gbp/select-location/route.ts) once the user has chosen which
 * of several candidate locations this workspace should use — the two entry
 * points differ only in how `locationId` was decided (auto vs. user choice).
 */
export async function finalizeGbpConnection(input: FinalizeGbpConnectionInput): Promise<void> {
  await dbConnect();

  await GBPToken.findOneAndUpdate(
    { businessId: input.businessId },
    {
      $set: {
        businessId: input.businessId,
        organizationId: input.organizationId,
        googleAccountId: input.googleAccountId,
        googleEmail: input.googleEmail,
        accessToken: encrypt(input.accessToken),
        refreshToken: encrypt(input.refreshToken),
        expiresAt: input.expiresAt,
        locationId: input.locationId,
        accountId: input.accountId,
        scopes: input.scopes,
        connectedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  await Business.findByIdAndUpdate(input.businessId, {
    googleConnected: true,
    googleLocationId: input.locationId,
  });

  // Reviews fetched before this connection (SerpApi's public-search scrape,
  // used for businesses that aren't connected yet — see syncReviews.ts) carry
  // synthetic ids that can't receive a real reply, and may even be from a
  // mismatched listing (SerpApi matches by place id/name+city text search,
  // not an authenticated account). Clear them out now that a real, reply-
  // capable connection exists — the sync triggered below repopulates with
  // the account's actual reviews. Matches docs with no `source` at all too
  // (reviews synced before this field existed).
  await Review.deleteMany({ businessId: input.businessId, source: { $ne: 'gbp_api' } });

  try {
    await inngest.send({ name: 'gbp/sync.requested', data: { businessId: input.businessId } });
  } catch (e) {
    // Non-blocking — sync will be retried by the nightly cron if this fails.
    console.error('Failed to trigger GBP auto-sync:', e);
  }
}

/** Mirrors the address formatting used in gbpClient.ts's fetchLocationProfile. */
export function formatLocationAddress(addr: any): string {
  if (!addr) return '';
  return [...(addr.addressLines ?? []), addr.locality, addr.administrativeArea, addr.postalCode]
    .filter(Boolean)
    .join(', ');
}
