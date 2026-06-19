import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { DEV_CONTEXT } from '@/lib/dev-context';

export async function GET(req: Request) {
  try {
    await dbConnect();
    const userId = DEV_CONTEXT.userId;

    const user = await User.findById(userId).populate('businessIds');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Return the populated businesses
    return NextResponse.json(user.businessIds, { status: 200 });

  } catch (error: any) {
    console.error('Fetch Businesses Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
