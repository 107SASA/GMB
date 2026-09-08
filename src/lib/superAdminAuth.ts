import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { getSession } from '@/lib/session';
import { isSessionEpochValid } from '@/lib/sessionEpoch';

export async function requireSuperAdmin(): Promise<
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
          { success: false, error: 'Unauthorized: Super admin session required' },
          { status: 401 }
        ),
      };
    }

    const user = await User.findById(session.userId).lean();

    if (!user || (user as any).role !== 'SUPER_ADMIN') {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Forbidden: Insufficient privileges' },
          { status: 403 }
        ),
      };
    }

    // Server-side session invalidation (see requireClient for the full note).
    // Matters most here: revoking a compromised or demoted admin's sessions.
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
        { success: false, error: 'Server error during auth check' },
        { status: 500 }
      ),
    };
  }
}
