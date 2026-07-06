import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';

function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    token.length < 200 &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))
  );
}

/** Registers a device's Expo push token against the signed-in user. */
export async function POST(req: Request) {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const { token } = await req.json();
    if (!isExpoPushToken(token)) {
      return NextResponse.json({ error: 'A valid Expo push token is required' }, { status: 400 });
    }

    await dbConnect();
    await User.findByIdAndUpdate(auth.userId, { $addToSet: { pushTokens: token } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** Removes a device's token on logout so a signed-out device stops getting pushes. */
export async function DELETE(req: Request) {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const { token } = await req.json();
    if (!isExpoPushToken(token)) {
      return NextResponse.json({ error: 'A valid Expo push token is required' }, { status: 400 });
    }

    await dbConnect();
    await User.findByIdAndUpdate(auth.userId, { $pull: { pushTokens: token } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
