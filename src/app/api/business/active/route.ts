import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';

export async function GET() {
  try {
    await dbConnect();
    
    const cookieStore = await cookies();
    const activeBusinessId = cookieStore.get('activeBusinessId')?.value;
    
    if (!activeBusinessId) {
      return NextResponse.json({ success: false, error: 'No active business session' }, { status: 401 });
    }

    const business = await Business.findById(activeBusinessId).lean();
    
    if (!business) {
      return NextResponse.json({ success: false, error: 'Business not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: business }, { status: 200 });
  } catch (error: any) {
    console.error('Active Business API Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch business context' }, { status: 500 });
  }
}
