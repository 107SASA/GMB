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

  // WhatsApp notification channel for platform activity (services/ownerNotify.ts).
  whatsAppNotificationsEnabled: true,
  dailyDigestWhatsApp: true,
  demoBookingWhatsApp: true,
  billingWhatsApp: true,
  postPublishedWhatsApp: true,
  reviewReplyWhatsApp: true,
  reportReadyWhatsApp: true,
  weeklyUpdateWhatsApp: true,
  weeklyReportAlwaysWhatsApp: false,
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

  // Merge into what's stored — a client that sends only some keys (the mobile
  // app shows a subset) must not reset the others (e.g. a WhatsApp opt-out
  // made on the web) back to their defaults.
  const current = (await User.findById(auth.userId, 'notificationPreferences').lean() as any)?.notificationPreferences ?? {};
  const user = await User.findByIdAndUpdate(
    auth.userId,
    { $set: { notificationPreferences: { ...DEFAULTS, ...current, ...preferences } } },
    { new: true, select: 'notificationPreferences' }
  ).lean() as any;

  return NextResponse.json({ preferences: user?.notificationPreferences ?? DEFAULTS });
}
