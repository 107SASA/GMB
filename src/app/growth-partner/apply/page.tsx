'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { APPLICANT_TYPES, APPLICANT_TYPE_LABELS, type ApplicantType } from '@/lib/partners/partnerRules';

const INPUT =
  'w-full px-4 py-3.5 bg-surface border border-outline-variant rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none text-base';

export default function GrowthPartnerApplyPage() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '+91',
    companyName: '',
    website: '',
    city: '',
    state: '',
    applicantType: 'agency' as ApplicantType,
    message: '',
    companyUrl: '', // honeypot
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/growth-partner/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <section className="relative pt-24 sm:pt-28 md:pt-32 pb-14 sm:pb-20 px-4 sm:px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          <Link href="/growth-partner" className="inline-flex items-center gap-1 text-sm text-[#3d4a3d] hover:text-[#006e2c] mb-5 min-h-11">
            <MaterialIcon name="arrow_back" size={16} />
            Growth Partner Program
          </Link>

          <div className="bg-white rounded-xl shadow-card border border-(--mkt-line) p-5 sm:p-8 md:p-10">
            {submitted ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-xl bg-[#e8f8ee] flex items-center justify-center mx-auto mb-5">
                  <MaterialIcon name="check" size={32} className="text-[#006e2c]" />
                </div>
                <h1 className="font-mkt-display text-xl font-semibold text-[#101613] mb-2">Application received!</h1>
                <p className="text-[#3d4a3d] text-sm mb-6">
                  Our team will review it and email you at <strong>{form.email}</strong>, usually within 2 working days.
                  Once approved, you&apos;ll get a link to create your partner account.
                </p>
                <Link
                  href="/"
                  className="inline-flex items-center justify-center w-full py-3 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all min-h-[48px]"
                >
                  Back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <h1 className="font-mkt-display text-xl md:text-2xl font-semibold text-[#101613] mb-2">
                  Apply to become a Growth Partner
                </h1>
                <p className="text-sm text-[#3d4a3d] mb-8">Fill in your details and our team will get back to you.</p>

                <div className="space-y-5">
                  <div>
                    <label htmlFor="gp-type" className="mkt-label block text-[#101613] mb-2">I am a *</label>
                    <select
                      id="gp-type"
                      value={form.applicantType}
                      onChange={(e) => set('applicantType')(e.target.value)}
                      className={INPUT}
                    >
                      {APPLICANT_TYPES.map((t) => (
                        <option key={t} value={t}>{APPLICANT_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="gp-name" className="mkt-label block text-[#101613] mb-2">Full name *</label>
                    <input id="gp-name" type="text" value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} autoComplete="name" placeholder="Your full name" className={INPUT} />
                  </div>

                  <div>
                    <label htmlFor="gp-email" className="mkt-label block text-[#101613] mb-2">Email *</label>
                    <input id="gp-email" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" placeholder="you@company.com" className={INPUT} />
                    <p className="text-xs text-[#6b756f] mt-1.5">Your partner account will be created with this email.</p>
                  </div>

                  <div>
                    <label className="mkt-label block text-[#101613] mb-2">Mobile number *</label>
                    <PhoneNumberInput value={form.phone} onChange={set('phone')} />
                  </div>

                  <div>
                    <label htmlFor="gp-company" className="mkt-label block text-[#101613] mb-2">
                      {form.applicantType === 'individual' ? 'Business / trade name *' : 'Company name *'}
                    </label>
                    <input id="gp-company" type="text" value={form.companyName} onChange={(e) => set('companyName')(e.target.value)} autoComplete="organization" placeholder="Company name" className={INPUT} />
                  </div>

                  <div>
                    <label htmlFor="gp-website" className="mkt-label block text-[#101613] mb-2">
                      Website <span className="normal-case font-normal text-[#6b756f]">(optional)</span>
                    </label>
                    <input id="gp-website" type="url" inputMode="url" value={form.website} onChange={(e) => set('website')(e.target.value)} autoComplete="url" placeholder="www.youragency.com" className={INPUT} />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="gp-city" className="mkt-label block text-[#101613] mb-2">City *</label>
                      <input id="gp-city" type="text" value={form.city} onChange={(e) => set('city')(e.target.value)} autoComplete="address-level2" placeholder="City" className={INPUT} />
                    </div>
                    <div>
                      <label htmlFor="gp-state" className="mkt-label block text-[#101613] mb-2">State *</label>
                      <input id="gp-state" type="text" value={form.state} onChange={(e) => set('state')(e.target.value)} autoComplete="address-level1" placeholder="State" className={INPUT} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="gp-message" className="mkt-label block text-[#101613] mb-2">
                      Tell us about your work <span className="normal-case font-normal text-[#6b756f]">(optional)</span>
                    </label>
                    <textarea id="gp-message" value={form.message} onChange={(e) => set('message')(e.target.value)} rows={4} maxLength={1000} placeholder="e.g. how many local business clients you work with" className={INPUT} />
                  </div>

                  {/* Honeypot — hidden from people, filled by bots. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
                    <label htmlFor="gp-company-url">Company URL</label>
                    <input id="gp-company-url" type="text" tabIndex={-1} autoComplete="off" value={form.companyUrl} onChange={(e) => set('companyUrl')(e.target.value)} />
                  </div>

                  {error && (
                    <div role="alert" className="p-4 bg-error-container text-on-error-container rounded-lg text-sm font-medium border border-error-container flex items-start gap-3">
                      <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5 text-on-error-container" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
                  >
                    {submitting ? (
                      <MaterialIcon name="progress_activity" size={16} className="animate-spin text-white" />
                    ) : (
                      <>
                        Submit application
                        <MaterialIcon name="arrow_forward" size={16} className="text-white" />
                      </>
                    )}
                  </button>
                  <p className="text-xs text-[#6b756f] text-center">
                    Already a partner? <Link href="/partner-login" className="text-[#006e2c] font-semibold">Sign in</Link>
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      <Footer hideBoosterPromo />
    </main>
  );
}
