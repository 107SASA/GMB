'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BusinessAutocomplete, type SelectedBusiness } from '@/components/shared/BusinessAutocomplete';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';

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
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
        <p className="text-xs font-bold uppercase tracking-widest text-primary mb-4">Get your free GBP report</p>
        <h1 className="font-heading text-3xl font-bold text-on-surface mb-2">Get your free Google Business report</h1>
        <p className="text-on-surface-variant mb-8">
          See your ranking, review score, and profile completion in minutes — no account needed.
        </p>

        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
              <label className="text-sm font-bold text-on-surface">Find your business on Google</label>
            </div>
            <BusinessAutocomplete selected={selected} onSelect={setSelected} onClear={() => setSelected(null)} />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center shrink-0">2</span>
              <label className="text-sm font-bold text-on-surface">Your WhatsApp number</label>
            </div>
            <PhoneNumberInput value={phone} onChange={setPhone} />
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
              <>
                <MaterialIcon name="progress_activity" size={16} className="animate-spin text-on-primary" /> Generating your report…
              </>
            ) : (
              'Get my free report'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
