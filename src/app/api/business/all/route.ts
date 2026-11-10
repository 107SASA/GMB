import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { VIEW_AS_COOKIE, decodeViewAs } from '@/lib/adminViewAs';

export async function GET(req: Request) {
  try {
    await dbConnect();
    const authResult = await requireClient();

    if (!authResult.ok) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const cookieStore = await cookies();
    let activeBusinessId = cookieStore.get('activeBusinessId')?.value;

    // scope=all is only honored for SUPER_ADMIN — lets the admin-panel WhatsApp
    // Inbox page (src/app/admin/whatsapp-agent/page.tsx) browse every
    // customer's business. Regular customer dashboards never send this param,
    // so the default owner-scoped behavior below is completely unchanged for
    // everyone else.
    const scope = new URL(req.url).searchParams.get('scope');
    const isSuperAdmin = (authResult.user as any).role === 'SUPER_ADMIN';

    // "Login as customer" — the admin's dashboard must show the CUSTOMER's
    // workspace, not the admin's own list (which doesn't contain it, so the
    // switcher used to fall back to the admin's first business while every
    // API call still hit the customer's — two different businesses on one screen).
    const viewAs = isSuperAdmin && scope !== 'all' ? decodeViewAs(cookieStore.get(VIEW_AS_COOKIE)?.value) : null;
    if (viewAs) {
      const viewed = await Business.find({ _id: viewAs.businessId, isDeleted: { $ne: true } }).lean();
      if (viewed.length > 0) {
        return NextResponse.json({ success: true, businesses: viewed, activeBusinessId: viewAs.businessId, viewingAs: true }, { status: 200 });
      }
    }
    const businessFilter = scope === 'all' && isSuperAdmin
      ? { isDeleted: { $ne: true } }
      : { userId: authResult.userId, isDeleted: { $ne: true } };

    const businesses = await Business.find(businessFilter).lean();

    // Fallback logic if there's no active business ID but they have businesses
    if (!activeBusinessId && businesses.length > 0) {
      activeBusinessId = businesses[0]._id.toString();
      // Wait, we should probably set the cookie here if it's missing, but it's a GET request.
    }

    return NextResponse.json({ 
      success: true, 
      businesses, 
      activeBusinessId 
    }, { status: 200 });

  } catch (error: any) {
    console.error('All Businesses API Error:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const authResult = await requireClient();
    
    if (!authResult.ok) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { businessId } = await req.json();
    
    if (!businessId) {
      return NextResponse.json({ success: false, error: 'businessId required' }, { status: 400 });
    }

    // Verify ownership — SUPER_ADMIN may switch to any business (needed for
    // the admin-panel WhatsApp Inbox page to view a customer's conversations).
    const isSuperAdmin = (authResult.user as any).role === 'SUPER_ADMIN';
    const business = await Business.findOne(
      isSuperAdmin ? { _id: businessId, isDeleted: { $ne: true } } : { _id: businessId, userId: authResult.userId },
    ).lean();
    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found or access denied' }, { status: 404 });
    }

    const cookieStore = await cookies();
    cookieStore.set('activeBusinessId', businessId, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    return NextResponse.json({ success: true, message: 'Active business switched' }, { status: 200 });
  } catch (error: any) {
    console.error('Switch Business Error:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
