import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';

export async function GET() {
  try {
    await dbConnect();
    const authResult = await requireClient();
    
    if (!authResult.ok) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const cookieStore = await cookies();
    let activeBusinessId = cookieStore.get('activeBusinessId')?.value;

    const businesses = await Business.find({ userId: authResult.userId }).lean();
    
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

    // Verify ownership
    const business = await Business.findOne({ _id: businessId, userId: authResult.userId }).lean();
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
