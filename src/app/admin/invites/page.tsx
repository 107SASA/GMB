'use client';

import { useEffect, useState, useCallback } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import {
  UserPlus,
  Copy,
  Trash2,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
} from 'lucide-react';

interface Invite {
  _id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy?: { fullName: string; email: string };
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'accepted') return (
    <span className="flex items-center gap-1 text-xs font-bold text-secondary bg-secondary-container/40 px-2 py-1 rounded-lg">
      <CheckCircle2 className="w-3 h-3" /> Accepted
    </span>
  );
  if (status === 'expired') return (
    <span className="flex items-center gap-1 text-xs font-bold text-on-surface-variant bg-surface-container px-2 py-1 rounded-lg">
      <XCircle className="w-3 h-3" /> Expired
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-bold text-primary bg-primary-fixed px-2 py-1 rounded-lg">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/invites');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setInvites(json.data);
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleInvite = async () => {
    if (!email) return;
    setSubmitting(true);
    setFormError(null);
    setInviteLink(null);

    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setInviteLink(json.data.inviteLink);
      setEmail('');
      fetchInvites();
    } catch (err: any) {
      setFormError(friendlyClientMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this invite?')) return;
    await fetch('/api/admin/invites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchInvites();
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Admin Invites</h1>
            <p className="text-sm text-on-surface-variant">Invite new super admins to the platform</p>
          </div>
        </div>
        <button
          onClick={fetchInvites}
          className="flex items-center gap-2 px-4 py-2 bg-primary-fixed text-primary rounded-xl hover:bg-primary-fixed transition-all text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Invite Form */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 mb-6">
        <h2 className="font-semibold text-on-surface mb-4">Send New Invite</h2>
        <div className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            className="flex-1 px-4 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={handleInvite}
            disabled={submitting || !email}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-on-primary rounded-xl hover:bg-primary-container transition-all text-sm font-medium disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Invite
          </button>
        </div>

        {formError && (
          <p className="mt-3 text-sm text-error">{formError}</p>
        )}

        {/* Generated Invite Link */}
        {inviteLink && (
          <div className="mt-4 p-4 bg-secondary-container/40 border border-secondary-fixed rounded-xl">
            <p className="text-sm font-semibold text-on-secondary-container mb-2">
              ✅ Invite created! Share this link with the person:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-surface-container-lowest border border-secondary-fixed rounded-lg px-3 py-2 text-on-surface break-all">
                {inviteLink}
              </code>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-2 bg-secondary text-white rounded-lg text-xs font-medium hover:bg-secondary"
              >
                <Copy className="w-3 h-3" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-secondary mt-2">⚠ This link expires in 48 hours.</p>
          </div>
        )}
      </div>

      {/* Invites Table */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow">
        <div className="p-6 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">All Invites</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : invites.length === 0 ? (
          <div className="p-8 text-center text-outline text-sm">
            No invites sent yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low">
                  <th className="text-left p-4 text-label-sm text-on-surface-variant">Email</th>
                  <th className="text-left p-4 text-label-sm text-on-surface-variant">Status</th>
                  <th className="text-left p-4 text-label-sm text-on-surface-variant">Invited By</th>
                  <th className="text-left p-4 text-label-sm text-on-surface-variant">Expires</th>
                  <th className="text-left p-4 text-label-sm text-on-surface-variant">Action</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite._id} className="border-b border-outline-variant hover:bg-surface">
                    <td className="p-4 font-medium text-on-surface">{invite.email}</td>
                    <td className="p-4"><StatusBadge status={invite.status} /></td>
                    <td className="p-4 text-on-surface-variant">{invite.invitedBy?.fullName || '—'}</td>
                    <td className="p-4 text-outline">{new Date(invite.expiresAt).toLocaleString()}</td>
                    <td className="p-4">
                      {invite.status === 'pending' && (
                        <button
                          onClick={() => handleDelete(invite._id)}
                          className="text-error hover:text-error transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}