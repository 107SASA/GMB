'use client';

import { useEffect, useState, useCallback } from 'react';
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
    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
      <CheckCircle2 className="w-3 h-3" /> Accepted
    </span>
  );
  if (status === 'expired') return (
    <span className="flex items-center gap-1 text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
      <XCircle className="w-3 h-3" /> Expired
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
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
      setError(err.message);
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
      setFormError(err.message);
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
          <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Admin Invites</h1>
            <p className="text-sm text-slate-500">Invite new super admins to the platform</p>
          </div>
        </div>
        <button
          onClick={fetchInvites}
          className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-xl hover:bg-violet-100 transition-all text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Invite Form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Send New Invite</h2>
        <div className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            onClick={handleInvite}
            disabled={submitting || !email}
            className="flex items-center gap-2 px-5 py-2 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-all text-sm font-medium disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Invite
          </button>
        </div>

        {formError && (
          <p className="mt-3 text-sm text-red-600">{formError}</p>
        )}

        {/* Generated Invite Link */}
        {inviteLink && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-sm font-semibold text-emerald-700 mb-2">
              ✅ Invite created! Share this link with the person:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 text-slate-700 break-all">
                {inviteLink}
              </code>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700"
              >
                <Copy className="w-3 h-3" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-emerald-600 mt-2">⚠ This link expires in 48 hours.</p>
          </div>
        )}
      </div>

      {/* Invites Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-6 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">All Invites</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
          </div>
        ) : invites.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            No invites sent yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left p-4 text-slate-500 font-medium">Email</th>
                  <th className="text-left p-4 text-slate-500 font-medium">Status</th>
                  <th className="text-left p-4 text-slate-500 font-medium">Invited By</th>
                  <th className="text-left p-4 text-slate-500 font-medium">Expires</th>
                  <th className="text-left p-4 text-slate-500 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite._id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="p-4 font-medium text-slate-700">{invite.email}</td>
                    <td className="p-4"><StatusBadge status={invite.status} /></td>
                    <td className="p-4 text-slate-500">{invite.invitedBy?.fullName || '—'}</td>
                    <td className="p-4 text-slate-400">{new Date(invite.expiresAt).toLocaleString()}</td>
                    <td className="p-4">
                      {invite.status === 'pending' && (
                        <button
                          onClick={() => handleDelete(invite._id)}
                          className="text-red-400 hover:text-red-600 transition-colors"
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