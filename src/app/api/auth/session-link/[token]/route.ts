import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import LoginLink from '@/models/LoginLink';
import { createSession } from '@/lib/session';

/**
 * "Save to dashboard" link sent after the WhatsApp report — a single-use,
 * short-lived token (see src/models/LoginLink.ts) carried in the URL, since
 * the visitor is tapping this from WhatsApp with no browser session yet.
 *
 * SECURITY: this is deliberately NOT a reusable session JWT. WhatsApp links
 * get forwarded, screenshotted, shown in lock-screen previews, and cached by
 * link-preview crawlers — a multi-use, long-lived bearer token embedded in a
 * URL sent over that channel is a real account-takeover risk. This route
 * atomically consumes the link (findOneAndUpdate matches only if unused and
 * unexpired) so it works exactly once.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  await dbConnect();

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const link = await LoginLink.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } }
  );
  if (!link) {
    return NextResponse.redirect(new URL('/login?error=expired_link', req.url));
  }

  const user = await User.findById(link.userId).lean() as any;
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
