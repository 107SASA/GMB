import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { securityLogged, emailSubject } from '@/services/security/securityLog';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import GrowthPartner from '@/models/GrowthPartner';
import { createSession, destroySession } from '@/lib/session';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

const INVALID = 'Invalid email or password';

/**
 * Growth Partner sign-in (/partner-login). Only GROWTH_PARTNER accounts can
 * sign in here, and customer logins refuse partner accounts (finalizeLogin),
 * so the two areas never mix. Throttled per IP+email across instances.
 */
async function handlePOST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password are required' }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rate = await checkDurableRateLimit(`partner-auth:${ip}:${email}`, 5, 15 * 60 * 1000);
    if (!rate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again in a few minutes.' },
        { status: 429 }
      );
    }

    await dbConnect();
    const user = await User.findOne({ email, role: 'GROWTH_PARTNER', isDeleted: { $ne: true } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ success: false, error: INVALID }, { status: 401 });
    }

    const partner = await GrowthPartner.findOne({ userId: user._id }).select('status').lean<any>();
    if (!partner) return NextResponse.json({ success: false, error: INVALID }, { status: 401 });
    if (partner.status === 'suspended') {
      return NextResponse.json(
        { success: false, error: 'Your partner account is suspended. Please contact us.' },
        { status: 403 }
      );
    }

    await createSession(user._id.toString(), user.role, (user as any).sessionEpoch ?? 0);
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[partner/auth] login failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await destroySession();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Logout failed' }, { status: 500 });
  }
}

/** Every call is recorded in the security log (Super Admin → Security Log). */
export const POST = securityLogged('partner.login', handlePOST, { subjectOf: emailSubject, role: 'GROWTH_PARTNER' });
