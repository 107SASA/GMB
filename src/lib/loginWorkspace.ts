import Business from '@/models/Business';
import User from '@/models/User';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';

/**
 * Set at web sign-in when the account has 2+ workspaces. While present,
 * src/proxy.ts sends every /dashboard page to /select-workspace, so the user
 * picks which workspace to open; POST /api/business/all (the pick) and logout
 * clear it. The apps don't use it — they show their own picker after login.
 */
export const CHOOSE_WORKSPACE_COOKIE = 'chooseWorkspace';
export const CHOOSE_WORKSPACE_PATH = '/select-workspace';

/** Business fields isBusinessPaid() reads — select these when listing. */
export const PAID_FIELDS = 'subscriptionStatus createdAt trialEndsAt trialCancelledAt paymentGraceEndsAt paymentAccessHold';

/** Paid, in trial, or in payment grace — the Pro/Free badge on the pickers. */
export function isBusinessPaid(business: Record<string, any>, userSubscriptionPlan?: string | null): boolean {
  return isWorkspaceUnlocked({
    subscriptionStatus: business.subscriptionStatus,
    userSubscriptionPlan,
    businessCreatedAt: business.createdAt,
    trialEndsAt: business.trialEndsAt,
    trialCancelledAt: business.trialCancelledAt,
    paymentGraceEndsAt: business.paymentGraceEndsAt,
    paymentAccessHold: business.paymentAccessHold,
  });
}

/**
 * Which workspace is pre-selected right after signing in.
 *
 *   1. The workspace they last used (User.activeBusinessId — saved on every
 *      switch by POST /api/business/all), as long as they still own it and it
 *      isn't deleted.
 *   2. Otherwise their oldest paid (unlocked) workspace.
 *   3. Otherwise their oldest workspace.
 *
 * Whenever the saved pointer was missing or stale, the choice is written back
 * to User.activeBusinessId so the web cookie and the apps (which read it from
 * /api/auth/me as the "Last used" hint) agree. With 2+ workspaces the user is
 * still asked to confirm (see CHOOSE_WORKSPACE_COOKIE).
 */
export async function resolveLoginWorkspace(user: {
  _id: unknown;
  activeBusinessId?: unknown;
}): Promise<{ activeBusinessId: string | null; workspaceCount: number }> {
  const userId = String(user._id);
  const saved = user.activeBusinessId ? String(user.activeBusinessId) : null;

  const businesses = (await Business.find({ userId, isDeleted: { $ne: true } })
    .select(`_id ${PAID_FIELDS}`)
    .sort({ createdAt: 1 })
    .lean()) as any[];
  const workspaceCount = businesses.length;

  if (saved && businesses.some((b) => String(b._id) === saved)) {
    return { activeBusinessId: saved, workspaceCount };
  }
  if (workspaceCount === 0) return { activeBusinessId: null, workspaceCount };

  const owner = (await User.findById(userId).select('subscriptionPlan').lean()) as any;
  const chosen = businesses.find((b) => isBusinessPaid(b, owner?.subscriptionPlan)) ?? businesses[0];

  await User.updateOne({ _id: userId }, { $set: { activeBusinessId: chosen._id } });
  return { activeBusinessId: String(chosen._id), workspaceCount };
}

/** Cookie options shared by every place that sets CHOOSE_WORKSPACE_COOKIE. */
export const CHOOSE_WORKSPACE_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 30,
};
