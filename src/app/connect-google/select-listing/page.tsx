'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MapPin, Store, AlertCircle, CheckCircle2 } from 'lucide-react';

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
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-violet-600" />
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8 sm:p-10">
        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
          <MapPin className="text-slate-900 w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Which listing is yours?</h1>
        <p className="text-slate-500 mb-8">
          Your Google account manages more than one Business Profile. Pick the one you'd like a report for.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-200 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!locations && !error && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
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
                className="w-full text-left px-5 py-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl flex items-start gap-4 transition-colors disabled:opacity-50"
              >
                <div className="bg-white p-2 rounded-lg border border-slate-100">
                  {submittingId === loc.locationId ? (
                    <Loader2 className="w-5 h-5 text-violet-600 animate-spin" />
                  ) : (
                    <Store className="w-5 h-5 text-slate-500" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900">{loc.title}</div>
                  {loc.address && <div className="text-sm text-slate-500 mt-0.5">{loc.address}</div>}
                </div>
                {submittingId === loc.locationId && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
