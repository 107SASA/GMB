import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { verifySessionToken, createSession } from '@/lib/session';

/**
 * "Save to dashboard" link sent after the WhatsApp report — a session token
 * (the same JWT shape signSessionToken/createSession use everywhere else)
 * carried in the URL rather than a cookie, since the visitor is tapping this
 * from WhatsApp with no browser session yet. Consumes it, sets the real
 * session + activeBusinessId cookies, and redirects into the app. Same
 * acceptable-risk tradeoff already made for the rest of this flow (phone
 * number is effectively the identity layer pre-claim — there's nothing
 * sensitive on the account yet).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await verifySessionToken(token).catch(() => null);
  if (!session) {
    return NextResponse.redirect(new URL('/login?error=expired_link', req.url));
  }

  await dbConnect();
  const user = await User.findById(session.userId).lean() as any;
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  await createSession(user._id.toString(), user.role);

  if (user.activeBusinessId) {
    const cookieStore = await cookies();
    cookieStore.set('activeBusinessId', user.activeBusinessId.toString(), {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || req.url;
  return NextResponse.redirect(new URL('/dashboard', base));
}
