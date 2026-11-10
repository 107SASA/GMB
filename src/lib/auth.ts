import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { getSession } from '@/lib/session';
import { isSessionEpochValid } from '@/lib/sessionEpoch';
import { headers } from 'next/headers';

const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Records that the owner used the dashboard/app — the "last seen" the super
 * admin's activity view and "Needs a call" list are built on. Throttled to one
 * write per 10 min per user and fire-and-forget, so it never slows a request.
 * SUPER_ADMIN is skipped: an admin's "login as customer" visits land on the
 * admin's own user anyway, never the customer's.
 */
function touchLastSeen(user: any): void {
  try {
    if (!user || user.role === 'SUPER_ADMIN') return;
    const last = user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
    if (Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
    void headers()
      .then((h) => (h.get('x-client') === 'mobile' ? 'mobile' : 'web'))
      .catch(() => 'web' as const)
      .then((client) =>
        User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date(), lastSeenClient: client } })
      )
      .catch(() => {});
  } catch {
    /* never block auth on activity tracking */
  }
}

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

    // A deleted account can never authenticate again (the delete route also
    // bumps sessionEpoch; this is the belt to that brace).
    if ((user as any).isDeleted) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' },
          { status: 401 }
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

    touchLastSeen(user);
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
