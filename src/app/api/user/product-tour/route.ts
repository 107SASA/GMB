import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Marks the dashboard product tour (components/tour/) as done for the
 * current user — called both when they finish the last step and when they
 * click "Skip tour". Either way it should never show again, so both paths
 * hit this same endpoint.
 */
export async function POST() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    await User.updateOne({ _id: auth.userId }, { $set: { productTourCompletedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
