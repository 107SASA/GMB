import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { destroySession } from '@/lib/session';

export async function POST(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const { email } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email confirmation required.' }, { status: 400 });
  }

  const user = await User.findById(auth.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  if (email.toLowerCase().trim() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Email does not match your account.' }, { status: 400 });
  }

  // Soft delete all user's businesses
  if (user.businessIds?.length) {
    await Business.updateMany(
      { _id: { $in: user.businessIds } },
      { $set: { isDeleted: true } }
    );
  }

  // Soft delete user — free up email index for reuse
  user.isDeleted = true;
  user.deletedAt = new Date();
  user.email = `deleted_${Date.now()}_${user.email}`;
  await user.save();

  await destroySession();

  return NextResponse.json({ deleted: true });
}
