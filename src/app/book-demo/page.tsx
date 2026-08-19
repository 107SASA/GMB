'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BusinessAutocomplete, type SelectedBusiness } from '@/components/shared/BusinessAutocomplete';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { bookDemoLink, bookDemoOpensWhatsApp } from '@/lib/whatsappCta';

const BENEFITS = [
  { icon: 'trending_up', title: 'Rank higher on Google', copy: 'More calls & walk-ins from local search' },
  { icon: 'chat', title: 'Never miss a lead', copy: 'AI replies to every WhatsApp message instantly' },
  { icon: 'star', title: 'Win more 5-star reviews', copy: 'Automated review requests and replies' },
  { icon: 'calendar_month', title: 'Bring customers back', copy: 'Auto-scheduled content, easy repeat bookings' },
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
      // Give the visitor a moment to read the confirmation before handing off
      // to WhatsApp — matches the old modal's "thank you" step.
      setTimeout(goToWhatsApp, 1800);
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center px-4 py-24">
      <div className="max-w-6xl mx-auto w-full grid lg:grid-cols-2 gap-16 items-center">
        {/* Left: value props */}
        <div>
          <p className="text-sm font-medium text-on-surface-variant mb-4">
            Trusted by local businesses across India
          </p>
          <h1 className="font-heading text-4xl sm:text-5xl font-bold text-on-surface mb-8 leading-tight">
            What can <span className="text-primary">GrowwMatics AI</span> do for you?
          </h1>
          <ul className="space-y-5">
            {BENEFITS.map((b) => (
              <li key={b.title} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center shrink-0">
                  <MaterialIcon name={b.icon} size={20} className="text-primary" />
                </div>
                <div>
                  <div className="font-bold text-on-surface">{b.title}</div>
                  <div className="text-sm text-on-surface-variant mt-0.5">{b.copy}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: form card */}
        <div className="bg-surface-container-lowest rounded-2xl card-shadow border border-outline-variant p-8 sm:p-10">
          {submitted ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center mx-auto mb-5">
                <MaterialIcon name="check" size={32} className="text-on-secondary-container" />
              </div>
              <h2 className="font-heading text-xl font-bold text-on-surface mb-2">Thank you!</h2>
              <p className="text-on-surface-variant text-sm mb-6">
                Taking you to WhatsApp to finish booking your demo…
              </p>
              <button
                type="button"
                onClick={goToWhatsApp}
                className="w-full py-3 bg-whatsapp text-white rounded-lg font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <MaterialIcon name="chat" size={18} />
                Continue Now
              </button>
            </div>
          ) : (
            <>
              <h2 className="font-heading text-2xl font-bold text-on-surface mb-6">
                Ready to see it in action? Book a free demo!
              </h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-on-surface mb-2">Business Details *</label>
                  <BusinessAutocomplete selected={business} onSelect={setBusiness} onClear={() => setBusiness(null)} />
                </div>

                <div>
                  <label className="block text-sm font-bold text-on-surface mb-2">Phone Number *</label>
                  <PhoneNumberInput value={phone} onChange={setPhone} />
                </div>

                <div>
                  <label className="block text-sm font-bold text-on-surface mb-2">
                    Monthly Budget <span className="font-normal text-on-surface-variant">(How much are you willing to spend on digital marketing?)</span>
                  </label>
                  <div className="space-y-2.5">
                    {BUDGET_OPTIONS.map((opt) => (
                      <label
                        key={opt}
                        className="flex items-center gap-3 px-4 py-3 border border-outline-variant rounded-lg cursor-pointer hover:bg-surface-container-low transition-colors"
                      >
                        <input
                          type="radio"
                          name="budget"
                          value={opt}
                          checked={budget === opt}
                          onChange={() => setBudget(opt)}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-sm text-on-surface">{opt}</span>
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
                  className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all card-shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <MaterialIcon name="progress_activity" size={16} className="animate-spin text-on-primary" />
                  ) : (
                    'Submit'
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
