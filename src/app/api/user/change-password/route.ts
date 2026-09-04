import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';
import { validatePasswordStrength } from '@/services/auth/security';

export async function POST(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const { currentPassword, newPassword, confirmPassword } = await req.json();

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'New passwords do not match.' }, { status: 400 });
  }
  // Same complexity policy enforced by /api/auth/reset-password — this route
  // previously only checked length, so a password without an uppercase/
  // lowercase/number/special character could be set here even though the
  // reset-password flow would have rejected it.
  const strength = validatePasswordStrength(newPassword);
  if (!strength.isValid) {
    return NextResponse.json({ error: strength.error }, { status: 400 });
  }

  const user = await User.findById(auth.userId);
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  let isMatch = false;
  if (user.passwordHash.startsWith('$2b$') || user.passwordHash.startsWith('$2a$')) {
    isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  } else {
    // Legacy plain-text password — constant-time compare (no timing oracle).
    // The new password is bcrypt-hashed below, so plaintext is gone after this.
    const a = Buffer.from(user.passwordHash);
    const b = Buffer.from(String(currentPassword));
    isMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (!isMatch) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  // updateOne (not user.save()) so only passwordHash is written — a drifted
  // legacy field elsewhere on the doc must never turn a valid password change
  // into a 500. Mirrors /api/auth/reset-password.
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash: await bcrypt.hash(newPassword, 12) } }
  );

  return NextResponse.json({ success: true });
}
