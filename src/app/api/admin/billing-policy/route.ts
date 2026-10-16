import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import BillingPolicy from '@/models/BillingPolicy';
import Business from '@/models/Business';
import TrialClaim from '@/models/TrialClaim';
import AdminActionLog from '@/models/AdminActionLog';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getClientIp } from '@/lib/rateLimit';
import {
  parseTrialPolicy,
  parseFailurePolicy,
  validateTrialPolicyUpdate,
  validateFailurePolicyUpdate,
  parseReminderPolicy,
  validateReminderPolicyUpdate,
  ALWAYS_ACCESSIBLE,
  PAID_MODULE_KEYS,
} from '@/lib/billing/billingPolicy';

export const dynamic = 'force-dynamic';

/**
 * Super-admin billing policy: the free-trial offer and the failed-payment
 * policy. Changes affect NEW checkouts / NEW payment failures only — each
 * checkout and each failure keeps the snapshot frozen when it was created, and
 * no paid-through date or trial end date is ever touched from here. Every
 * change is written to AdminActionLog with the old and new values.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();

  const doc = await BillingPolicy.findOne({ key: 'default' }).lean<any>();
  const [activeTrials, trialsUsed, needsReview, inGrace, restricted, held] = await Promise.all([
    Business.countDocuments({ subscriptionStatus: 'trial_active' }),
    TrialClaim.countDocuments({ status: 'consumed' }),
    TrialClaim.countDocuments({ status: 'reserved', needsReview: true }),
    Business.countDocuments({ subscriptionStatus: 'past_due', paymentGraceEndsAt: { $gt: new Date() } }),
    Business.countDocuments({ subscriptionStatus: 'past_due', $or: [{ paymentGraceEndsAt: { $lte: new Date() } }, { paymentGraceEndsAt: { $exists: false } }] }),
    Business.countDocuments({ paymentAccessHold: true }),
  ]);
  return NextResponse.json({
    success: true,
    policy: parseTrialPolicy(doc),
    failure: parseFailurePolicy(doc),
    reminders: parseReminderPolicy(doc),
    // Fixed: always reachable during a payment failure (not configurable).
    alwaysAccessible: ALWAYS_ACCESSIBLE,
    restrictableModules: PAID_MODULE_KEYS,
    version: Number.isInteger(doc?.version) ? doc.version : 0,
    updatedBy: doc?.updatedBy ?? null,
    updatedAt: doc?.updatedAt ?? null,
    stats: { activeTrials, trialsUsed, claimsNeedingReview: needsReview, paymentFailuresInGrace: inGrace, paymentFailuresRestricted: restricted, recoveriesOnHold: held },
  });
}

export async function PUT(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();

  const body = await req.json().catch(() => null);
  if (!body || (body.trial === undefined && body.failure === undefined && body.reminders === undefined)) {
    return NextResponse.json({ success: false, error: 'Send { trial }, { failure } and/or { reminders }.' }, { status: 400 });
  }
  const $set: Record<string, unknown> = {};
  if (body.trial !== undefined) {
    const check = validateTrialPolicyUpdate(body.trial);
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: 400 });
    Object.assign($set, {
      'trial.offerEnabled': check.value.offerEnabled,
      'trial.trialMonths': check.value.trialMonths,
      'trial.eligibleCycle': 'yearly',
    });
  }
  if (body.failure !== undefined) {
    const check = validateFailurePolicyUpdate(body.failure);
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: 400 });
    $set.failure = check.value;
  }
  if (body.reminders !== undefined) {
    const check = validateReminderPolicyUpdate(body.reminders);
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: 400 });
    $set.reminders = check.value;
  }

  const beforeDoc = await BillingPolicy.findOne({ key: 'default' }).lean();
  const adminEmail = (auth.user as any)?.email ?? '';
  const saved = await BillingPolicy.findOneAndUpdate(
    { key: 'default' },
    { $set: { ...$set, updatedBy: adminEmail }, $inc: { version: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean<any>();

  const view = (d: any) => {
    const t = parseTrialPolicy(d);
    return {
      trial: { offerEnabled: t.offerEnabled, trialMonths: t.trialMonths },
      failure: parseFailurePolicy(d),
      reminders: parseReminderPolicy(d),
      version: Number.isInteger(d?.version) ? d.version : 0,
    };
  };
  try {
    await AdminActionLog.create({
      adminUserId: auth.userId,
      adminEmail,
      action: 'billing_policy.update',
      ip: getClientIp(req),
      metadata: { old: view(beforeDoc), new: view(saved) },
    });
  } catch (e: any) {
    console.error('[admin/billing-policy] audit log write failed:', e?.message);
  }

  return NextResponse.json({ success: true, policy: parseTrialPolicy(saved), failure: parseFailurePolicy(saved), reminders: parseReminderPolicy(saved) });
}
