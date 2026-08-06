'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useBusiness } from '@/context/BusinessContext';
import { planDisplayLabel, isPaidPlanLabel } from '@/lib/billing/planLabel';
import { checkPasswordStrength } from '@/lib/passwordPolicy';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getAvatarColors(letter: string): string {
  const l = letter.toUpperCase();
  if (l >= 'A' && l <= 'F') return 'bg-primary-fixed text-primary';
  if (l >= 'G' && l <= 'L') return 'bg-primary-fixed text-primary';
  if (l >= 'M' && l <= 'R') return 'bg-secondary-container text-on-secondary-container';
  return 'bg-error-container text-on-error-container';
}

function formatMemberSince(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function timeAgo(date: string | Date | undefined): string {
  if (!date) return 'Never';
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function trialDaysLeft(endsAt: string | Date): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000));
}

const MODULE_LABELS: Record<string, string> = {
  google_ranking_agent: 'Audit Engine',
  content_studio: 'Content Studio',
  sales_agent: 'Sales Agent',
  reputation_agent: 'Reputation Agent',
  marketing_automation: 'Marketing Automation',
};

function inputCls(extra = '') {
  return `w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest ${extra}`;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const router = useRouter();
  const { activeBusiness } = useBusiness();

  // ── User data ───────────────────────────────────────────────────────────
  const [user, setUser] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);

  // ── Personal info form ──────────────────────────────────────────────────
  const [infoForm, setInfoForm] = useState({ fullName: '', phone: '', companyName: '' });
  const [infoSaveState, setInfoSaveState] = useState<SaveState>('idle');
  const [infoError, setInfoError] = useState('');

  // ── Password form ───────────────────────────────────────────────────────
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdShow, setPwdShow] = useState({ current: false, next: false, confirm: false });
  const [pwdSaveState, setPwdSaveState] = useState<SaveState>('idle');
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState(false);

  // ── Delete account modal ─────────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Load data ───────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [uRes, sRes] = await Promise.all([
        fetch('/api/user/profile'),
        fetch('/api/user/subscription'),
      ]);
      if (uRes.ok) {
        const { user: u } = await uRes.json();
        setUser(u);
        // Company Name is read-only here — it mirrors the active Business's
        // name (edited in Settings → Business Profile) instead of the old
        // separately-typed User.companyName, which could silently drift out
        // of sync with the actual business record shown everywhere else.
        setInfoForm({ fullName: u.fullName ?? '', phone: u.phone ?? '', companyName: '' });
      }
      if (sRes.ok) {
        const { subscription: s } = await sRes.json();
        setSubscription(s);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (activeBusiness?.name) {
      setInfoForm(p => ({ ...p, companyName: activeBusiness.name }));
    }
  }, [activeBusiness?.name]);

  // ── Password validation ─────────────────────────────────────────────────
  // Same policy as signup/reset-password (src/lib/passwordPolicy.ts) — this
  // form previously only required length + "a digit or symbol", so it was
  // possible to set a password here with no uppercase/lowercase/special
  // character that the reset-password flow would have rejected outright.
  const pwdStrength = checkPasswordStrength(pwdForm.next);
  const pwdMatch = pwdForm.next === pwdForm.confirm && pwdForm.confirm.length > 0;
  const pwdValid =
    pwdForm.current.length > 0 &&
    pwdStrength.minLength &&
    pwdStrength.hasUpper &&
    pwdStrength.hasLower &&
    pwdStrength.hasNumber &&
    pwdStrength.hasSpecial &&
    pwdMatch;

  // ── Personal info save ──────────────────────────────────────────────────
  const handleInfoSave = async () => {
    setInfoSaveState('saving');
    setInfoError('');
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: infoForm.fullName,
          phone: infoForm.phone,
          // companyName intentionally omitted — it's read-only here, sourced
          // from the active Business, not saved back onto the User doc.
        }),
      });
      const data = await res.json();
      if (!res.ok) { setInfoError(data.error || 'Save failed.'); setInfoSaveState('error'); return; }
      setUser(data.user);
      setInfoSaveState('saved');
      setTimeout(() => setInfoSaveState('idle'), 2000);
    } catch {
      setInfoError('Network error. Please try again.');
      setInfoSaveState('error');
    }
  };

  // ── Password change ─────────────────────────────────────────────────────
  const handlePwdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdValid) return;
    setPwdSaveState('saving');
    setPwdError('');
    setPwdSuccess(false);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: pwdForm.current,
          newPassword: pwdForm.next,
          confirmPassword: pwdForm.confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setPwdError(data.error || 'Failed to update password.'); setPwdSaveState('error'); return; }
      setPwdForm({ current: '', next: '', confirm: '' });
      setPwdSaveState('idle');
      setPwdSuccess(true);
      setTimeout(() => setPwdSuccess(false), 4000);
    } catch {
      setPwdError('Network error. Please try again.');
      setPwdSaveState('error');
    }
  };

  // ── Delete account ──────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    setDeleteError('');
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/user/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: deleteEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setDeleteError(data.error || 'Delete failed.'); setDeleteLoading(false); return; }
      router.push('/');
    } catch {
      setDeleteError('Network error. Please try again.');
      setDeleteLoading(false);
    }
  };

  const initials = user ? getInitials(user.fullName ?? '') : '?';
  const avatarColors = user ? getAvatarColors((user.fullName ?? 'U')[0]) : 'bg-surface-container text-on-surface-variant';

  const enabledModules = subscription?.modules
    ? Object.entries(subscription.modules).filter(([, v]: [string, any]) => v?.enabled)
    : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="font-heading text-2xl font-bold text-on-surface mb-1">Profile</h1>
      <p className="text-sm text-on-surface-variant mb-6">Manage your account information and security settings.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Personal Information card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 space-y-5">
            {/* Avatar + read-only info */}
            <div className="flex items-center gap-4">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold shrink-0 ${avatarColors}`}
              >
                {initials}
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold text-outline uppercase tracking-wider">Email</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-on-surface break-all">{user?.email ?? '—'}</span>
                  <span className="text-xs bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full font-medium shrink-0">read-only</span>
                </div>
                <p className="text-xs text-outline">Contact support if you need to change your email.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Full Name</label>
                <input
                  className={inputCls()}
                  value={infoForm.fullName}
                  onChange={e => setInfoForm(p => ({ ...p, fullName: e.target.value }))}
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Phone</label>
                <input
                  className={inputCls()}
                  value={infoForm.phone}
                  onChange={e => setInfoForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+91XXXXXXXXXX"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Company Name</label>
                <input
                  className={inputCls('bg-surface-container disabled:opacity-70 cursor-not-allowed')}
                  value={infoForm.companyName}
                  disabled
                  readOnly
                />
                <p className="text-xs text-outline mt-1">
                  Pulled from your business profile —{' '}
                  <Link href="/dashboard/settings" className="text-primary font-semibold hover:underline">
                    edit it in Settings
                  </Link>
                  .
                </p>
              </div>
            </div>

            {/* Read-only meta */}
            <div className="grid grid-cols-2 gap-3 border-t border-outline-variant pt-4">
              <div>
                <p className="text-xs font-semibold text-outline uppercase tracking-wider mb-0.5">Member Since</p>
                <p className="text-sm text-on-surface">{user?.createdAt ? formatMemberSince(user.createdAt) : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-outline uppercase tracking-wider mb-0.5">Last Login</p>
                <p className="text-sm text-on-surface">{user?.lastLoginAt ? timeAgo(user.lastLoginAt) : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-outline uppercase tracking-wider mb-0.5">Email Verified</p>
                {user?.isEmailVerified ? (
                  <span className="inline-flex items-center gap-1 text-on-secondary-container text-sm font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-error text-sm font-semibold">
                    <XCircle className="w-4 h-4" /> Not Verified
                  </span>
                )}
              </div>
            </div>

            {infoError && (
              <p className="text-sm text-error bg-error-container border border-error-container rounded-xl px-4 py-2.5">
                {infoError}
              </p>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleInfoSave}
                disabled={infoSaveState === 'saving'}
                className="px-6 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-60 text-white rounded-xl font-semibold text-sm transition-all flex items-center gap-2"
              >
                {infoSaveState === 'saving' && (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {infoSaveState === 'saving' ? 'Saving…' : infoSaveState === 'saved' ? '✓ Saved' : 'Save Changes'}
              </button>
            </div>
          </div>

          {/* Account Overview card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 space-y-4">
            <h2 className="text-base font-bold text-on-surface">Account Overview</h2>

            {/* Plan */}
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-sm font-bold ${
                  isPaidPlanLabel(subscription?.planType)
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                {planDisplayLabel(subscription?.planType)}
              </span>
              {(!subscription || subscription.planType === 'Free' || subscription.planType === 'Pro') && (
                <a
                  href="/dashboard/billing"
                  className="inline-flex items-center gap-1 text-sm text-primary font-semibold hover:underline"
                >
                  Upgrade <ArrowRight className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            {/* Trial */}
            {subscription?.trialStatus?.isActive && subscription.trialStatus.endsAt && (
              <div className="bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container font-medium">
                Trial ends in <strong>{trialDaysLeft(subscription.trialStatus.endsAt)} days</strong>
              </div>
            )}

            {/* Modules */}
            {enabledModules.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-outline uppercase tracking-wider mb-2">Active Modules</p>
                <div className="flex flex-wrap gap-2">
                  {enabledModules.map(([key]) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary-container/40 text-on-secondary-container px-3 py-1 rounded-full"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {MODULE_LABELS[key] ?? key}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Change Password card */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-on-surface">Change Password</h2>
              <p className="text-sm text-on-surface-variant mt-0.5">
                Changing password for <span className="font-medium text-on-surface">{user?.email ?? '—'}</span>
              </p>
            </div>

            {pwdSuccess && (
              <div className="flex items-center gap-2 text-sm text-on-secondary-container bg-secondary-container/40 border border-secondary-fixed rounded-xl px-4 py-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Password updated successfully.
              </div>
            )}

            <form onSubmit={handlePwdSubmit} className="space-y-4">
              {/* Current password */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Current Password</label>
                <div className="relative">
                  <input
                    type={pwdShow.current ? 'text' : 'password'}
                    className={inputCls('pr-10')}
                    value={pwdForm.current}
                    onChange={e => setPwdForm(p => ({ ...p, current: e.target.value }))}
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setPwdShow(p => ({ ...p, current: !p.current }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
                  >
                    {pwdShow.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {pwdError && (
                  <p className="text-xs text-error mt-1.5">{pwdError}</p>
                )}
              </div>

              {/* New password */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={pwdShow.next ? 'text' : 'password'}
                    className={inputCls('pr-10')}
                    value={pwdForm.next}
                    onChange={e => { setPwdForm(p => ({ ...p, next: e.target.value })); setPwdError(''); }}
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setPwdShow(p => ({ ...p, next: !p.next }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
                  >
                    {pwdShow.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {pwdForm.next.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    <p className={`text-xs flex items-center gap-1 ${pwdStrength.minLength ? 'text-secondary' : 'text-outline'}`}>
                      {pwdStrength.minLength ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      At least 8 characters ({pwdForm.next.length})
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${pwdStrength.hasUpper ? 'text-secondary' : 'text-outline'}`}>
                      {pwdStrength.hasUpper ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      An uppercase letter
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${pwdStrength.hasLower ? 'text-secondary' : 'text-outline'}`}>
                      {pwdStrength.hasLower ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      A lowercase letter
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${pwdStrength.hasNumber ? 'text-secondary' : 'text-outline'}`}>
                      {pwdStrength.hasNumber ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      A number
                    </p>
                    <p className={`text-xs flex items-center gap-1 ${pwdStrength.hasSpecial ? 'text-secondary' : 'text-outline'}`}>
                      {pwdStrength.hasSpecial ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      A special character (!@#$%^&* etc.)
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={pwdShow.confirm ? 'text' : 'password'}
                    className={inputCls('pr-10')}
                    value={pwdForm.confirm}
                    onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))}
                    placeholder="Repeat new password"
                  />
                  <button
                    type="button"
                    onClick={() => setPwdShow(p => ({ ...p, confirm: !p.confirm }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface-variant"
                  >
                    {pwdShow.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {pwdForm.confirm.length > 0 && (
                  <p className={`text-xs flex items-center gap-1 mt-1.5 ${pwdMatch ? 'text-secondary' : 'text-error'}`}>
                    {pwdMatch ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {pwdMatch ? 'Passwords match' : "Passwords don't match"}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!pwdValid || pwdSaveState === 'saving'}
                className="w-full py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-all"
              >
                {pwdSaveState === 'saving' ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </div>

          {/* Danger Zone card */}
          <div className="bg-surface-container-lowest border-2 border-error-container rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-error" />
              <h2 className="text-base font-bold text-on-error-container">Danger Zone</h2>
            </div>
            <p className="text-sm text-on-surface-variant">
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-5 py-2.5 bg-error-container hover:bg-error-container text-on-error-container border border-error-container rounded-xl font-semibold text-sm transition-all"
            >
              Delete My Account
            </button>
          </div>
        </div>
      </div>

      {/* ── Delete Account Modal ──────────────────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md border border-outline-variant">
            <div className="p-6 border-b border-outline-variant">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-5 h-5 text-error" />
                <h2 className="text-lg font-bold text-on-surface">Delete Your Account</h2>
              </div>
              <p className="text-sm text-on-surface-variant mt-3 leading-relaxed">
                Your account, all your business data, leads, reviews, content, and campaigns will be{' '}
                <strong>permanently deleted</strong>. This cannot be undone.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Type your email address to confirm
                </label>
                <input
                  type="email"
                  className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder={user?.email ?? 'your@email.com'}
                  value={deleteEmail}
                  onChange={e => { setDeleteEmail(e.target.value); setDeleteError(''); }}
                  autoComplete="off"
                />
              </div>
              {deleteError && (
                <p className="text-sm text-error bg-error-container border border-error-container rounded-xl px-4 py-2.5">
                  {deleteError}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowDeleteModal(false); setDeleteEmail(''); setDeleteError(''); }}
                  className="flex-1 py-2.5 bg-surface hover:bg-surface-container text-on-surface border border-outline-variant rounded-xl font-semibold text-sm transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={
                    deleteLoading ||
                    !user?.email ||
                    deleteEmail.toLowerCase().trim() !== user.email.toLowerCase()
                  }
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-all"
                >
                  {deleteLoading ? 'Deleting…' : 'Delete Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
