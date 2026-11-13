import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';

/**
 * Soft-deletes an account — exactly what Profile → Delete account does, shared
 * with the 90-day clean-up of never-verified shadow accounts
 * (services/account/shadowCleanup.ts). Immediately: owned workspaces and the
 * user are marked deleted, every session is signed out, email/phone are
 * released (so the person can sign up again), the paid subscription is
 * cancelled with Razorpay and Google access is revoked. accountHardPurgeCron
 * then erases the personal data PURGE_GRACE_DAYS later.
 */
export async function softDeleteAccount(userId: string): Promise<void> {
  await dbConnect();
  const user: any = await User.findById(userId);
  if (!user || user.isDeleted) return;
  if (user.role === 'SUPER_ADMIN') throw new Error('Refusing to soft-delete a SUPER_ADMIN account');

  const now = new Date();
  // Soft delete the businesses this user OWNS. Match on `userId` (the source
  // of truth for ownership); `businessIds` only for legacy workspaces that
  // predate Business.userId — never a workspace owned by someone else.
  await Business.updateMany({ userId: user._id }, { $set: { isDeleted: true, deletedAt: now } });
  if (user.businessIds?.length) {
    await Business.updateMany(
      { _id: { $in: user.businessIds }, userId: { $exists: false } },
      { $set: { isDeleted: true, deletedAt: now } }
    );
  }
  const ownedIds = (await Business.find({ userId: user._id }).select('_id').lean()).map((b: any) => b._id);

  // Stop billing now — a deleted account must never be charged again.
  // Best-effort: a failure is retried daily by accountHardPurgeCron.
  try {
    const { default: Subscription } = await import('@/models/Subscription');
    const sub: any = await Subscription.findOne({ userId: user._id }).select('razorpaySubscriptionId billingStatus').lean();
    if (sub?.razorpaySubscriptionId && sub.billingStatus !== 'Canceled') {
      const { cancelRazorpayForDeletedAccount } = await import('@/lib/billing/deletionCancel');
      await cancelRazorpayForDeletedAccount(sub.razorpaySubscriptionId);
    }
  } catch (err) {
    console.error('[delete-account] billing cancel failed (will retry):', (err as Error)?.message);
  }

  // Revoke Google access and drop the stored tokens now (not only at purge).
  try {
    const { default: GBPToken } = await import('@/models/GBPToken');
    const tokens: any[] = await GBPToken.find({ businessId: { $in: ownedIds } }).select('refreshToken').lean();
    const { decrypt } = await import('@/lib/crypto');
    for (const t of tokens) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decrypt(t.refreshToken) }).toString(),
      }).catch(() => {});
    }
    await GBPToken.deleteMany({ businessId: { $in: ownedIds } });
    await Business.updateMany({ _id: { $in: ownedIds } }, { $set: { googleConnected: false } });
  } catch (err) {
    console.error('[delete-account] Google revoke failed:', (err as Error)?.message);
  }

  // Soft delete user. Both `email` AND `phone` carry a UNIQUE index, so BOTH
  // must be released for the same person to sign up again. The `deleted_<ts>_`
  // prefix keeps the original value recoverable during the grace period;
  // accountHardPurgeCron erases it for good afterwards. sessionEpoch++ signs
  // the account out everywhere (mobile bearer tokens included).
  const stamp = Date.now();
  const deletedSet: Record<string, unknown> = {
    isDeleted: true,
    deletedAt: now,
    email: `deleted_${stamp}_${user.email}`,
  };
  if (user.phone) {
    deletedSet.phone = `deleted_${stamp}_${user.phone}`;
  }
  // updateOne (not user.save()) so a drifted legacy field can't block an
  // account deletion — see /api/auth/reset-password.
  await User.updateOne({ _id: user._id }, { $set: deletedSet, $inc: { sessionEpoch: 1 }, $unset: { pushTokens: 1 } });

}
