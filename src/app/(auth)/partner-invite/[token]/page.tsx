'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { checkPasswordStrength } from '@/lib/passwordPolicy';

/**
 * Public: the approved partner isn't signed in yet. They land here from the
 * approval email, see the email their account will use (locked), and choose
 * a password. Checked by POST /api/partner/invite/check and created by
 * POST /api/partner/invite/accept.
 */

const INPUT =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

const RULES: Array<{ key: keyof ReturnType<typeof checkPasswordStrength>; label: string }> = [
  { key: 'minLength', label: 'At least 8 characters' },
  { key: 'hasUpper', label: 'An upper-case letter' },
  { key: 'hasLower', label: 'A lower-case letter' },
  { key: 'hasNumber', label: 'A number' },
  { key: 'hasSpecial', label: 'A special character (!@#$…)' },
];

export default function PartnerInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params.token ?? '');

  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState<{ email: string; fullName: string; companyName: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/partner/invite/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json.success) setInvite(json.data);
        else setLinkError(json.error || 'This link is not valid.');
      })
      .catch(() => alive && setLinkError('Could not check this link. Please refresh the page.'))
      .finally(() => alive && setChecking(false));
    return () => { alive = false; };
  }, [token]);

  const strength = checkPasswordStrength(password);
  const strong = Object.values(strength).every(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!strong) return setError('Your password does not meet all the rules below.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      const res = await fetch('/api/partner/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not create your account. Please try again.');
        return;
      }
      router.push(`/partner-login?created=1&email=${encodeURIComponent(json.data.email)}`);
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-8">
        <div className="w-14 h-14 bg-primary rounded-lg mx-auto flex items-center justify-center mb-6">
          <MaterialIcon name="handshake" size={28} className="text-on-primary" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Create your partner account</h1>
        <p className="text-sm text-on-surface-variant">Growwmatics AI Growth Partner Program</p>
      </div>

      {checking ? (
        <div className="flex justify-center py-8">
          <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
        </div>
      ) : linkError ? (
        <div className="text-center">
          <div role="alert" className="flex items-start gap-2 mb-6 px-4 py-3 bg-error-container border border-outline-variant rounded-lg text-on-error-container text-sm text-left">
            <MaterialIcon name="error" size={18} className="shrink-0 mt-0.5" />
            {linkError}
          </div>
          <a href="/partner-login" className="text-sm font-medium text-primary">Go to partner login</a>
        </div>
      ) : invite ? (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-lg bg-surface-container-low border border-outline-variant px-4 py-3 text-sm">
            <p className="font-semibold text-on-surface">{invite.fullName}</p>
            <p className="text-on-surface-variant">{invite.companyName}</p>
          </div>

          <div>
            <label htmlFor="pi-email" className="block text-label-md text-on-surface mb-2">Email address</label>
            <input id="pi-email" type="email" value={invite.email} readOnly disabled className={`${INPUT} opacity-80`} />
            <p className="text-xs text-on-surface-variant mt-1.5">Your account uses the email you applied with. It is already verified.</p>
          </div>

          <div>
            <label htmlFor="pi-password" className="block text-label-md text-on-surface mb-2">Create password</label>
            <div className="relative">
              <input
                id="pi-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${INPUT} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface"
              >
                <MaterialIcon name={show ? 'visibility_off' : 'visibility'} size={20} />
              </button>
            </div>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {RULES.map((r) => (
                <li key={r.key} className={`flex items-center gap-1.5 text-xs ${strength[r.key] ? 'text-primary' : 'text-on-surface-variant'}`}>
                  <MaterialIcon name={strength[r.key] ? 'check_circle' : 'radio_button_unchecked'} size={14} />
                  {r.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label htmlFor="pi-confirm" className="block text-label-md text-on-surface mb-2">Confirm password</label>
            <input
              id="pi-confirm"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={INPUT}
            />
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 px-4 py-3 bg-error-container border border-outline-variant rounded-lg text-on-error-container text-sm">
              <MaterialIcon name="error" size={18} className="shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
          >
            {submitting ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Create my account'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
