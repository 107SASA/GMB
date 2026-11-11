import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { businessHasPlanAccess } from '@/services/billing/planAccess';

/**
 * Per-WORKSPACE paid access for API routes — the server half of the
 * dashboard lock in proxy.ts (each workspace needs its own subscription).
 *
 * Why this exists: API routes only checked the user (requireModule reads the
 * user's single Subscription), and ~70 workspace routes checked nothing at
 * all. So an unpaid workspace — a free signup, or a second workspace of a
 * customer who paid for one — could use paid features by calling the API
 * directly (the page lock is only UI). Same rules as the page lock
 * (isWorkspaceUnlocked: active / trial / grace / legacy plan, owner super
 * admin), plus a super admin caller (support, "Login as customer").
 *
 * Responds with the same 403 { error: 'MODULE_LOCKED' } shape the web and
 * mobile clients already handle (mobile re-checks entitlements on it).
 */
export async function requireWorkspacePlan(
  userId: string,
  businessId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  await dbConnect();
  const caller = await User.findById(userId).select('role').lean<{ role?: string }>();
  if (caller?.role === 'SUPER_ADMIN') return { ok: true };
  if (await businessHasPlanAccess(businessId)) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      { error: 'MODULE_LOCKED', code: 'WORKSPACE_LOCKED', message: 'This workspace needs an active plan to use this feature.' },
      { status: 403 }
    ),
  };
}
