import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import AdminInvite from '@/models/AdminInvite';
import User from '@/models/User';
import bcrypt from 'bcryptjs';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { validatePasswordStrength } from '@/lib/passwordPolicy';

export async function POST(req: Request) {
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
    if (phone !== undefined && typeof phone !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid phone.' }, { status: 400 });
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
        { success: false, error: 'This invite has already been used' },
        { status: 400 }
      );
    }

    if (new Date() > invite.expiresAt) {
      await AdminInvite.findByIdAndUpdate(invite._id, { status: 'expired' });
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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create the super admin user
    await User.create({
      fullName: name.trim(),
      email: invite.email,
      passwordHash: hashedPassword,
      phone: phone && phone.trim() ? phone.trim() : '+910000000000',
      role: 'SUPER_ADMIN',
      isEmailVerified: true,
    });

    // Mark invite as accepted
    await AdminInvite.findByIdAndUpdate(invite._id, { status: 'accepted' });

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
