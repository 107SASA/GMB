import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { getSession } from '@/lib/session';

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
