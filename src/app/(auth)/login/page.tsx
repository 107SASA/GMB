import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import LoginForm from './LoginForm';

// Server component wrapper — the actual login UI (LoginForm) always used to
// render regardless of whether the visitor already had a valid session
// cookie, so a returning logged-in user re-doing the WhatsApp OTP flow every
// time they opened the site was burning a real per-message OTP cost for no
// reason: /dashboard already accepts the existing cookie fine, this page
// just never checked before asking for a fresh code. If a valid session
// exists AND still points at a real account, skip the form entirely.
export default async function LoginPage() {
  const session = await getSession();

  let userExists = false;
  if (session) {
    try {
      await dbConnect();
      userExists = !!(await User.exists({ _id: session.userId, isDeleted: { $ne: true } }));
    } catch {
      // A DB hiccup here shouldn't wedge login — fall through and show the form.
    }
  }

  // Only bounce to /dashboard when the account behind the cookie actually
  // exists. A JWT that merely verifies is not enough: if the account is gone
  // (deleted, or — in local dev — the database was swapped), /dashboard's own
  // guard redirects straight back here and the two pages ping-pong forever.
  if (session && userExists) {
    redirect('/dashboard');
  }

  // Session cookie present but orphaned -> LoginForm clears it on mount.
  return <LoginForm staleSession={!!session && !userExists} />;
}
