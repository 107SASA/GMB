import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { destroySession } from '@/lib/session';
import { phoneDedupeKey } from '@/lib/phone';

/**
 * Account deletion (Profile → Danger Zone). Immediately: the account is
 * deactivated and every session on every device is signed out, email/phone
 * are released, the paid subscription is cancelled with Razorpay so no
 * further charges happen, and Google access is revoked. The personal data is
 * then permanently erased PURGE_GRACE_DAYS later by accountHardPurgeCron
 * (services/account/hardPurge.ts). What this does is described publicly at
 * /delete-account — keep the two in sync.
 */
export async function POST(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  // Confirmation: the account's email OR its login phone (customers sign in
  // with phone + OTP; free-report accounts only have an internal placeholder
  // email they never see).
  const { email, phone } = await req.json();

  const hasEmail = typeof email === 'string' && email.trim() !== '';
  const hasPhone = typeof phone === 'string' && phone.trim() !== '';
  if (!hasEmail && !hasPhone) {
    return NextResponse.json({ error: 'Confirmation required: type your login phone number or email.' }, { status: 400 });
  }

  const user = await User.findById(auth.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const emailOk = hasEmail && email.toLowerCase().trim() === String(user.email).toLowerCase();
  const typedKey = hasPhone ? phoneDedupeKey(phone) : null;
  const phoneOk = !!typedKey && !!user.phone && typedKey === phoneDedupeKey(user.phone);
  if (!emailOk && !phoneOk) {
    return NextResponse.json({ error: hasPhone ? 'Phone number does not match your account.' : 'Email does not match your account.' }, { status: 400 });
  }

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

  await destroySession();

  return NextResponse.json({ deleted: true });
}
