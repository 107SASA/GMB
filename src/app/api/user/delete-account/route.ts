import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';
import { destroySession } from '@/lib/session';
import { phoneDedupeKey } from '@/lib/phone';

/**
 * Account deletion (Profile → Danger Zone). Immediately: the account is
 * deactivated and every session on every device is signed out, email/phone
 * are released, the paid subscription is cancelled with Razorpay so no
 * further charges happen, and Google access is revoked. The personal data is
 * then permanently erased PURGE_GRACE_DAYS later by accountHardPurgeCron
 * (services/account/hardPurge.ts). What this does is described publicly at
 * /delete-account — keep the two in sync.
 */
export async function POST(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  // Confirmation: the account's email OR its login phone (customers sign in
  // with phone + OTP; free-report accounts only have an internal placeholder
  // email they never see).
  const { email, phone } = await req.json();

  const hasEmail = typeof email === 'string' && email.trim() !== '';
  const hasPhone = typeof phone === 'string' && phone.trim() !== '';
  if (!hasEmail && !hasPhone) {
    return NextResponse.json({ error: 'Confirmation required: type your login phone number or email.' }, { status: 400 });
  }

  const user = await User.findById(auth.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const emailOk = hasEmail && email.toLowerCase().trim() === String(user.email).toLowerCase();
  const typedKey = hasPhone ? phoneDedupeKey(phone) : null;
  const phoneOk = !!typedKey && !!user.phone && typedKey === phoneDedupeKey(user.phone);
  if (!emailOk && !phoneOk) {
    return NextResponse.json({ error: hasPhone ? 'Phone number does not match your account.' : 'Email does not match your account.' }, { status: 400 });
  }

  const { softDeleteAccount } = await import('@/services/account/softDelete');
  await softDeleteAccount(String(user._id));

  await destroySession();

  return NextResponse.json({ deleted: true });
}
