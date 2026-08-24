'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BusinessAutocomplete, type SelectedBusiness } from '@/components/shared/BusinessAutocomplete';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';

// Illustrative sample only (explicitly labeled "Sample" in the UI) — the
// fields mirror what the real audit actually checks (photo freshness,
// keyword-gap analysis, review response rate — see free-report/result's
// AuditDoc.auditData), not invented categories, but the numbers/business
// are not real. Left column used to be a static benefit-row list; this
// shows the product's own report format instead, per the Aug 2026 "Live
// preview panel" redesign.
const SAMPLE_ISSUES = [
  { icon: 'photo_camera', title: 'Photos haven’t been updated', detail: '8+ months since the last upload' },
  { icon: 'search_off', title: '3 keywords missing', detail: 'Not found anywhere on the profile' },
  { icon: 'forum', title: '42% of reviews unanswered', detail: 'No reply in the last 90 days' },
] as const;

const STATS = [
  { value: '3.6 L+', label: 'Indian businesses' },
  { value: '30 sec', label: 'Time to get report' },
  { value: '50%', label: 'More Google calls' },
  { value: '100%', label: 'Free report' },
] as const;

const NICHES = [
  'Salons',
  'Clinics',
  'Gyms',
  'Restaurant',
  'Pest Control',
  'Tours & Travels',
  'Car Garages & Mechanics',
  'Handyman Services',
  'Yoga & Wellness',
  'And many more',
] as const;

function GoogleWord() {
  const letters = [
    { ch: 'G', color: '#4285F4' },
    { ch: 'o', color: '#EA4335' },
    { ch: 'o', color: '#FBBC05' },
    { ch: 'g', color: '#4285F4' },
    { ch: 'l', color: '#34A853' },
    { ch: 'e', color: '#EA4335' },
  ];
  return (
    <span className="inline whitespace-nowrap">
      {letters.map((l, i) => (
        <span key={`${l.ch}-${i}`} style={{ color: l.color }}>
          {l.ch}
        </span>
      ))}
    </span>
  );
}

export default function FreeReportPage() {
  const router = useRouter();

  const [selected, setSelected] = useState<SelectedBusiness | null>(null);
  const [phone, setPhone] = useState('+91');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError('');
    const business = selected;
    if (!business) {
      setError('Please search for and select your business.');
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      setError('Please enter a valid WhatsApp number.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/free-report/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: business.name,
          category: business.category,
          address: business.address,
          area: business.area,
          city: business.city,
          state: business.state,
          country: business.country,
          businessPhone: business.phone,
          website: business.website,
          googlePlaceId: business.googlePlaceId,
          googleMapsUrl: business.googleMapsUrl,
          latitude: business.latitude,
          longitude: business.longitude,
          placesRating: business.rating,
          placesReviewCount: business.totalReviews,
          editorialSummary: business.editorialSummary,
          photoCount: business.photoCount,
          hasHours: business.hasHours,
          googleTypes: business.googleTypes,
          phone,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      router.push(`/free-report/result?auditId=${json.auditId}`);
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed overflow-x-clip">
      <Navbar />

      <section className="relative pt-20 sm:pt-24 md:pt-28 pb-8 sm:pb-12 px-4 sm:px-6 md:px-12">

        <div className="relative max-w-[720px] lg:max-w-[1100px] mx-auto grid lg:grid-cols-12 gap-6 lg:gap-10 items-start">
          {/* Intro */}
          <div className="lg:col-span-7 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#006e2c]/35 bg-white/80 text-[#006e2c] text-xs sm:text-sm font-semibold mb-4">
              <MaterialIcon name="verified" size={16} className="text-[#006e2c]" />
              Built for local businesses across India
            </div>

            <h1 className="font-mkt-display text-[1.5rem] leading-[1.25] sm:text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold text-[#101613] tracking-tight mb-3 sm:mb-4">
              Grow your business from <GoogleWord /> with{' '}
              <span className="text-[#006e2c]">GrowwMatics AI</span>
            </h1>
            <div className="mb-4 sm:mb-5">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#e8f8ee] text-[#006e2c] text-[0.7rem] sm:text-xs font-bold uppercase tracking-wide">
                Free Rank Report
              </span>
            </div>

            {/* Live preview of what the free report looks like */}
            <div className="mkt-ink-panel rounded-xl border border-(--mkt-ink-border) overflow-hidden max-w-md mx-auto lg:mx-0">
              <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-(--mkt-ink-border)">
                <span className="mkt-label text-(--mkt-ink-text-dim)">Sample Report</span>
                <span className="mkt-label px-2 py-0.5 rounded bg-(--mkt-ink-elevated) text-(--mkt-ink-text-dim)">Preview</span>
              </div>
              <div className="p-4 sm:p-5 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <svg width={52} height={52} viewBox="0 0 52 52" className="shrink-0 -rotate-90">
                    <circle cx="26" cy="26" r="20" fill="none" stroke="var(--mkt-ink-border)" strokeWidth="4" />
                    <circle
                      cx="26" cy="26" r="20" fill="none" stroke="var(--color-warning)" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 20}
                      strokeDashoffset={2 * Math.PI * 20 * (1 - 61 / 100)}
                    />
                  </svg>
                  <div>
                    <p className="mkt-label text-(--mkt-ink-text-dim) mb-1">Profile Score</p>
                    <p className="font-mkt-mono text-2xl font-semibold text-(--mkt-ink-text) leading-none">
                      61<span className="text-sm text-(--mkt-ink-text-dim)">/100</span>
                    </p>
                  </div>
                </div>
                <ul className="flex flex-col gap-2">
                  {SAMPLE_ISSUES.map((issue) => (
                    <li
                      key={issue.title}
                      className="flex items-center gap-3 rounded-lg bg-(--mkt-ink-elevated) border border-(--mkt-ink-border) px-3 py-2.5"
                    >
                      <MaterialIcon name={issue.icon} size={16} className="text-warning shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-(--mkt-ink-text) truncate">{issue.title}</p>
                        <p className="text-xs text-(--mkt-ink-text-dim) truncate">{issue.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-(--mkt-ink-text-dim) text-center pt-1">
                  Your report will include 12+ more checks like these.
                </p>
              </div>
            </div>
          </div>

          {/* Form — sticky on desktop */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
          <div className="bg-[#eef9f2] sm:bg-white rounded-xl border border-[#c8ebd4] sm:border-(--mkt-line) shadow-md sm:shadow-lg p-4 sm:p-7 md:p-8">
            <div className="flex items-center gap-3 mb-5 sm:mb-7">
              <span className="flex-1 h-px bg-[#c8ebd4] sm:bg-(--mkt-line)" />
              <h2 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-[#3d4a3d] text-center px-1">
                Get your free GBP report
              </h2>
              <span className="flex-1 h-px bg-[#c8ebd4] sm:bg-(--mkt-line)" />
            </div>

            <div className="space-y-5 sm:space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-md bg-[#006e2c] text-white font-mkt-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <label className="text-sm font-bold text-[#101613]">Find your business on Google</label>
                </div>
                <BusinessAutocomplete
                  selected={selected}
                  onSelect={setSelected}
                  onClear={() => setSelected(null)}
                  placeholder="Start typing your business name…"
                />
                <p className="text-xs text-[#3d4a3d] mt-2">
                  Type the name, then pick your business from the list.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-md bg-[#006e2c] text-white font-mkt-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <label className="text-sm font-bold text-[#101613]">Your WhatsApp number</label>
                </div>
                <PhoneNumberInput value={phone} onChange={setPhone} placeholder="Phone number" />
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3.5 sm:p-4 bg-error-container text-on-error-container rounded-xl text-sm font-medium border border-error-container flex items-start gap-3"
                >
                  <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5 text-on-error-container" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] text-base"
              >
                {submitting ? (
                  <>
                    <MaterialIcon name="progress_activity" size={16} className="animate-spin text-white" />
                    Generating your report…
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </div>
          </div>
        </div>
      </section>

      <section className="pb-10 sm:pb-16 px-4 sm:px-6 md:px-12">
        <div className="max-w-[720px] lg:max-w-[1100px] mx-auto">
          <div className="rounded-xl border border-(--mkt-line) bg-white shadow-sm p-4 sm:p-8 md:p-10">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8 mb-6 sm:mb-10">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="font-mkt-mono text-xl sm:text-3xl md:text-4xl font-semibold text-[#006e2c] mb-0.5 sm:mb-1">
                    {stat.value}
                  </div>
                  <div className="mkt-label text-[#6b756f] leading-snug">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
              <span className="flex-1 h-px bg-(--mkt-line)" />
              <span className="mkt-label text-[#6b756f] text-center shrink-0">
                Works for any business
              </span>
              <span className="flex-1 h-px bg-(--mkt-line)" />
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              {NICHES.map((niche) => (
                <span
                  key={niche}
                  className={`px-2.5 sm:px-4 py-1.5 rounded-full text-[11px] sm:text-sm font-medium ${
                    niche === 'And many more'
                      ? 'bg-[#f0f2f1] text-[#3d4a3d]'
                      : 'bg-[#e8f8ee] text-[#006e2c]'
                  }`}
                >
                  {niche}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
