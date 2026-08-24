import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import LoginForm from './LoginForm';

// Server component wrapper — the actual login UI (LoginForm) always used to
// render regardless of whether the visitor already had a valid session
// cookie, so a returning logged-in user re-doing the WhatsApp OTP flow every
// time they opened the site was burning a real per-message OTP cost for no
// reason: /dashboard already accepts the existing cookie fine, this page
// just never checked before asking for a fresh code. If a valid session
// exists, skip the form entirely.
export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect('/dashboard');
  }

  return <LoginForm />;
}
