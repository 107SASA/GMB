'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  COMPANY_TYPES,
  COMPANY_TYPE_LABELS,
  KYC_DOC_LABELS,
  requiredDocKinds,
  type CompanyType,
  type EntityType,
  type KycDocKind,
} from '@/lib/partners/kycRules';

interface KycDoc {
  id: string;
  kind: KycDocKind;
  label: string;
  fileName: string;
  size: number;
  uploadedAt: string;
}

interface KycView {
  kycStatus: 'not_submitted' | 'submitted' | 'verified' | 'rejected';
  rejectReason: string | null;
  submittedAt: string | null;
  entityType: EntityType | null;
  legalName: string;
  companyType: CompanyType | null;
  gstin: string | null;
  registrationNumber: string | null;
  address: string;
  pincode: string;
  panMasked: string | null;
  aadhaarMasked: string | null;
  bank: {
    accountHolderName: string;
    accountMasked: string | null;
    ifsc: string;
    bankName: string;
    accountType: 'savings' | 'current' | null;
  } | null;
  documents: KycDoc[];
}

const INPUT =
  'w-full px-3.5 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none';
const LABEL = 'block text-xs font-semibold text-on-surface mb-1.5';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 sm:p-6">
      <h2 className="font-semibold text-on-surface mb-4">{title}</h2>
      {children}
    </section>
  );
}

export default function PartnerKycPage() {
  const [kyc, setKyc] = useState<KycView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [form, setForm] = useState({
    entityType: 'company' as EntityType,
    legalName: '',
    companyType: 'private_limited' as CompanyType,
    gstin: '',
    registrationNumber: '',
    address: '',
    pincode: '',
    pan: '',
    aadhaar: '',
    accountHolderName: '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifsc: '',
    bankName: '',
    accountType: 'current' as 'savings' | 'current',
  });
  const [uploading, setUploading] = useState<KycDocKind | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partner/kyc');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const k: KycView = json.data;
      setKyc(k);
      setEditing(k.kycStatus === 'not_submitted' || k.kycStatus === 'rejected');
      // Prefill what we can show back. PAN, Aadhaar and account number are
      // never sent back in full, so they must be typed again.
      setForm((f) => ({
        ...f,
        entityType: k.entityType ?? f.entityType,
        legalName: k.legalName || f.legalName,
        companyType: k.companyType ?? f.companyType,
        gstin: k.gstin ?? '',
        registrationNumber: k.registrationNumber ?? '',
        address: k.address || '',
        pincode: k.pincode || '',
        accountHolderName: k.bank?.accountHolderName ?? '',
        ifsc: k.bank?.ifsc ?? '',
        bankName: k.bank?.bankName ?? '',
        accountType: k.bank?.accountType ?? (k.entityType === 'individual' ? 'savings' : f.accountType),
      }));
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load your KYC.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const isCompany = form.entityType === 'company';
  const required = useMemo(() => requiredDocKinds(form.entityType, !!form.gstin.trim()), [form.entityType, form.gstin]);
  const docsByKind = useMemo(() => {
    const m = new Map<string, KycDoc>();
    (kyc?.documents ?? []).forEach((d) => m.set(d.kind, d));
    return m;
  }, [kyc]);

  const upload = async (kind: KycDocKind, file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(`${KYC_DOC_LABELS[kind]}: the file is larger than 5 MB.`);
      return;
    }
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file);
      const res = await fetch('/api/partner/kyc/documents', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed');
      setKyc((k) =>
        k ? { ...k, kycStatus: json.data.kycStatus, documents: [...k.documents.filter((d) => d.kind !== kind), json.data.document] } : k
      );
    } catch (err: any) {
      setUploadError(`${KYC_DOC_LABELS[kind]}: ${err?.message || 'upload failed'}`);
    } finally {
      setUploading(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const missing = required.filter((k) => !docsByKind.has(k));
    if (missing.length) {
      setError(`Please upload: ${missing.map((k) => KYC_DOC_LABELS[k]).join(', ')}.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/partner/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: form.entityType,
          legalName: form.legalName,
          companyType: isCompany ? form.companyType : null,
          gstin: isCompany ? form.gstin : '',
          registrationNumber: isCompany ? form.registrationNumber : '',
          address: form.address,
          pincode: form.pincode,
          pan: form.pan,
          aadhaar: isCompany ? '' : form.aadhaar,
          bank: {
            accountHolderName: form.accountHolderName,
            accountNumber: form.accountNumber,
            confirmAccountNumber: form.confirmAccountNumber,
            ifsc: form.ifsc,
            bankName: form.bankName,
            accountType: form.accountType,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not submit');
      setKyc(json.data);
      setEditing(false);
      setDone(true);
      setForm((f) => ({ ...f, pan: '', aadhaar: '', accountNumber: '', confirmAccountNumber: '' }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err?.message || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <MaterialIcon name="progress_activity" size={28} className="animate-spin text-primary" />
      </div>
    );
  }
  if (loadError || !kyc) return <p className="text-sm text-error">{loadError}</p>;

  const status = kyc.kycStatus;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-on-surface">KYC & bank details</h1>
        <p className="text-sm text-on-surface-variant">We need these to verify you and pay your commission.</p>
      </div>

      {status === 'submitted' && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-outline-variant bg-primary-fixed/40 p-4">
          <MaterialIcon name="hourglass_top" size={22} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-on-surface">{done ? 'Submitted! ' : ''}Your KYC is under review</p>
            <p className="text-sm text-on-surface-variant">We usually review it within 2 working days and will email you the result.</p>
          </div>
        </div>
      )}
      {status === 'verified' && !editing && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-outline-variant bg-secondary-container/30 p-4">
          <div className="flex items-start gap-3">
            <MaterialIcon name="verified" size={22} className="text-secondary shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-on-surface">Your KYC is verified</p>
              <p className="text-sm text-on-surface-variant">Commissions can be paid to your bank account.</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (confirm('Changing your KYC or bank details sends them for review again. Payouts wait until they are verified. Continue?')) setEditing(true);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-container text-on-surface"
          >
            Change details
          </button>
        </div>
      )}
      {status === 'rejected' && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-outline-variant bg-error-container p-4 text-on-error-container">
          <MaterialIcon name="error" size={22} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Your KYC needs changes</p>
            {kyc.rejectReason && <p className="text-sm">{kyc.rejectReason}</p>}
          </div>
        </div>
      )}

      {!editing ? (
        <Section title="Submitted details">
          <dl className="text-sm grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-2">
            <dt className="text-on-surface-variant">Registered as</dt>
            <dd className="text-on-surface capitalize">{kyc.entityType}{kyc.companyType ? ` · ${COMPANY_TYPE_LABELS[kyc.companyType]}` : ''}</dd>
            <dt className="text-on-surface-variant">Name</dt><dd className="text-on-surface">{kyc.legalName}</dd>
            {kyc.gstin && (<><dt className="text-on-surface-variant">GSTIN</dt><dd className="text-on-surface">{kyc.gstin}</dd></>)}
            <dt className="text-on-surface-variant">PAN</dt><dd className="text-on-surface font-mono">{kyc.panMasked}</dd>
            {kyc.aadhaarMasked && (<><dt className="text-on-surface-variant">Aadhaar</dt><dd className="text-on-surface font-mono">{kyc.aadhaarMasked}</dd></>)}
            <dt className="text-on-surface-variant">Address</dt><dd className="text-on-surface">{kyc.address} – {kyc.pincode}</dd>
            {kyc.bank && (
              <>
                <dt className="text-on-surface-variant">Bank account</dt>
                <dd className="text-on-surface">
                  {kyc.bank.accountHolderName} · <span className="font-mono">{kyc.bank.accountMasked}</span><br />
                  {kyc.bank.bankName} · {kyc.bank.ifsc} · <span className="capitalize">{kyc.bank.accountType}</span>
                </dd>
              </>
            )}
            <dt className="text-on-surface-variant">Documents</dt>
            <dd className="text-on-surface">
              <ul className="space-y-1">
                {kyc.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/partner/kyc/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {d.label}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </dl>
        </Section>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Section title="1. How are you registering?">
            <div className="grid sm:grid-cols-2 gap-3">
              {([
                { v: 'company', t: 'Company / firm', d: 'Agency, LLP, partnership, proprietorship' },
                { v: 'individual', t: 'Individual', d: 'Freelancer or person without a registered business' },
              ] as const).map((o) => (
                <label
                  key={o.v}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer ${
                    form.entityType === o.v ? 'border-primary bg-primary-fixed/40' : 'border-outline-variant'
                  }`}
                >
                  <input
                    type="radio"
                    name="entityType"
                    checked={form.entityType === o.v}
                    onChange={() => setForm((f) => ({ ...f, entityType: o.v, accountType: o.v === 'individual' ? 'savings' : 'current' }))}
                    className="mt-1 accent-primary"
                  />
                  <span>
                    <span className="block font-semibold text-sm text-on-surface">{o.t}</span>
                    <span className="block text-xs text-on-surface-variant">{o.d}</span>
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section title={isCompany ? '2. Company details' : '2. Your details'}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="k-name" className={LABEL}>{isCompany ? 'Legal company name *' : 'Full name as on PAN *'}</label>
                <input id="k-name" value={form.legalName} onChange={set('legalName')} className={INPUT} />
              </div>
              {isCompany && (
                <>
                  <div>
                    <label htmlFor="k-ctype" className={LABEL}>Business type *</label>
                    <select id="k-ctype" value={form.companyType} onChange={set('companyType')} className={INPUT}>
                      {COMPANY_TYPES.map((t) => <option key={t} value={t}>{COMPANY_TYPE_LABELS[t]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="k-gst" className={LABEL}>GSTIN <span className="font-normal text-on-surface-variant">(if registered)</span></label>
                    <input id="k-gst" value={form.gstin} onChange={set('gstin')} className={`${INPUT} uppercase`} placeholder="22ABCDE1234F1Z5" />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="k-reg" className={LABEL}>Registration number <span className="font-normal text-on-surface-variant">(CIN / LLPIN / Udyam / Shop Act — optional)</span></label>
                    <input id="k-reg" value={form.registrationNumber} onChange={set('registrationNumber')} className={INPUT} />
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <label htmlFor="k-addr" className={LABEL}>{isCompany ? 'Registered address *' : 'Address *'}</label>
                <textarea id="k-addr" rows={2} value={form.address} onChange={set('address')} className={INPUT} />
              </div>
              <div>
                <label htmlFor="k-pin" className={LABEL}>PIN code *</label>
                <input id="k-pin" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set('pincode')} className={INPUT} />
              </div>
            </div>
          </Section>

          <Section title="3. Identity">
            {(kyc.panMasked || kyc.aadhaarMasked) && (
              <p className="text-xs text-on-surface-variant mb-3">For your security we never show these in full. Please type them again.</p>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="k-pan" className={LABEL}>{isCompany ? 'Company PAN *' : 'Your PAN *'}</label>
                <input id="k-pan" value={form.pan} onChange={set('pan')} maxLength={10} autoComplete="off" className={`${INPUT} uppercase font-mono`} placeholder={kyc.panMasked ?? 'ABCDE1234F'} />
                {isCompany && <p className="text-[11px] text-on-surface-variant mt-1">Proprietorship: enter the owner’s PAN.</p>}
              </div>
              {!isCompany && (
                <div>
                  <label htmlFor="k-aadhaar" className={LABEL}>Aadhaar number *</label>
                  <input id="k-aadhaar" inputMode="numeric" value={form.aadhaar} onChange={set('aadhaar')} maxLength={14} autoComplete="off" className={`${INPUT} font-mono`} placeholder={kyc.aadhaarMasked ?? '1234 5678 9012'} />
                  <p className="text-[11px] text-on-surface-variant mt-1">We only keep the last 4 digits.</p>
                </div>
              )}
            </div>
          </Section>

          <Section title="4. Bank account for payouts">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="k-holder" className={LABEL}>Account holder name *</label>
                <input id="k-holder" value={form.accountHolderName} onChange={set('accountHolderName')} className={INPUT} />
              </div>
              <div>
                <label htmlFor="k-acc" className={LABEL}>Account number *</label>
                <input id="k-acc" inputMode="numeric" autoComplete="off" value={form.accountNumber} onChange={set('accountNumber')} className={`${INPUT} font-mono`} placeholder={kyc.bank?.accountMasked ?? ''} />
              </div>
              <div>
                <label htmlFor="k-acc2" className={LABEL}>Confirm account number *</label>
                <input id="k-acc2" inputMode="numeric" autoComplete="off" value={form.confirmAccountNumber} onChange={set('confirmAccountNumber')} onPaste={(e) => e.preventDefault()} className={`${INPUT} font-mono`} />
              </div>
              <div>
                <label htmlFor="k-ifsc" className={LABEL}>IFSC code *</label>
                <input id="k-ifsc" value={form.ifsc} onChange={set('ifsc')} maxLength={11} className={`${INPUT} uppercase font-mono`} placeholder="HDFC0001234" />
              </div>
              <div>
                <label htmlFor="k-bank" className={LABEL}>Bank name *</label>
                <input id="k-bank" value={form.bankName} onChange={set('bankName')} className={INPUT} />
              </div>
              <div>
                <label htmlFor="k-atype" className={LABEL}>Account type *</label>
                <select id="k-atype" value={form.accountType} onChange={set('accountType')} className={INPUT}>
                  <option value="current">Current</option>
                  <option value="savings">Savings</option>
                </select>
              </div>
            </div>
          </Section>

          <Section title="5. Documents">
            <p className="text-xs text-on-surface-variant mb-4">JPG, PNG, WEBP or PDF, up to 5 MB each. Files are stored encrypted.</p>
            <ul className="divide-y divide-outline-variant">
              {required.map((kind) => {
                const doc = docsByKind.get(kind);
                return (
                  <li key={kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{KYC_DOC_LABELS[kind]}</p>
                      {doc ? (
                        <a href={`/api/partner/kyc/documents/${doc.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all">
                          <MaterialIcon name="check_circle" size={12} className="inline align-[-2px] mr-1" />
                          {doc.fileName || 'Uploaded'}
                        </a>
                      ) : (
                        <p className="text-xs text-on-surface-variant">Not uploaded</p>
                      )}
                    </div>
                    <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer min-h-11 ${doc ? 'bg-surface-container text-on-surface' : 'bg-primary text-on-primary'}`}>
                      {uploading === kind ? (
                        <MaterialIcon name="progress_activity" size={16} className="animate-spin" />
                      ) : (
                        <MaterialIcon name="upload" size={16} />
                      )}
                      {doc ? 'Replace' : 'Upload'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="sr-only"
                        disabled={uploading !== null}
                        onChange={(e) => { upload(kind, e.target.files?.[0]); e.target.value = ''; }}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
            {uploadError && <p role="alert" className="mt-3 text-sm text-error">{uploadError}</p>}
          </Section>

          {error && (
            <div role="alert" className="flex items-start gap-2 px-4 py-3 bg-error-container rounded-lg text-on-error-container text-sm">
              <MaterialIcon name="error" size={18} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={submitting || uploading !== null}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-lg font-bold disabled:opacity-60 min-h-11"
            >
              {submitting && <MaterialIcon name="progress_activity" size={16} className="animate-spin" />}
              Submit for verification
            </button>
            {status === 'verified' && (
              <button type="button" onClick={() => setEditing(false)} className="px-6 py-3 rounded-lg font-medium bg-surface-container min-h-11">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
