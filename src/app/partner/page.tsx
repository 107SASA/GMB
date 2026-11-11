import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveGrowthPartner } from '@/lib/partners/partnerAuth';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

const KYC_LABEL: Record<string, { text: string; tone: string }> = {
  not_submitted: { text: 'Not submitted', tone: 'bg-surface-container text-on-surface-variant' },
  submitted: { text: 'Under review', tone: 'bg-primary-fixed text-primary' },
  verified: { text: 'Verified', tone: 'bg-secondary-container/50 text-secondary' },
  rejected: { text: 'Needs changes', tone: 'bg-error-container text-on-error-container' },
};

export default async function PartnerOverviewPage() {
  const auth = await resolveGrowthPartner();
  if (!auth.ok) redirect('/partner-login');
  const p = auth.partner;
  const kyc = KYC_LABEL[p.kycStatus] ?? KYC_LABEL.not_submitted;

  const terms = [
    { label: 'First payment', value: `${p.firstPaymentRate}%`, hint: "of the customer's first payment" },
    {
      label: 'Recurring',
      value: `${p.recurringRate}%`,
      hint: p.recurringMonths ? `of each renewal, for ${p.recurringMonths} months` : 'of every renewal, no time limit',
    },
    { label: 'Hold period', value: `${p.holdDays} days`, hint: 'after a payment, before payout' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-on-surface">Welcome, {p.fullName.split(' ')[0]}</h1>
        <p className="text-sm text-on-surface-variant">{p.companyName} · Growth Partner</p>
      </div>

      {p.kycStatus !== 'verified' && (
        <Link
          href="/partner/kyc"
          className="mb-6 flex items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 hover:border-primary transition-colors"
        >
          <MaterialIcon name="badge" size={22} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-on-surface">
              {p.kycStatus === 'submitted'
                ? 'Your KYC is under review'
                : p.kycStatus === 'rejected'
                  ? 'Your KYC needs changes'
                  : 'Complete your KYC to receive payouts'}
            </p>
            <p className="text-sm text-on-surface-variant">
              {p.kycStatus === 'submitted'
                ? 'We will email you once it is verified.'
                : 'Add your company or personal documents and bank details so we can pay your commission.'}
            </p>
          </div>
          <MaterialIcon name="chevron_right" size={20} className="text-outline shrink-0 mt-0.5" />
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        {terms.map((t) => (
          <div key={t.label} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">{t.label}</p>
            <p className="font-heading text-3xl font-bold text-on-surface mt-1">{t.value}</p>
            <p className="text-xs text-on-surface-variant mt-1">{t.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Your partner code</p>
          <p className="font-mono text-2xl font-bold text-primary">{p.partnerCode}</p>
          <p className="text-xs text-on-surface-variant mt-2">Share this code with businesses you bring to us.</p>
        </div>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Your details</p>
            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${kyc.tone}`}>KYC: {kyc.text}</span>
          </div>
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-on-surface-variant">Email</dt><dd className="text-on-surface break-all">{p.email}</dd>
            <dt className="text-on-surface-variant">Mobile</dt><dd className="text-on-surface">{p.phone}</dd>
            <dt className="text-on-surface-variant">Location</dt><dd className="text-on-surface">{p.city}, {p.state}</dd>
            {p.website && (<><dt className="text-on-surface-variant">Website</dt><dd className="text-on-surface break-all">{p.website}</dd></>)}
          </dl>
        </div>
      </div>
    </div>
  );
}
