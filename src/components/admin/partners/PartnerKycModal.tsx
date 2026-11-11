'use client';

import { useEffect, useState } from 'react';
import { Loader2, FileText, ShieldCheck, XCircle, Eye, EyeOff } from 'lucide-react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import { COMPANY_TYPE_LABELS, type CompanyType } from '@/lib/partners/kycRules';

/**
 * Super admin: review one partner's KYC. PAN and account number arrive in
 * full (needed to verify and to pay) but stay hidden until "Show" is clicked.
 * Loading this modal and opening each document is written to the admin log.
 */

interface AdminKyc {
  kycStatus: 'not_submitted' | 'submitted' | 'verified' | 'rejected';
  rejectReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  entityType: 'company' | 'individual' | null;
  legalName: string;
  companyType: CompanyType | null;
  gstin: string | null;
  registrationNumber: string | null;
  address: string;
  pincode: string;
  pan: string | null;
  aadhaarMasked: string | null;
  bank: {
    accountHolderName: string;
    accountNumber: string | null;
    accountMasked: string | null;
    ifsc: string;
    bankName: string;
    accountType: string | null;
  } | null;
  documents: Array<{ id: string; label: string; fileName: string; contentType: string }>;
  partner: { id: string; partnerCode: string; companyName: string; fullName: string; email: string };
}

const STATUS_TEXT: Record<AdminKyc['kycStatus'], string> = {
  not_submitted: 'Not submitted',
  submitted: 'Waiting for review',
  verified: 'Verified',
  rejected: 'Sent back for changes',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface break-words">{children}</dd>
    </>
  );
}

export function PartnerKycModal({ partnerId, onClose, onReviewed }: { partnerId: string; onClose: () => void; onReviewed: () => void }) {
  const [kyc, setKyc] = useState<AdminKyc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/growth-partners/${partnerId}/kyc`)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        if (json.success) setKyc(json.data);
        else setError(json.error || 'Could not load KYC');
      })
      .catch((err) => alive && setError(friendlyClientMessage(err)));
    return () => { alive = false; };
  }, [partnerId]);

  const review = async (decision: 'verify' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/growth-partners/${partnerId}/kyc/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Request failed');
      onReviewed();
      onClose();
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const hidden = (value: string | null, masked: string | null) =>
    reveal ? <span className="font-mono">{value ?? '—'}</span> : <span className="font-mono">{masked ?? '••••'}</span>;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Partner KYC"
        className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {!kyc ? (
          error ? <p className="text-sm text-error">{error}</p> : (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold text-lg text-on-surface">KYC — {kyc.partner.companyName}</h2>
                <p className="text-xs text-on-surface-variant">{kyc.partner.fullName} · {kyc.partner.email} · {kyc.partner.partnerCode}</p>
              </div>
              <span className="text-xs font-bold px-2 py-1 rounded-lg bg-surface-container">{STATUS_TEXT[kyc.kycStatus]}</span>
            </div>

            {kyc.kycStatus === 'not_submitted' && !kyc.legalName ? (
              <p className="text-sm text-on-surface-variant py-6 text-center">This partner hasn’t submitted KYC yet.</p>
            ) : (
              <>
                <div className="flex justify-end mb-2">
                  <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-primary">
                    {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {reveal ? 'Hide PAN & account number' : 'Show PAN & account number'}
                  </button>
                </div>
                <dl className="text-sm grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-4 gap-y-2 mb-5">
                  <Row label="Registered as">
                    <span className="capitalize">{kyc.entityType}</span>
                    {kyc.companyType ? ` · ${COMPANY_TYPE_LABELS[kyc.companyType] ?? kyc.companyType}` : ''}
                  </Row>
                  <Row label="Legal name">{kyc.legalName}</Row>
                  {kyc.gstin && <Row label="GSTIN"><span className="font-mono">{kyc.gstin}</span></Row>}
                  {kyc.registrationNumber && <Row label="Registration no.">{kyc.registrationNumber}</Row>}
                  <Row label="Address">{kyc.address} – {kyc.pincode}</Row>
                  <Row label="PAN">{hidden(kyc.pan, kyc.pan ? `XXXXXX${kyc.pan.slice(-4)}` : null)}</Row>
                  {kyc.aadhaarMasked && <Row label="Aadhaar">{<span className="font-mono">{kyc.aadhaarMasked}</span>}</Row>}
                  {kyc.bank && (
                    <>
                      <Row label="Account holder">{kyc.bank.accountHolderName}</Row>
                      <Row label="Account number">{hidden(kyc.bank.accountNumber, kyc.bank.accountMasked)}</Row>
                      <Row label="IFSC / bank">{kyc.bank.ifsc} · {kyc.bank.bankName} · <span className="capitalize">{kyc.bank.accountType}</span></Row>
                    </>
                  )}
                  {kyc.kycStatus === 'rejected' && kyc.rejectReason && <Row label="Sent back because">{kyc.rejectReason}</Row>}
                </dl>

                <h3 className="text-sm font-semibold text-on-surface mb-2">Documents</h3>
                <ul className="grid sm:grid-cols-2 gap-2 mb-5">
                  {kyc.documents.map((d) => (
                    <li key={d.id}>
                      <a
                        href={`/api/admin/growth-partners/${partnerId}/kyc/documents/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant hover:border-primary text-sm"
                      >
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                        <span className="truncate">{d.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {rejecting && (
              <label className="block mb-4">
                <span className="block text-xs font-semibold text-on-surface mb-1">What should the partner fix? (emailed to them) *</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </label>
            )}
            {error && <p className="mb-3 text-sm text-error">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-container">Close</button>
              {kyc.kycStatus === 'submitted' && (
                rejecting ? (
                  <button onClick={() => review('reject')} disabled={busy || reason.trim().length < 3} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-error text-on-error disabled:opacity-50">
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send back
                  </button>
                ) : (
                  <>
                    <button onClick={() => setRejecting(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-surface-container text-on-surface">
                      <XCircle className="w-4 h-4" /> Needs changes
                    </button>
                    <button onClick={() => review('verify')} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary disabled:opacity-50">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Verify KYC
                    </button>
                  </>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
