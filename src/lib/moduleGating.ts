import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription, { type ModuleKey } from '@/models/Subscription';
import User from '@/models/User';
import { userCanUseModule } from '@/lib/billing/entitlements';

/**
 * Server-side module entitlement check — the real enforcer behind the
 * mobile app's presentation-only locks. Returns the guard-style
 * discriminated union used everywhere else.
 *
 * SUPER_ADMIN is always allowed; everyone else follows userCanUseModule()
 * (lib/billing/entitlements.ts — the same rules the mobile app mirrors):
 *  - no Subscription doc (legacy, pre-billing account) → allowed
 *  - the always-free module → allowed
 *  - authorized free trial (trialSource 'offer', not expired) → allowed. A
 *    'Trialing' record WITHOUT trialSource is the old 14-day schema default —
 *    never a real trial — and falls through to the modules map.
 *  - paid again but held for a super-admin release → locked
 *  - payment failure (PastDue): allowed during the grace period frozen at
 *    Day 0; afterwards the frozen restricted modules are locked (all paid
 *    modules when the list is missing)
 *  - otherwise → modules[module].enabled, else 403 { error: "MODULE_LOCKED", module }
 */
export async function requireModule(
  userId: string,
  module: ModuleKey
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  await dbConnect();

  const [user, subscription] = await Promise.all([
    User.findById(userId).select('role').lean() as Promise<any>,
    Subscription.findOne({ userId })
      .select('billingStatus trialStatus trialSource modules paymentGraceEndsAt restrictedModules accessHold')
      .lean() as Promise<any>,
  ]);

  if (user?.role === 'SUPER_ADMIN') return { ok: true };
  if (userCanUseModule(subscription, module)) return { ok: true };

  return {
    ok: false,
    response: NextResponse.json({ error: 'MODULE_LOCKED', module }, { status: 403 }),
  };
}
