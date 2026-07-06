import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Subscription, { type ModuleKey } from '@/models/Subscription';
import User from '@/models/User';

/**
 * Server-side module entitlement check — the real enforcer behind the
 * mobile app's presentation-only locks. Returns the guard-style
 * discriminated union used everywhere else.
 *
 * Semantics (deliberately backwards-compatible so the existing web
 * dashboard keeps working):
 *  - SUPER_ADMIN                          → allowed
 *  - No Subscription doc (legacy user)    → allowed (entitlements were
 *    never provisioned; blocking would break pre-billing accounts)
 *  - Active trial (Trialing + endsAt in the future) → allowed (the trial
 *    grants the full experience)
 *  - Otherwise                            → modules[module].enabled must be
 *    true, else 403 { error: "MODULE_LOCKED", module }
 */
export async function requireModule(
  userId: string,
  module: ModuleKey
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  await dbConnect();

  const locked = () => ({
    ok: false as const,
    response: NextResponse.json({ error: 'MODULE_LOCKED', module }, { status: 403 }),
  });

  const [user, subscription] = await Promise.all([
    User.findById(userId).select('role').lean() as Promise<any>,
    Subscription.findOne({ userId }).select('billingStatus trialStatus modules').lean() as Promise<any>,
  ]);

  if (user?.role === 'SUPER_ADMIN') return { ok: true };
  if (!subscription) return { ok: true };

  const trialActive =
    subscription.billingStatus === 'Trialing' &&
    subscription.trialStatus?.isActive &&
    (!subscription.trialStatus.endsAt || new Date(subscription.trialStatus.endsAt) > new Date());
  if (trialActive) return { ok: true };

  if (subscription.modules?.[module]?.enabled) return { ok: true };

  return locked();
}
