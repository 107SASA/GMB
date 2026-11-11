'use client';

import { useCallback, useEffect, useState } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import {
  Handshake,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Copy,
  Mail,
  Pencil,
  Globe,
  MapPin,
  Phone,
} from 'lucide-react';
import { APPLICANT_TYPE_LABELS, type ApplicantType } from '@/lib/partners/partnerRules';
import { PartnerKycModal } from '@/components/admin/partners/PartnerKycModal';
import { CommissionsPanel } from '@/components/admin/partners/CommissionsPanel';

type AppStatus = 'pending' | 'approved' | 'rejected';

interface Application {
  _id: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  website?: string | null;
  city: string;
  state: string;
  applicantType: ApplicantType;
  message?: string | null;
  status: AppStatus;
  rejectReason?: string | null;
  reviewedBy?: { fullName?: string; email?: string } | null;
  reviewedAt?: string;
  createdAt: string;
}

interface Partner {
  _id: string;
  partnerCode: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  city: string;
  state: string;
  status: 'invited' | 'active' | 'suspended';
  kycStatus: string;
  firstPaymentRate: number;
  recurringRate: number;
  holdDays: number;
  recurringMonths?: number | null;
  approvedAt?: string;
  invite: { status: string; expiresAt: string } | null;
}

interface TermsForm {
  firstPaymentRate: string;
  recurringRate: string;
  holdDays: string;
  recurringMonths: string;
}

const EMPTY_TERMS: TermsForm = { firstPaymentRate: '', recurringRate: '', holdDays: '', recurringMonths: '' };

const INPUT = 'w-full px-3 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-surface-container-lowest';

function fmtDate(d?: string) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function TermsFields({ value, onChange }: { value: TermsForm; onChange: (v: TermsForm) => void }) {
  const field = (key: keyof TermsForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <label className="block">
        <span className="block text-xs font-semibold text-on-surface mb-1">First-payment commission (%) *</span>
        <input type="number" min={0} max={100} step="0.01" value={value.firstPaymentRate} onChange={field('firstPaymentRate')} className={INPUT} placeholder="e.g. 30" />
      </label>
      <label className="block">
        <span className="block text-xs font-semibold text-on-surface mb-1">Recurring commission (%) *</span>
        <input type="number" min={0} max={100} step="0.01" value={value.recurringRate} onChange={field('recurringRate')} className={INPUT} placeholder="e.g. 15" />
      </label>
      <label className="block">
        <span className="block text-xs font-semibold text-on-surface mb-1">Hold period (days) *</span>
        <input type="number" min={0} max={365} step="1" value={value.holdDays} onChange={field('holdDays')} className={INPUT} placeholder="e.g. 15" />
        <span className="block text-[11px] text-on-surface-variant mt-1">Days after a payment before its commission can be paid.</span>
      </label>
      <label className="block">
        <span className="block text-xs font-semibold text-on-surface mb-1">Recurring limit (months)</span>
        <input type="number" min={1} max={240} step="1" value={value.recurringMonths} onChange={field('recurringMonths')} className={INPUT} placeholder="Empty = no limit" />
        <span className="block text-[11px] text-on-surface-variant mt-1">Leave empty to pay recurring for as long as the customer pays.</span>
      </label>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-lg text-on-surface mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function LinkBox({ link, note }: { link: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-4 bg-secondary-container/40 border border-secondary-fixed rounded-xl">
      <p className="text-sm text-on-secondary-container mb-2">{note}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-surface-container-lowest border border-secondary-fixed rounded-lg px-3 py-2 text-on-surface break-all">{link}</code>
        <button
          onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1 px-3 py-2 bg-secondary text-white rounded-lg text-xs font-medium shrink-0"
        >
          <Copy className="w-3 h-3" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function GrowthPartnersAdminPage() {
  const [tab, setTab] = useState<'applications' | 'partners' | 'commissions'>('applications');
  const [appStatus, setAppStatus] = useState<AppStatus>('pending');
  const [applications, setApplications] = useState<Application[]>([]);
  const [counts, setCounts] = useState<Record<AppStatus, number>>({ pending: 0, approved: 0, rejected: 0 });
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approving, setApproving] = useState<Application | null>(null);
  const [rejecting, setRejecting] = useState<Application | null>(null);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [kycPartnerId, setKycPartnerId] = useState<string | null>(null);
  const [terms, setTerms] = useState<TermsForm>(EMPTY_TERMS);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'applications') {
        const res = await fetch(`/api/admin/growth-partners/applications?status=${appStatus}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        setApplications(json.data);
        setCounts(json.counts);
      } else if (tab === 'partners') {
        const res = await fetch('/api/admin/growth-partners');
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        setPartners(json.data);
      }
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, appStatus]);

  useEffect(() => { load(); }, [load]);

  const kycWaiting = partners.filter((p) => p.kycStatus === 'submitted').length;

  const closeModals = () => {
    setApproving(null);
    setRejecting(null);
    setEditing(null);
    setActionError(null);
    setTerms(EMPTY_TERMS);
    setReason('');
  };

  const post = async (url: string, body: unknown, method = 'POST') => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
    return json.data;
  };

  const handleApprove = async () => {
    if (!approving) return;
    setBusy(true);
    setActionError(null);
    try {
      const data = await post(`/api/admin/growth-partners/applications/${approving._id}/approve`, terms);
      setResult({
        link: data.inviteLink,
        note: data.emailSent
          ? `Approved as ${data.partnerCode}. We emailed this account link to ${approving.email}. You can also share it yourself:`
          : `Approved as ${data.partnerCode}, but the email could not be sent. Share this link with ${approving.email}:`,
      });
      closeModals();
      load();
    } catch (err: any) {
      setActionError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    setBusy(true);
    setActionError(null);
    try {
      await post(`/api/admin/growth-partners/applications/${rejecting._id}/reject`, { reason });
      closeModals();
      load();
    } catch (err: any) {
      setActionError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTerms = async () => {
    if (!editing) return;
    setBusy(true);
    setActionError(null);
    try {
      await post(`/api/admin/growth-partners/${editing._id}`, terms, 'PATCH');
      closeModals();
      load();
    } catch (err: any) {
      setActionError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSuspend = async (p: Partner, suspended: boolean) => {
    const msg = suspended
      ? `Suspend ${p.companyName}? They will be signed out and cannot log in until you reactivate them.`
      : `Reactivate ${p.companyName}?`;
    if (!confirm(msg)) return;
    try {
      await post(`/api/admin/growth-partners/${p._id}/status`, { suspended });
      load();
    } catch (err: any) {
      alert(friendlyClientMessage(err));
    }
  };

  const handleResend = async (p: Partner) => {
    if (!confirm(`Send a new account link to ${p.email}? The old link will stop working.`)) return;
    try {
      const data = await post(`/api/admin/growth-partners/${p._id}/resend-invite`, {});
      setResult({
        link: data.inviteLink,
        note: data.emailSent ? `New link emailed to ${p.email}:` : `Email failed. Share this link with ${p.email}:`,
      });
      load();
    } catch (err: any) {
      alert(friendlyClientMessage(err));
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
            <Handshake className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Growth Partners</h1>
            <p className="text-sm text-on-surface-variant">Review applications and set each partner&apos;s commission terms</p>
          </div>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-primary-fixed text-primary rounded-xl text-sm font-medium">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 mb-4 border-b border-outline-variant">
        {(['applications', 'partners', 'commissions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t === 'applications'
              ? `Applications${counts.pending ? ` (${counts.pending})` : ''}`
              : t === 'partners'
                ? `Partners${kycWaiting ? ` · ${kycWaiting} KYC to review` : ''}`
                : 'Commissions & payouts'}
          </button>
        ))}
      </div>

      {result && (
        <div className="mb-4">
          <LinkBox link={result.link} note={result.note} />
          <button onClick={() => setResult(null)} className="text-xs text-on-surface-variant mt-2 underline">Dismiss</button>
        </div>
      )}

      {tab === 'applications' && (
        <div className="flex flex-wrap gap-2 mb-4">
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setAppStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize ${
                appStatus === s ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {s} ({counts[s] ?? 0})
            </button>
          ))}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      {tab === 'commissions' ? (
        <CommissionsPanel />
      ) : loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : tab === 'applications' ? (
        applications.length === 0 ? (
          <div className="p-10 text-center text-outline text-sm bg-surface-container-lowest rounded-xl border border-outline-variant">
            No {appStatus} applications.
          </div>
        ) : (
          <div className="grid gap-3">
            {applications.map((a) => (
              <div key={a._id} className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-on-surface">{a.companyName}</p>
                    <p className="text-sm text-on-surface-variant">
                      {a.fullName} · {APPLICANT_TYPE_LABELS[a.applicantType] ?? a.applicantType}
                    </p>
                  </div>
                  <span className="text-xs text-on-surface-variant">Applied {fmtDate(a.createdAt)}</span>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-sm text-on-surface">
                  <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-outline" />{a.email}</span>
                  <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-outline" />{a.phone}</span>
                  <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-outline" />{a.city}, {a.state}</span>
                  {a.website && (
                    <a href={a.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
                      <Globe className="w-3.5 h-3.5" />{a.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
                {a.message && <p className="mt-3 text-sm text-on-surface-variant whitespace-pre-line">{a.message}</p>}

                {a.status === 'pending' ? (
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => { setApproving(a); setTerms(EMPTY_TERMS); }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-medium"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Approve
                    </button>
                    <button
                      onClick={() => { setRejecting(a); setReason(''); }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-surface-container text-on-surface rounded-xl text-sm font-medium"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-on-surface-variant">
                    {a.status === 'approved' ? 'Approved' : 'Rejected'} {fmtDate(a.reviewedAt)}
                    {a.reviewedBy?.fullName ? ` by ${a.reviewedBy.fullName}` : ''}
                    {a.status === 'rejected' && a.rejectReason ? ` — ${a.rejectReason}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      ) : partners.length === 0 ? (
        <div className="p-10 text-center text-outline text-sm bg-surface-container-lowest rounded-xl border border-outline-variant">
          No partners yet. Approve an application to add one.
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low text-left text-on-surface-variant">
                <th className="p-3">Partner</th>
                <th className="p-3">Code</th>
                <th className="p-3">First / Recurring</th>
                <th className="p-3">Hold</th>
                <th className="p-3">Account</th>
                <th className="p-3">KYC</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p._id} className="border-b border-outline-variant last:border-0 align-top">
                  <td className="p-3">
                    <p className="font-semibold text-on-surface">{p.companyName}</p>
                    <p className="text-xs text-on-surface-variant">{p.fullName} · {p.email}</p>
                  </td>
                  <td className="p-3 font-mono text-xs">{p.partnerCode}</td>
                  <td className="p-3">
                    {p.firstPaymentRate}% / {p.recurringRate}%
                    <span className="block text-[11px] text-on-surface-variant">
                      {p.recurringMonths ? `recurring for ${p.recurringMonths} mo` : 'recurring, no limit'}
                    </span>
                  </td>
                  <td className="p-3">{p.holdDays} days</td>
                  <td className="p-3">
                    {p.status === 'invited' ? (
                      <span className="text-xs">
                        Invite {p.invite?.status ?? 'none'}
                        {p.invite?.status === 'pending' ? ` · expires ${fmtDate(p.invite.expiresAt)}` : ''}
                      </span>
                    ) : (
                      <span className="text-xs capitalize">{p.status}</span>
                    )}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => setKycPartnerId(p._id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                        p.kycStatus === 'submitted'
                          ? 'bg-primary text-on-primary'
                          : p.kycStatus === 'verified'
                            ? 'bg-secondary-container/50 text-secondary'
                            : p.kycStatus === 'rejected'
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      {p.kycStatus === 'submitted' ? 'Review KYC' : p.kycStatus === 'not_submitted' ? 'Not submitted' : p.kycStatus === 'verified' ? 'Verified' : 'Sent back'}
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => {
                          setEditing(p);
                          setTerms({
                            firstPaymentRate: String(p.firstPaymentRate),
                            recurringRate: String(p.recurringRate),
                            holdDays: String(p.holdDays),
                            recurringMonths: p.recurringMonths ? String(p.recurringMonths) : '',
                          });
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-surface-container rounded-lg text-xs font-medium"
                      >
                        <Pencil className="w-3 h-3" /> Terms
                      </button>
                      {p.status === 'invited' && (
                        <button onClick={() => handleResend(p)} className="flex items-center gap-1 px-3 py-1.5 bg-primary-fixed text-primary rounded-lg text-xs font-medium">
                          <Mail className="w-3 h-3" /> Resend link
                        </button>
                      )}
                      {p.status === 'suspended' ? (
                        <button onClick={() => handleSuspend(p, false)} className="px-3 py-1.5 bg-primary-fixed text-primary rounded-lg text-xs font-medium">
                          Reactivate
                        </button>
                      ) : (
                        <button onClick={() => handleSuspend(p, true)} className="px-3 py-1.5 bg-error-container text-on-error-container rounded-lg text-xs font-medium">
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving && (
        <Modal title={`Approve ${approving.companyName}`} onClose={closeModals}>
          <p className="text-sm text-on-surface-variant mb-4">
            Set this partner&apos;s commission terms. We&apos;ll email {approving.email} a link to create their account.
          </p>
          <TermsFields value={terms} onChange={setTerms} />
          {actionError && <p className="mt-3 text-sm text-error">{actionError}</p>}
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={closeModals} className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-container">Cancel</button>
            <button
              onClick={handleApprove}
              disabled={busy || !terms.firstPaymentRate || !terms.recurringRate || !terms.holdDays}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary disabled:opacity-50"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Approve & send link
            </button>
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal title={`Reject ${rejecting.companyName}`} onClose={closeModals}>
          <label className="block">
            <span className="block text-xs font-semibold text-on-surface mb-1">Reason (optional, included in the email)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className={INPUT} />
          </label>
          {actionError && <p className="mt-3 text-sm text-error">{actionError}</p>}
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={closeModals} className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-container">Cancel</button>
            <button onClick={handleReject} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-error text-on-error disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Reject
            </button>
          </div>
        </Modal>
      )}

      {kycPartnerId && (
        <PartnerKycModal partnerId={kycPartnerId} onClose={() => setKycPartnerId(null)} onReviewed={load} />
      )}

      {editing && (
        <Modal title={`Commission terms — ${editing.companyName}`} onClose={closeModals}>
          <p className="text-sm text-on-surface-variant mb-4">
            Changes apply to future payments only. Commissions already earned keep their old rate.
          </p>
          <TermsFields value={terms} onChange={setTerms} />
          {actionError && <p className="mt-3 text-sm text-error">{actionError}</p>}
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={closeModals} className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-container">Cancel</button>
            <button onClick={handleSaveTerms} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save terms
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
