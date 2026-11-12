'use client';

import { useCallback, useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

type Perm = 'blog' | 'cms';

interface Member {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  teamPermissions?: Perm[];
  lastLoginAt?: string;
  createdAt: string;
  isDeleted?: boolean;
}

interface Invite {
  _id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired';
  role?: 'SUPER_ADMIN' | 'TEAM_MEMBER';
  permissions?: Perm[];
  expiresAt: string;
}

const PERMS: { id: Perm; label: string; help: string; icon: string }[] = [
  { id: 'blog', label: 'Blog', help: 'Write and edit blog posts (English & Hindi).', icon: 'article' },
  { id: 'cms', label: 'Website pages', help: 'Edit page titles for Google, share previews and Q&A.', icon: 'web' },
];

/**
 * Super Admin → Team. Content Studio team members (marketing): invite, choose
 * what they can work on, remove. They can never open /admin or customer data,
 * and everything they change waits for Super Admin approval.
 */
export default function TeamPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState<Perm[]>(['blog']);
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string; emailed: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([fetch('/api/admin/team').then((r) => r.json()), fetch('/api/admin/invites').then((r) => r.json())]);
      if (!m.success) throw new Error(m.error);
      setMembers(m.data);
      setInvites((i.data || []).filter((x: Invite) => x.role === 'TEAM_MEMBER' && x.status !== 'accepted'));
    } catch (e: any) {
      setError(friendlyClientMessage(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const call = async (url: string, method: string, body: unknown, key: string) => {
    setBusy(key);
    setError('');
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      return d;
    } catch (e: any) {
      setError(friendlyClientMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    if (!email.trim() || perms.length === 0) return;
    setSending(true);
    const d = await call('/api/admin/invites', 'POST', { email, role: 'TEAM_MEMBER', permissions: perms }, 'invite');
    setSending(false);
    if (d) {
      setLink({ url: d.data.inviteLink, email, emailed: Boolean(d.data.emailSent) });
      setEmail('');
      load();
    }
  };

  const togglePerm = async (m: Member, p: Perm) => {
    const cur = m.isDeleted ? [] : m.teamPermissions || [];
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
    if (next.length === 0) {
      setError('Keep at least one area, or use “Remove” to take away all access.');
      return;
    }
    if (await call('/api/admin/team', 'PATCH', { userId: m._id, permissions: next }, `${m._id}-${p}`)) load();
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.fullName}? They are signed out at once and can no longer open the Content Studio. Their posts stay.`)) return;
    if (await call('/api/admin/team', 'DELETE', { userId: m._id }, `${m._id}-remove`)) load();
  };

  const active = (members || []).filter((m) => !m.isDeleted);
  const removed = (members || []).filter((m) => m.isDeleted);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
            <MaterialIcon name="groups" size={22} />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Marketing team</h1>
            <p className="text-sm text-on-surface-variant">People who work on the blog and website pages in the Content Studio.</p>
          </div>
        </div>
        <a href="/studio" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant px-4 text-sm font-semibold hover:bg-surface-container">
          <MaterialIcon name="edit_square" size={18} /> Open Content Studio
        </a>
      </div>

      <div className="mb-6 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a8a]">
        <p className="font-semibold">What a team member can do</p>
        <p className="mt-1">
          They sign in at <b>/admin-login</b> and only see the Content Studio. They can never open this admin panel, customers, billing or leads.
          Every post and page change they make waits for a Super Admin to approve it.
        </p>
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-error/30 bg-error-container/50 p-3 text-sm text-on-error-container">{error}</p>}

      <section className="mb-6 rounded-xl border border-outline-variant bg-surface-container-lowest p-5 card-shadow">
        <h2 className="mb-4 font-semibold text-on-surface">Invite someone</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Their work email"
            className="min-h-11 w-full rounded-xl border border-outline-variant px-4 text-[16px] focus:outline-none focus:ring-2 focus:ring-primary sm:text-sm"
          />
          <button
            onClick={invite}
            disabled={sending || !email.trim() || perms.length === 0}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-container disabled:opacity-50"
          >
            <MaterialIcon name={sending ? 'progress_activity' : 'person_add'} size={18} className={sending ? 'animate-spin' : ''} />
            Send invite
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {PERMS.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${perms.includes(p.id) ? 'border-primary bg-primary-fixed' : 'border-outline-variant'}`}>
              <input
                type="checkbox"
                checked={perms.includes(p.id)}
                onChange={() => setPerms(perms.includes(p.id) ? perms.filter((x) => x !== p.id) : [...perms, p.id])}
                className="mt-1 h-4 w-4 accent-[#06b34c]"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <MaterialIcon name={p.icon} size={16} /> {p.label}
                </span>
                <span className="block text-xs text-on-surface-variant">{p.help}</span>
              </span>
            </label>
          ))}
        </div>
        {link && (
          <div className="mt-4 rounded-xl border border-secondary-fixed bg-secondary-container/40 p-4">
            <p className="mb-2 text-sm font-semibold text-on-secondary-container">
              {link.emailed ? `✅ Invite emailed to ${link.email}. You can also send this link on WhatsApp:` : `⚠ The email could not be sent. Send ${link.email} this link yourself:`}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <code className="flex-1 break-all rounded-lg border border-secondary-fixed bg-surface-container-lowest px-3 py-2 text-xs">{link.url}</code>
              <button onClick={() => navigator.clipboard.writeText(link.url)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-white">
                Copy
              </button>
            </div>
            <p className="mt-2 text-xs text-secondary">Works once, expires in 48 hours.</p>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-outline-variant bg-surface-container-lowest card-shadow">
        <h2 className="border-b border-outline-variant p-5 font-semibold text-on-surface">Team members ({active.length})</h2>
        {members === null ? (
          <p className="p-5 text-sm text-on-surface-variant">Loading…</p>
        ) : active.length === 0 ? (
          <p className="p-5 text-sm text-on-surface-variant">No team members yet. Invite your marketing team above.</p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {active.map((m) => (
              <li key={m._id} className="flex flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-on-surface">{m.fullName}</p>
                  <p className="truncate text-sm text-on-surface-variant">{m.email}</p>
                  <p className="text-xs text-outline">{m.lastLoginAt ? `Last signed in ${new Date(m.lastLoginAt).toLocaleString('en-IN')}` : 'Has not signed in yet'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {PERMS.map((p) => {
                    const on = (m.teamPermissions || []).includes(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => togglePerm(m, p.id)}
                        disabled={busy === `${m._id}-${p.id}`}
                        aria-pressed={on}
                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${on ? 'bg-primary text-white' : 'border border-outline-variant text-on-surface-variant hover:bg-surface-container'}`}
                      >
                        <MaterialIcon name={on ? 'check' : p.icon} size={14} /> {p.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => remove(m)}
                    disabled={busy === `${m._id}-remove`}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-error hover:bg-error-container/40"
                  >
                    <MaterialIcon name="person_remove" size={14} /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {invites.length > 0 && (
        <section className="mb-6 rounded-xl border border-outline-variant bg-surface-container-lowest card-shadow">
          <h2 className="border-b border-outline-variant p-5 font-semibold text-on-surface">Pending invites</h2>
          <ul className="divide-y divide-outline-variant">
            {invites.map((i) => (
              <li key={i._id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="text-xs text-on-surface-variant">
                    {(i.permissions || []).map((p) => PERMS.find((x) => x.id === p)?.label).join(' + ')} ·{' '}
                    {i.status === 'expired' || new Date(i.expiresAt) < new Date() ? 'Expired' : `Expires ${new Date(i.expiresAt).toLocaleString('en-IN')}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      const d = await call('/api/admin/invites', 'PATCH', { id: i._id }, `${i._id}-resend`);
                      if (d) {
                        setLink({ url: d.data.inviteLink, email: i.email, emailed: Boolean(d.data.emailSent) });
                        load();
                      }
                    }}
                    disabled={busy === `${i._id}-resend`}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-primary hover:bg-primary-fixed"
                  >
                    <MaterialIcon name="send" size={14} /> Resend
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Delete the invite for ${i.email}?`) && (await call('/api/admin/invites', 'DELETE', { id: i._id }, `${i._id}-del`))) load();
                    }}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-error hover:bg-error-container/40"
                  >
                    <MaterialIcon name="delete" size={14} /> Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <section className="rounded-xl border border-outline-variant bg-surface-container-lowest card-shadow">
          <h2 className="border-b border-outline-variant p-5 font-semibold text-on-surface">Removed</h2>
          <ul className="divide-y divide-outline-variant">
            {removed.map((m) => (
              <li key={m._id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-on-surface-variant">{m.fullName}</p>
                  <p className="truncate text-xs text-outline">{m.email}</p>
                </div>
                <button
                  onClick={async () => {
                    if (await call('/api/admin/team', 'PATCH', { userId: m._id, permissions: ['blog'] }, `${m._id}-restore`)) load();
                  }}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-primary hover:bg-primary-fixed"
                >
                  <MaterialIcon name="person_add" size={14} /> Give Blog access back
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
