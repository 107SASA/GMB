import dbConnect from '@/lib/mongodb';
import { getRazorpay } from '@/lib/billing/razorpay';

/**
 * Cancels a deleted account's Razorpay subscription IMMEDIATELY (not at cycle
 * end — the account is gone, so no further charge may happen). "Already
 * cancelled/completed" counts as done. Also marks the local record Canceled
 * so the daily retry stops, independent of the webhook arriving.
 */
export async function cancelRazorpayForDeletedAccount(razorpaySubscriptionId: string): Promise<'cancelled' | 'already_cancelled'> {
  const razorpay = getRazorpay();
  if (!razorpay) throw new Error('Billing is not configured on this server');
  let outcome: 'cancelled' | 'already_cancelled' = 'cancelled';
  try {
    await razorpay.subscriptions.cancel(razorpaySubscriptionId, false);
  } catch (err: any) {
    const msg = String(err?.error?.description || err?.message || '');
    if (!/cancel|completed|expired|not in|status/i.test(msg)) throw err;
    outcome = 'already_cancelled';
  }
  await dbConnect();
  const { default: Subscription } = await import('@/models/Subscription');
  await Subscription.updateMany({ razorpaySubscriptionId }, { $set: { billingStatus: 'Canceled', status: 'cancelled' } });
  return outcome;
}

/** Daily safety net: deleted (not yet purged) accounts whose subscription is still live. */
export async function retryBillingCancelForDeletedAccounts(opts: { mode: 'dry_run' | 'live'; cancel?: (id: string) => Promise<unknown> }): Promise<{ pending: number; cancelled: number; failed: number }> {
  await dbConnect();
  const [{ default: User }, { default: Subscription }] = await Promise.all([import('@/models/User'), import('@/models/Subscription')]);
  const users: any[] = await User.find({ isDeleted: true, purgedAt: { $exists: false }, role: { $ne: 'SUPER_ADMIN' } }).select('_id').lean();
  const subs: any[] = await Subscription.find({
    userId: { $in: users.map((u) => u._id) },
    razorpaySubscriptionId: { $exists: true, $ne: null },
    billingStatus: { $ne: 'Canceled' },
  }).select('razorpaySubscriptionId').lean();
  if (opts.mode !== 'live') return { pending: subs.length, cancelled: 0, failed: 0 };
  const cancel = opts.cancel ?? cancelRazorpayForDeletedAccount;
  let cancelled = 0;
  let failed = 0;
  for (const s of subs) {
    try { await cancel(s.razorpaySubscriptionId); cancelled++; } catch (err: any) { failed++; console.error('[account-purge] billing cancel retry failed:', err?.message); }
  }
  return { pending: subs.length, cancelled, failed };
}
