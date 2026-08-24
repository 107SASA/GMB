'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { WhatsAppIcon } from '@/components/ui/WhatsAppIcon';
import { BusinessAutocomplete, type SelectedBusiness } from '@/components/shared/BusinessAutocomplete';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { bookDemoLink, bookDemoOpensWhatsApp } from '@/lib/whatsappCta';

// "On this call" agenda — replaces the old plain checkmark benefit list
// with the same coded ink-panel device used on Free Report, so the two
// lead-gen forms share one visual language (Aug 2026 redesign).
const AGENDA = [
  { title: 'Your profile score', detail: 'See exactly where your Google Business Profile stands today' },
  { title: 'Live agent demo', detail: 'Watch the AI post, reply to reviews, and qualify a WhatsApp lead' },
  { title: 'Pricing & next steps', detail: 'No pressure — decide anything after you’ve seen it working' },
] as const;

const BUDGET_OPTIONS = ['More than ₹5000', '₹3000 - ₹5000', 'Less than ₹3000'] as const;

export default function BookDemoPage() {
  return (
    <Suspense fallback={null}>
      <BookDemoForm />
    </Suspense>
  );
}

function BookDemoForm() {
  const searchParams = useSearchParams();
  const origin = searchParams.get('origin') || 'book-demo-page';

  const [business, setBusiness] = useState<SelectedBusiness | null>(null);
  const [phone, setPhone] = useState('+91');
  const [budget, setBudget] = useState<string>(BUDGET_OPTIONS[1]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const goToWhatsApp = () => {
    const link = bookDemoLink();
    if (bookDemoOpensWhatsApp) {
      window.open(link, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = link;
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!business) {
      setError('Please search for and select your business.');
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      setError('Please enter a valid phone number.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/leads/book-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: business.name, businessName: business.name, phone, budget, origin }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
      setSubmitting(false);
      setTimeout(goToWhatsApp, 1800);
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="theme-marketing min-h-screen bg-(--mkt-surface) selection:bg-primary-fixed">
      <Navbar />

      <section className="relative pt-24 sm:pt-28 md:pt-32 pb-14 sm:pb-20 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto grid lg:grid-cols-2 gap-8 lg:gap-16 items-start">
          {/* Left: value props */}
          <div className="lg:pt-8 order-2 lg:order-1">
            <p className="mkt-label flex items-center gap-3 text-[#6b756f] mb-4 sm:mb-5">
              <span className="w-6 h-px bg-[#006e2c]" />
              Built for local businesses across India
            </p>
            <h1 className="font-mkt-display text-[1.75rem] sm:text-4xl md:text-5xl font-semibold text-[#101613] mb-6 sm:mb-10 leading-[1.15] tracking-tight">
              What can <span className="text-[#006e2c]">Growwmatics</span> do for you?
            </h1>
            <div className="mkt-ink-panel rounded-xl border border-(--mkt-ink-border) overflow-hidden max-w-md">
              <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-(--mkt-ink-border)">
                <span className="mkt-label text-(--mkt-ink-text-dim)">On this call</span>
                <span className="mkt-label flex items-center gap-1 px-2 py-0.5 rounded bg-(--mkt-ink-elevated) text-(--mkt-ink-text-dim)">
                  <MaterialIcon name="schedule" size={12} />
                  ~15 min
                </span>
              </div>
              <ul className="p-4 sm:p-5 flex flex-col gap-2.5">
                {AGENDA.map((item, i) => (
                  <li
                    key={item.title}
                    className="flex items-start gap-3 rounded-lg bg-(--mkt-ink-elevated) border border-(--mkt-ink-border) px-3 py-2.5"
                  >
                    <span className="font-mkt-mono text-[10px] text-[#4ade80] shrink-0 mt-0.5">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-(--mkt-ink-text)">{item.title}</p>
                      <p className="text-xs text-(--mkt-ink-text-dim) leading-relaxed">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-(--mkt-ink-text-dim) text-center pb-4 px-4">
                Free — no credit card needed
              </p>
            </div>
          </div>

          {/* Right: form card — first on mobile */}
          <div className="bg-white rounded-xl shadow-card border border-(--mkt-line) p-5 sm:p-8 md:p-10 order-1 lg:order-2">
            {submitted ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-xl bg-[#e8f8ee] flex items-center justify-center mx-auto mb-5">
                  <MaterialIcon name="check" size={32} className="text-[#006e2c]" />
                </div>
                <h2 className="font-mkt-display text-xl font-semibold text-[#101613] mb-2">Thank you!</h2>
                <p className="text-[#3d4a3d] text-sm mb-6">
                  Taking you to WhatsApp to finish booking your demo…
                </p>
                <button
                  type="button"
                  onClick={goToWhatsApp}
                  className="w-full py-3 bg-[#25D366] text-white rounded-lg font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
                >
                  <WhatsAppIcon size={18} />
                  Continue Now
                </button>
              </div>
            ) : (
              <>
                <h2 className="font-mkt-display text-xl md:text-2xl font-semibold text-[#101613] mb-8">
                  Ready to see it in action? Book a free demo!
                </h2>

                <div className="space-y-5">
                  <div>
                    <label className="mkt-label block text-[#101613] mb-2">Business Details *</label>
                    <BusinessAutocomplete selected={business} onSelect={setBusiness} onClear={() => setBusiness(null)} />
                  </div>

                  <div>
                    <label className="mkt-label block text-[#101613] mb-2">Phone Number *</label>
                    <PhoneNumberInput value={phone} onChange={setPhone} />
                  </div>

                  <div>
                    <label className="mkt-label block text-[#101613] mb-2">Monthly Budget *</label>
                    <p className="text-xs text-[#3d4a3d] mb-3">
                      How much are you willing to spend on digital marketing?
                    </p>
                    <div className="space-y-2.5">
                      {BUDGET_OPTIONS.map((opt) => (
                        <label
                          key={opt}
                          className={`flex items-center gap-3 px-4 py-3.5 border rounded-lg cursor-pointer transition-colors ${
                            budget === opt
                              ? 'border-[#006e2c] bg-[#f0fff5]'
                              : 'border-(--mkt-line) hover:bg-(--mkt-surface)'
                          }`}
                        >
                          <input
                            type="radio"
                            name="budget"
                            value={opt}
                            checked={budget === opt}
                            onChange={() => setBudget(opt)}
                            className="w-4 h-4 accent-[#006e2c]"
                          />
                          <span className="text-sm text-[#101613]">{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="p-4 bg-error-container text-on-error-container rounded-lg text-sm font-medium border border-error-container flex items-start gap-3"
                    >
                      <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5 text-on-error-container" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-[#006e2c] text-white rounded-lg font-bold hover:bg-[#005a24] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
                >
                    {submitting ? (
                      <MaterialIcon name="progress_activity" size={16} className="animate-spin text-white" />
                    ) : (
                      <>
                        Submit
                        <MaterialIcon name="arrow_forward" size={16} className="text-white" />
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
