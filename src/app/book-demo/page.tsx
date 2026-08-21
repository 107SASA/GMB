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

const BENEFITS = [
  { title: 'Rank #1 on Google', copy: 'More calls & walk-ins from local search' },
  { title: 'Never miss a lead', copy: 'AI replies to every WhatsApp message instantly' },
  { title: 'Close more sales', copy: 'Qualify leads and book appointments automatically' },
  { title: 'Bring customers back', copy: 'Auto-scheduled content and repeat booking prompts' },
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
    <main className="theme-marketing min-h-screen bg-[#f7faf8] selection:bg-primary-fixed">
      <Navbar />

      <section className="pt-24 sm:pt-28 md:pt-32 pb-14 sm:pb-20 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto grid lg:grid-cols-2 gap-8 lg:gap-16 items-start">
          {/* Left: value props */}
          <div className="lg:pt-8 order-2 lg:order-1">
            <p className="flex items-center gap-3 text-sm font-medium text-[#3d4a3d] mb-4 sm:mb-5">
              <span className="w-6 h-px bg-[#06b34c]" />
              Built for local businesses across India
            </p>
            <h1 className="font-heading text-[1.75rem] sm:text-4xl md:text-5xl font-bold text-[#181c1c] mb-6 sm:mb-10 leading-[1.15] tracking-tight">
              What can <span className="text-[#006e2c]">GrowwMatics AI</span> do for you?
            </h1>
            <ul className="space-y-4 sm:space-y-6">
              {BENEFITS.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <span className="text-[#06b34c] font-bold text-lg leading-none mt-0.5">✓</span>
                  <div>
                    <span className="font-bold text-[#181c1c]">{b.title}</span>
                    <span className="text-[#3d4a3d] text-sm sm:text-base"> — {b.copy}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: form card — first on mobile */}
          <div className="bg-white rounded-2xl shadow-lg border border-[#e0e3e1] p-5 sm:p-8 md:p-10 order-1 lg:order-2">
            {submitted ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-[#e8f8ee] flex items-center justify-center mx-auto mb-5">
                  <MaterialIcon name="check" size={32} className="text-[#006e2c]" />
                </div>
                <h2 className="font-heading text-xl font-bold text-[#181c1c] mb-2">Thank you!</h2>
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
                <h2 className="font-heading text-xl md:text-2xl font-bold text-[#181c1c] mb-8">
                  Ready to see it in action? Book a free demo!
                </h2>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-bold text-[#181c1c] mb-2">Business Details *</label>
                    <BusinessAutocomplete selected={business} onSelect={setBusiness} onClear={() => setBusiness(null)} />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-[#181c1c] mb-2">Phone Number *</label>
                    <PhoneNumberInput value={phone} onChange={setPhone} />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-[#181c1c] mb-2">Monthly Budget *</label>
                    <p className="text-xs text-[#3d4a3d] mb-3">
                      How much are you willing to spend on digital marketing?
                    </p>
                    <div className="space-y-2.5">
                      {BUDGET_OPTIONS.map((opt) => (
                        <label
                          key={opt}
                          className={`flex items-center gap-3 px-4 py-3.5 border rounded-lg cursor-pointer transition-colors ${
                            budget === opt
                              ? 'border-[#06b34c] bg-[#f0fff5]'
                              : 'border-[#e0e3e1] hover:bg-[#f7faf8]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="budget"
                            value={opt}
                            checked={budget === opt}
                            onChange={() => setBudget(opt)}
                            className="w-4 h-4 accent-[#06b34c]"
                          />
                          <span className="text-sm text-[#181c1c]">{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="p-4 bg-error-container text-on-error-container rounded-xl text-sm font-medium border border-error-container flex items-start gap-3"
                    >
                      <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5 text-on-error-container" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-[#06b34c] text-white rounded-lg font-bold hover:bg-[#059640] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
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
