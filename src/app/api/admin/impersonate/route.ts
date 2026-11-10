import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getClientIp } from '@/lib/rateLimit';
import AdminActionLog from '@/models/AdminActionLog';
import Business from '@/models/Business';
import {
  VIEW_AS_COOKIE,
  decodeViewAs,
  encodeViewAs,
  viewAsCookieOptions,
} from '@/lib/adminViewAs';

const ACTIVE_BUSINESS_COOKIE = 'activeBusinessId';

/**
 * POST — "Login as customer": open a customer's dashboard as SUPER_ADMIN.
 * Short-lived (2h), shown with a red banner + Exit in the dashboard, and
 * every change made inside is logged to AdminActionLog by proxy.ts.
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) {
      return authResult.response;
    }

    const body = await req.json().catch(() => ({}));
    const businessId = body?.businessId;

    if (typeof businessId !== 'string' || !mongoose.Types.ObjectId.isValid(businessId)) {
      return NextResponse.json(
        { success: false, error: 'A valid businessId is required' },
        { status: 400 }
      );
    }

    await dbConnect();
    const business = await Business.findOne({ _id: businessId, isDeleted: { $ne: true } })
      .select('_id name userId organizationId')
      .lean() as any;
    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    // SEC-5 — record the impersonation so there is an accountable trail of
    // which admin acted as which workspace and when. Best-effort: never block
    // the operation on the audit write.
    try {
      await AdminActionLog.create({
        adminUserId: authResult.userId,
        adminEmail: (authResult.user as any)?.email,
        action: 'impersonate.start',
        targetBusinessId: business._id,
        targetUserId: business.userId,
        ip: getClientIp(req),
        metadata: { businessName: business.name },
      });
    } catch (e: any) {
      console.error('[admin/impersonate] audit log write failed:', e?.message);
    }
    {
      const { logSecurityEvent } = await import('@/services/security/securityLog');
      await logSecurityEvent(req, {
        type: 'admin.impersonate', outcome: 'success', severity: 'warning', userId: authResult.userId, role: 'SUPER_ADMIN',
        subject: (authResult.user as any)?.email, detail: `Signed in as the owner of ${business.name || business._id}`,
        metadata: { businessId: String(business._id), targetUserId: business.userId ? String(business.userId) : undefined },
      });
    }

    const cookieStore = await cookies();
    // Remember the admin's own workspace so Exit can put it back. If they
    // jump straight from one customer to another, keep the ORIGINAL one.
    const existing = decodeViewAs(cookieStore.get(VIEW_AS_COOKIE)?.value);
    const prevBusinessId = existing
      ? existing.prevBusinessId
      : cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value;

    cookieStore.set(VIEW_AS_COOKIE, encodeViewAs({
      businessId,
      businessName: business.name || 'Customer',
      ownerUserId: business.userId ? String(business.userId) : undefined,
      startedAt: new Date().toISOString(),
      prevBusinessId: prevBusinessId && prevBusinessId !== businessId ? prevBusinessId : undefined,
    }), viewAsCookieOptions);
    // Same 2h lifetime as the marker — the admin's browser must never be left
    // silently pointed at a customer's workspace after the banner is gone.
    cookieStore.set(ACTIVE_BUSINESS_COOKIE, businessId, viewAsCookieOptions);

    return NextResponse.json({ success: true, message: 'Impersonation successful' });
  } catch (error: any) {
    console.error('Impersonation API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to impersonate customer' },
      { status: 500 }
    );
  }
}

/**
 * DELETE — Exit the customer's dashboard and restore the admin's own workspace.
 */
export async function DELETE(req: Request) {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) return authResult.response;

    const cookieStore = await cookies();
    const viewAs = decodeViewAs(cookieStore.get(VIEW_AS_COOKIE)?.value);
    cookieStore.delete(VIEW_AS_COOKIE);

    if (viewAs?.prevBusinessId) {
      cookieStore.set(ACTIVE_BUSINESS_COOKIE, viewAs.prevBusinessId, {
        ...viewAsCookieOptions,
        maxAge: 60 * 60 * 24 * 30,
      });
    } else {
      cookieStore.delete(ACTIVE_BUSINESS_COOKIE);
    }

    if (viewAs) {
      try {
        await dbConnect();
        await AdminActionLog.create({
          adminUserId: authResult.userId,
          adminEmail: (authResult.user as any)?.email,
          action: 'impersonate.stop',
          targetBusinessId: mongoose.Types.ObjectId.isValid(viewAs.businessId) ? viewAs.businessId : undefined,
          targetUserId: viewAs.ownerUserId && mongoose.Types.ObjectId.isValid(viewAs.ownerUserId) ? viewAs.ownerUserId : undefined,
          ip: getClientIp(req),
          metadata: {
            businessName: viewAs.businessName,
            minutes: Math.round((Date.now() - Date.parse(viewAs.startedAt)) / 60000),
          },
        });
      } catch (e: any) {
        console.error('[admin/impersonate] exit log write failed:', e?.message);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Impersonation exit error:', error);
    return NextResponse.json({ success: false, error: 'Failed to exit' }, { status: 500 });
  }
}
