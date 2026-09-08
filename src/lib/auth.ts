import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { getSession } from '@/lib/session';
import { isSessionEpochValid } from '@/lib/sessionEpoch';

export async function requireClient(): Promise<
  | { ok: true; userId: string; user: any }
  | { ok: false; response: NextResponse }
> {
  try {
    await dbConnect();
    const session = await getSession();

    if (!session) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Unauthorized: Client session required' },
          { status: 401 }
        ),
      };
    }

    const user = await User.findById(session.userId).lean();

    if (!user) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Forbidden: User not found' },
          { status: 403 }
        ),
      };
    }

    // Server-side session invalidation — a token whose embedded epoch no
    // longer matches the user's current one (password reset, logout-all,
    // role change, …) is rejected here regardless of its 30-day JWT expiry.
    if (!isSessionEpochValid(session.sessionEpoch, (user as any).sessionEpoch)) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Session expired. Please sign in again.', code: 'SESSION_INVALIDATED' },
          { status: 401 }
        ),
      };
    }

    return { ok: true, userId: session.userId, user };
  } catch (error: any) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Server error during client auth check' },
        { status: 500 }
      ),
    };
  }
}
