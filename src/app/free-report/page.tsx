'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BusinessAutocomplete, type SelectedBusiness } from '@/components/shared/BusinessAutocomplete';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';

const BENEFIT_ROWS = [
  { icon: 'emoji_events', title: 'Rank #1 on Google', copy: 'More calls & walk-ins' },
  { icon: 'star', title: 'More 5-star reviews', copy: 'Win customer trust' },
  { icon: 'photo_camera', title: 'Beat local competitors', copy: 'Customers pick you first' },
  { icon: 'monitoring', title: 'Grow without an agency', copy: 'Save time & money' },
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
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed overflow-x-clip">
      <Navbar />

      <section className="relative pt-20 sm:pt-24 md:pt-28 pb-8 sm:pb-12 px-4 sm:px-6 md:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(6,179,76,0.08),_transparent_55%)]"
        />

        <div className="relative max-w-[720px] lg:max-w-[1100px] mx-auto grid lg:grid-cols-12 gap-6 lg:gap-10 items-start">
          {/* Intro */}
          <div className="lg:col-span-7 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#06b34c]/35 bg-white/80 text-[#006e2c] text-xs sm:text-sm font-semibold mb-4">
              <MaterialIcon name="verified" size={16} className="text-[#06b34c]" />
              Built for local businesses across India
            </div>

            <h1 className="font-heading text-[1.5rem] leading-[1.25] sm:text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold text-[#181c1c] tracking-tight mb-3 sm:mb-4">
              Grow your business from <GoogleWord /> with{' '}
              <span className="text-[#06b34c]">GrowwMatics AI</span>
            </h1>
            <div className="mb-4 sm:mb-5">
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-[#e8f8ee] text-[#006e2c] text-[0.7rem] sm:text-xs font-bold uppercase tracking-wide">
                Free Rank Report
              </span>
            </div>

            <ul className="space-y-2 sm:space-y-2.5 text-left">
              {BENEFIT_ROWS.map((row) => (
                <li
                  key={row.title}
                  className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl bg-white border border-[#e0e3e1] shadow-sm"
                >
                  <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-[#e8f8ee] flex items-center justify-center shrink-0">
                    <MaterialIcon name={row.icon} size={18} className="text-[#06b34c]" />
                  </span>
                  <p className="min-w-0 text-[13px] sm:text-sm text-[#181c1c] leading-snug">
                    <span className="font-semibold">{row.title}</span>
                    <span className="text-[#3d4a3d]"> → {row.copy}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Form — sticky on desktop */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
          <div className="bg-[#eef9f2] sm:bg-white rounded-2xl border border-[#c8ebd4] sm:border-[#e0e3e1] shadow-md sm:shadow-lg p-4 sm:p-7 md:p-8">
            <div className="flex items-center gap-3 mb-5 sm:mb-7">
              <span className="flex-1 h-px bg-[#c8ebd4] sm:bg-[#e0e3e1]" />
              <h2 className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-[#3d4a3d] text-center px-1">
                Get your free GBP report
              </h2>
              <span className="flex-1 h-px bg-[#c8ebd4] sm:bg-[#e0e3e1]" />
            </div>

            <div className="space-y-5 sm:space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-[#06b34c] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <label className="text-sm font-bold text-[#181c1c]">Find your business on Google</label>
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
                  <span className="w-6 h-6 rounded-full bg-[#06b34c] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <label className="text-sm font-bold text-[#181c1c]">Your WhatsApp number</label>
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
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#06b34c] text-white rounded-lg font-bold hover:bg-[#059640] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] text-base"
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
          <div className="rounded-2xl border border-[#e0e3e1] bg-white shadow-sm p-4 sm:p-8 md:p-10">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8 mb-6 sm:mb-10">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-xl sm:text-3xl md:text-4xl font-extrabold text-[#06b34c] mb-0.5 sm:mb-1">
                    {stat.value}
                  </div>
                  <div className="text-[11px] sm:text-xs text-[#3d4a3d] leading-snug">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
              <span className="flex-1 h-px bg-[#e0e3e1]" />
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#3d4a3d] text-center shrink-0">
                Works for any business
              </span>
              <span className="flex-1 h-px bg-[#e0e3e1]" />
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
