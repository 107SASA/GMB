import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import AdminActionLog from '@/models/AdminActionLog';
import BillingEvent from '@/models/BillingEvent';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getClientIp } from '@/lib/rateLimit';
import { maybeStartContentAutopilot } from '@/lib/contentAutopilot';
import { maybeStartAuditAutopilot } from '@/lib/auditAutopilot';

export const dynamic = 'force-dynamic';

/**
 * Releases a workspace whose payment recovered while the billing policy said
 * "hold for review" (restoreAccessOnRecovery: false). Only a workspace that is
 * PAID ('active') and held can be released — this never grants access to an
 * unpaid one. Audited in AdminActionLog.
 *
 * POST { businessId }
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();

  const body = await req.json().catch(() => null);
  const businessId = body?.businessId;
  if (typeof businessId !== 'string' || !mongoose.isValidObjectId(businessId)) {
    return NextResponse.json({ success: false, error: 'businessId is required.' }, { status: 400 });
  }

  const business = await Business.findOneAndUpdate(
    { _id: businessId, subscriptionStatus: 'active', paymentAccessHold: true },
    { $unset: { paymentAccessHold: '' } },
    { returnDocument: 'after' }
  )
    .select('userId name')
    .lean<{ userId?: unknown; name?: string }>();
  if (!business) {
    return NextResponse.json(
      { success: false, error: 'No paid workspace on hold with that id.' },
      { status: 404 }
    );
  }
  if (business.userId) await Subscription.updateOne({ userId: business.userId }, { $unset: { accessHold: '' } });

  try {
    await AdminActionLog.create({
      adminUserId: auth.userId,
      adminEmail: (auth.user as any)?.email,
      action: 'billing.release_hold',
      targetBusinessId: businessId,
      targetUserId: business.userId as any,
      ip: getClientIp(req),
      metadata: { workspace: business.name ?? null, old: { paymentAccessHold: true }, new: { paymentAccessHold: false } },
    });
  } catch (e: any) {
    console.error('[admin/billing/release-hold] audit log write failed:', e?.message);
  }

  await BillingEvent.create({
    businessId,
    userId: business.userId as any,
    eventType: 'admin.release_hold',
    source: 'admin',
    eventAt: new Date(),
    statusBefore: 'active (held)',
    statusAfter: 'active',
    actions: ['release_hold'],
    note: `released by ${(auth.user as any)?.email ?? auth.userId}`,
  }).catch((e: any) => console.error('[admin/billing/release-hold] billing event write failed:', e?.message));

  await maybeStartContentAutopilot(businessId);
  await maybeStartAuditAutopilot(businessId);
  return NextResponse.json({ success: true });
}
