import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';

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
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
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

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  return NextResponse.json({ success: true });
}
