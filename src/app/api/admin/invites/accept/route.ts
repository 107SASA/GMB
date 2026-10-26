import { NextResponse } from 'next/server';
import { securityLogged } from '@/services/security/securityLog';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import AdminInvite from '@/models/AdminInvite';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { validatePasswordStrength } from '@/lib/passwordPolicy';
import { normalizePhoneE164 } from '@/lib/phone';

async function handlePOST(req: Request) {
  try {
    // This endpoint mints a SUPER_ADMIN account — cap attempts per IP so a
    // stolen/leaked link can't be paired with credential-stuffing, and so the
    // route can't be probed in a loop. Tokens are 256-bit so brute force is
    // already infeasible; this is defence in depth.
    const ip = getClientIp(req);
    const rl = checkRateLimit(`admin-invite-accept:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    await dbConnect();

    const body = await req.json().catch(() => ({}));
    const { token, name, password, phone } = body ?? {};

    // SEC-1: `token` (and the other credentials) come from an untrusted JSON
    // body — a value like {"$gt":""} would otherwise turn AdminInvite.findOne
    // into "match ANY pending invite". Reject anything that isn't a plain
    // non-empty string BEFORE it reaches the query.
    if (
      typeof token !== 'string' || !token.trim() ||
      typeof name !== 'string' || !name.trim() ||
      typeof password !== 'string' || !password
    ) {
      return NextResponse.json(
        { success: false, error: 'Token, name and password are required' },
        { status: 400 }
      );
    }
    // Every user needs a phone, and it must be unique (User.phone) — a shared
    // placeholder let only the first admin without one be created.
    const normalizedPhone = typeof phone === 'string' ? normalizePhoneE164(phone) : null;
    if (!normalizedPhone) {
      return NextResponse.json({ success: false, error: 'A valid mobile number is required.' }, { status: 400 });
    }

    const strength = validatePasswordStrength(password);
    if (!strength.isValid) {
      return NextResponse.json({ success: false, error: strength.error }, { status: 400 });
    }

    // Look up by the SHA-256 hash of the presented token — the raw token is
    // never stored (see AdminInvite.ts).
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await AdminInvite.findOne({ tokenHash });

    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'Invalid invite link' },
        { status: 400 }
      );
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: invite.status === 'expired' ? 'This invite link has expired' : 'This invite has already been used' },
        { status: 400 }
      );
    }

    if (new Date() > invite.expiresAt) {
      await AdminInvite.updateOne({ _id: invite._id, status: 'pending' }, { status: 'expired' });
      return NextResponse.json(
        { success: false, error: 'This invite link has expired' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: invite.email });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists' },
        { status: 400 }
      );
    }
    if (await User.exists({ phone: normalizedPhone })) {
      return NextResponse.json(
        { success: false, error: 'This mobile number is already used by another account' },
        { status: 400 }
      );
    }

    // Single use: claim the invite atomically before creating the account, so
    // two concurrent submissions of the same link can't both mint an admin.
    const claimed = await AdminInvite.findOneAndUpdate(
      { _id: invite._id, status: 'pending', expiresAt: { $gt: new Date() } },
      { status: 'accepted' },
      { new: true }
    );
    if (!claimed) {
      return NextResponse.json(
        { success: false, error: 'This invite has already been used' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    try {
      await User.create({
        fullName: name.trim(),
        email: invite.email,
        passwordHash: hashedPassword,
        phone: normalizedPhone,
        role: 'SUPER_ADMIN',
        isEmailVerified: true,
      });
    } catch (err) {
      // Account not created — give the invite back so the link still works.
      await AdminInvite.updateOne({ _id: invite._id, status: 'accepted' }, { status: 'pending' });
      throw err;
    }

    return NextResponse.json({
      success: true,
      message: 'Super admin account created successfully',
    });
  } catch (error: any) {
    console.error('Accept Invite Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to accept invite' },
      { status: 500 }
    );
  }
}

/** Every call is recorded in the security log (Super Admin → Security Log). */
export const POST = securityLogged('admin.invite_accept', handlePOST, { role: 'SUPER_ADMIN' });
