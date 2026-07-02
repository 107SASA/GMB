import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';

const DEFAULTS = {
  newLeadWhatsApp: true,
  newLeadEmail: true,
  newReviewEmail: true,
  criticalReviewWhatsApp: true,
  weeklyDigestEmail: true,
  campaignCompletedEmail: true,
  schedulerLowBufferEmail: true,
};

export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();
  const user = await User.findById(auth.userId, 'notificationPreferences').lean() as any;
  const prefs = user?.notificationPreferences ?? {};

  return NextResponse.json({ preferences: { ...DEFAULTS, ...prefs } });
}

export async function PATCH(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const body = await req.json();
  const { preferences } = body;

  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return NextResponse.json({ error: 'Invalid preferences payload.' }, { status: 400 });
  }

  for (const [key, val] of Object.entries(preferences)) {
    if (typeof val !== 'boolean') {
      return NextResponse.json({ error: `Field "${key}" must be a boolean.` }, { status: 400 });
    }
  }

  const user = await User.findByIdAndUpdate(
    auth.userId,
    { $set: { notificationPreferences: { ...DEFAULTS, ...preferences } } },
    { new: true, select: 'notificationPreferences' }
  ).lean() as any;

  return NextResponse.json({ preferences: user?.notificationPreferences ?? DEFAULTS });
}
