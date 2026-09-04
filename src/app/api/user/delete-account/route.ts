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

  // Soft delete all of the user's businesses. Match on `userId` (the source of
  // truth for ownership) rather than only `businessIds`, which historically was
  // not always populated — otherwise a deleted user could leave live workspaces
  // behind.
  await Business.updateMany(
    { userId: user._id },
    { $set: { isDeleted: true } }
  );
  if (user.businessIds?.length) {
    await Business.updateMany(
      { _id: { $in: user.businessIds } },
      { $set: { isDeleted: true } }
    );
  }

  // Soft delete user. Both `email` AND `phone` carry a UNIQUE index, so BOTH
  // must be released for the same person to sign up again — previously only the
  // email was mangled, so re-registration died on the phone unique index with
  // "some of these details already exist". The `deleted_<ts>_` prefix keeps the
  // original value recoverable while freeing the indexes.
  const stamp = Date.now();
  const deletedSet: Record<string, unknown> = {
    isDeleted: true,
    deletedAt: new Date(),
    email: `deleted_${stamp}_${user.email}`,
  };
  if (user.phone) {
    deletedSet.phone = `deleted_${stamp}_${user.phone}`;
  }
  // updateOne (not user.save()) so a drifted legacy field can't block an
  // account deletion — see /api/auth/reset-password.
  await User.updateOne({ _id: user._id }, { $set: deletedSet });

  await destroySession();

  return NextResponse.json({ deleted: true });
}
