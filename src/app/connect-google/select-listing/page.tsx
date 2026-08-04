'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface CandidateLocation {
  locationId: string;
  placeId?: string;
  title: string;
  address?: string;
}

export default function SelectListingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <MaterialIcon name="progress_activity" size={40} className="animate-spin text-primary" />
        </div>
      }
    >
      <SelectListingContent />
    </Suspense>
  );
}

function SelectListingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [locations, setLocations] = useState<CandidateLocation[] | null>(null);
  const [error, setError] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('This link is missing required information. Please restart from WhatsApp.');
      return;
    }
    // The candidate list was staged server-side by the OAuth callback; the
    // token alone is opaque, so we ask a small lookup endpoint to resolve it
    // rather than trusting anything client-supplied.
    fetch(`/api/report-connect/pending-locations?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || 'Could not load your listings.');
        setLocations(json.locations);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  const handleSelect = async (locationId: string) => {
    setSubmittingId(locationId);
    setError('');
    try {
      const res = await fetch('/api/report-connect/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, locationId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Something went wrong. Please try again.');
        setSubmittingId(null);
        return;
      }
      router.push('/connect-google/connected');
    } catch {
      setError('Network error. Please try again.');
      setSubmittingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="location_on" size={24} className="text-primary" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Which listing is yours?</h1>
        <p className="text-on-surface-variant mb-8">
          Your Google account manages more than one Business Profile. Pick the one you&apos;d like a report for.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-error-container text-on-error-container rounded-lg text-sm font-medium border border-outline-variant flex items-start gap-3">
            <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!locations && !error && (
          <div className="flex items-center justify-center py-10">
            <MaterialIcon name="progress_activity" size={32} className="animate-spin text-primary" />
          </div>
        )}

        {locations && (
          <div className="space-y-3">
            {locations.map((loc) => (
              <button
                key={loc.locationId}
                type="button"
                onClick={() => handleSelect(loc.locationId)}
                disabled={!!submittingId}
                className="w-full text-left px-5 py-4 bg-surface-container-low hover:bg-surface-container border border-outline-variant rounded-lg flex items-start gap-4 transition-colors disabled:opacity-50"
              >
                <div className="bg-surface-container-lowest p-2 rounded-lg border border-outline-variant">
                  {submittingId === loc.locationId ? (
                    <MaterialIcon name="progress_activity" size={20} className="text-primary animate-spin" />
                  ) : (
                    <MaterialIcon name="store" size={20} className="text-on-surface-variant" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-on-surface">{loc.title}</div>
                  {loc.address && <div className="text-sm text-on-surface-variant mt-0.5">{loc.address}</div>}
                </div>
                {submittingId === loc.locationId && (
                  <MaterialIcon name="check_circle" size={20} className="text-secondary shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
