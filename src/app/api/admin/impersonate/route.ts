import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { getClientIp } from '@/lib/rateLimit';
import AdminActionLog from '@/models/AdminActionLog';
import Business from '@/models/Business';

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
    const business = await Business.findById(businessId).select('_id name userId organizationId').lean() as any;
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

    const cookieStore = await cookies();
    // Set the activeBusinessId to the impersonated business
    cookieStore.set('activeBusinessId', businessId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    return NextResponse.json({ success: true, message: 'Impersonation successful' });
  } catch (error: any) {
    console.error('Impersonation API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to impersonate customer' },
      { status: 500 }
    );
  }
}
