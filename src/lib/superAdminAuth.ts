import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { DEV_CONTEXT } from '@/lib/dev-context';

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Validates that the current request is from a super_admin.
 *
 * DEV MODE: bypasses cookie check — all admin API routes are accessible
 * without a session, matching the existing dev-mode pattern in the project.
 *
 * PRODUCTION: reads the `superAdminUserId` httpOnly cookie set at login.
 */
export async function requireSuperAdmin(): Promise<
  | { ok: true; userId: string; user: any }
  | { ok: false; response: NextResponse }
> {
  try {
    // Dev bypass FIRST — before any DB call, matching DEV_CONTEXT pattern
    if (IS_DEV) {
      return { ok: true, userId: DEV_CONTEXT.userId, user: { role: 'super_admin' } };
    }

    await dbConnect();

    // Production: validate session cookie
    const cookieStore = await cookies();
    const userId = cookieStore.get('superAdminUserId')?.value;

    if (!userId) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Unauthorized: Super admin session required' },
          { status: 401 }
        ),
      };
    }

    const user = await User.findById(userId).lean();

    if (!user || (user as any).role !== 'super_admin') {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Forbidden: Insufficient privileges' },
          { status: 403 }
        ),
      };
    }

    return { ok: true, userId, user };
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
