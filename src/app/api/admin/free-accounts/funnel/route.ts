import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import Audit from '@/models/Audit';
import User from '@/models/User';
import Business from '@/models/Business';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

const SIGNUP_SOURCES = ['App Sign-up', 'Website Sign-up'];

/**
 * GET /api/admin/free-accounts/funnel?days=30 — free account funnel for the
 * super admin (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md §7):
 * sign-ups (app / website) → free reports → active → asked to unlock /
 * needs a call → became paid. App downloads come from the stores, not here.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const platform = { tenantId: 'gmbboost-internal' };

    const [appSignups, websiteSignups, freeReports, activeThisWeek, askedToUnlock, needsCall, signupLeads] = await Promise.all([
      Lead.countDocuments({ ...platform, source: 'App Sign-up', createdAt: { $gte: since } }),
      Lead.countDocuments({ ...platform, source: 'Website Sign-up', createdAt: { $gte: since } }),
      Audit.countDocuments({ fastMode: true, status: 'COMPLETED', createdAt: { $gte: since } }),
      Lead.countDocuments({ ...platform, 'freeAccount.lastActiveAt': { $gte: week } }),
      Lead.countDocuments({ ...platform, 'freeAccount.unlockRequestedAt': { $gte: since } }),
      Lead.countDocuments({ ...platform, 'freeAccount.callReasons.0': { $exists: true } }),
      Lead.find({ ...platform, source: { $in: SIGNUP_SOURCES }, createdAt: { $gte: since } }).select('phone').lean(),
    ]);

    // Became paid: sign-ups in the window whose account now has a paid / trial workspace.
    const phones = [...new Set(signupLeads.map((l: any) => l.phone).filter(Boolean))];
    const users: any[] = phones.length ? await User.find({ phone: { $in: phones } }).select('_id').lean() : [];
    const becamePaid = users.length
      ? (await Business.distinct('userId', {
          userId: { $in: users.map((u) => u._id) },
          subscriptionStatus: { $in: ['active', 'trial_active'] },
        })).length
      : 0;

    return NextResponse.json({
      success: true,
      days,
      funnel: { appSignups, websiteSignups, freeReports, activeThisWeek, askedToUnlock, needsCall, becamePaid },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
