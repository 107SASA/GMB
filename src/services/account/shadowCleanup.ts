/**
 * 90-day clean-up of old shadow accounts (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md §8).
 *
 * A "shadow" account was created automatically by the website free report
 * before 12 Nov 2026, when no WhatsApp code was asked — so the number was
 * never proven. One that has done nothing for 90 days is soft-deleted
 * (services/account/softDelete.ts); accountHardPurgeCron erases it after its
 * grace period. The super-admin CRM lead and a note of the report score are kept.
 *
 * Hard safety rails — ALL must hold, re-checked from the database:
 *   - isShadowAccount === true and the phone was NEVER verified
 *   - customer account (role CLIENT) — never staff, partners, super admins
 *   - created ≥ 90 days ago, no login / activity in the last 90 days
 *   - no workspace has EVER paid or trialled (any subscription state beyond
 *     the default, or a Razorpay subscription id)
 *   - no CRM leads in any workspace (real data in use)
 * Mode: SHADOW_CLEANUP_MODE=live acts; anything else is a dry run (counts only).
 */

export const SHADOW_CLEANUP_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

export interface ShadowUserFacts {
  isShadowAccount?: boolean;
  role?: string;
  isDeleted?: boolean;
  phoneVerifiedAt?: Date | string | null;
  isPhoneVerified?: boolean;
  createdAt?: Date | string | null;
  lastLoginAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
}

export interface ShadowWorkspaceFacts {
  subscriptionStatus?: string | null;
  razorpaySubscriptionId?: string | null;
  trialStartedAt?: Date | string | null;
}

const older = (d: Date | string | null | undefined, cutoff: number) => !d || new Date(d).getTime() < cutoff;

/** Pure: may this shadow account be cleaned up? (leads are checked separately) */
export function isStaleShadowAccount(user: ShadowUserFacts, workspaces: ShadowWorkspaceFacts[], now: Date = new Date()): boolean {
  const cutoff = now.getTime() - SHADOW_CLEANUP_DAYS * DAY;
  if (user.isShadowAccount !== true || user.isDeleted === true) return false;
  if ((user.role ?? 'CLIENT') !== 'CLIENT') return false;
  if (user.phoneVerifiedAt || user.isPhoneVerified === true) return false;
  if (!user.createdAt || new Date(user.createdAt).getTime() >= cutoff) return false;
  if (!older(user.lastLoginAt, cutoff) || !older(user.lastSeenAt, cutoff)) return false;
  const everPaid = workspaces.some(
    (w) =>
      !!w.razorpaySubscriptionId ||
      !!w.trialStartedAt ||
      ['active', 'trial_active', 'past_due', 'canceled', 'paused', 'halted'].includes(String(w.subscriptionStatus || '')),
  );
  return !everPaid;
}

export type ShadowCleanupMode = 'dry_run' | 'live';

export function shadowCleanupModeFromEnv(): ShadowCleanupMode {
  return process.env.SHADOW_CLEANUP_MODE === 'live' ? 'live' : 'dry_run';
}

export async function cleanupStaleShadowAccounts(opts: { mode: ShadowCleanupMode; now?: Date; limit?: number }): Promise<{ mode: ShadowCleanupMode; candidates: number; removed: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const [{ default: dbConnect }, { default: User }, { default: Business }, { default: Lead }, { default: Audit }] = await Promise.all([
    import('@/lib/mongodb'),
    import('@/models/User'),
    import('@/models/Business'),
    import('@/models/Lead'),
    import('@/models/Audit'),
  ]);
  await dbConnect();
  const cutoff = new Date(now.getTime() - SHADOW_CLEANUP_DAYS * DAY);
  const users: any[] = await User.find({
    isShadowAccount: true,
    isDeleted: { $ne: true },
    role: 'CLIENT',
    phoneVerifiedAt: { $exists: false },
    createdAt: { $lt: cutoff },
    $and: [
      { $or: [{ lastLoginAt: { $exists: false } }, { lastLoginAt: null }, { lastLoginAt: { $lt: cutoff } }] },
      { $or: [{ lastSeenAt: { $exists: false } }, { lastSeenAt: null }, { lastSeenAt: { $lt: cutoff } }] },
    ],
  })
    .select('_id phone role isShadowAccount isDeleted phoneVerifiedAt isPhoneVerified createdAt lastLoginAt lastSeenAt')
    .limit(opts.limit ?? 200)
    .lean();

  let removed = 0;
  let skipped = 0;
  for (const u of users) {
    try {
      const workspaces: any[] = await Business.find({ userId: u._id }).select('_id name subscriptionStatus razorpaySubscriptionId trialStartedAt').lean();
      if (!isStaleShadowAccount(u, workspaces, now)) {
        skipped++;
        continue;
      }
      const ids = workspaces.map((w) => w._id);
      if (ids.length && (await Lead.exists({ businessId: { $in: ids } }))) {
        skipped++;
        continue;
      }
      if (opts.mode !== 'live') {
        removed++; // would remove
        continue;
      }
      // Keep a note for sales before the account goes.
      const audit: any = ids.length ? await Audit.findOne({ businessId: { $in: ids }, status: 'COMPLETED' }).sort({ createdAt: -1 }).select('overallScore businessName').lean() : null;
      if (u.phone) {
        const note = `Free-report account removed after ${SHADOW_CLEANUP_DAYS} days without activity (never verified)${
          audit ? ` — last report: ${audit.businessName ?? 'business'} scored ${audit.overallScore ?? '?'}/100` : ''
        }.`;
        await Lead.updateOne({ tenantId: 'gmbboost-internal', phone: u.phone }, [
          { $set: { notes: { $concat: [{ $ifNull: ['$notes', ''] }, { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, '\n', ''] }, note] } } },
        ]);
      }
      const { softDeleteAccount } = await import('@/services/account/softDelete');
      await softDeleteAccount(String(u._id));
      removed++;
    } catch (err) {
      skipped++;
      console.warn('[shadow-cleanup] skipped', String(u._id), (err as Error)?.message);
    }
  }
  return { mode: opts.mode, candidates: users.length, removed, skipped };
}
