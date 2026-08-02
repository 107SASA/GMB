'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Store, AlertCircle, CheckCircle2 } from 'lucide-react';

interface CandidateLocation {
  locationId: string;
  title: string;
  address: string;
}

/**
 * Shown when a connected Google account manages more than one GBP location
 * and none confidently matched this workspace's own listing (see
 * src/app/api/auth/google/callback/route.ts). Rather than silently guessing
 * — the root cause of every workspace inheriting whichever location
 * connected first — the user picks explicitly here.
 */
export default function SelectGbpLocationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [locations, setLocations] = useState<CandidateLocation[]>([]);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/gbp/pending-selection');
        const json = await res.json();
        if (!res.ok || !json.success) {
          setError(json.error || 'This connection request has expired. Please reconnect.');
          return;
        }
        setGoogleEmail(json.googleEmail);
        setLocations(json.locations);
      } catch {
        setError('Could not load your Google Business locations.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const choose = async (locationId: string) => {
    setSelecting(locationId);
    setError(null);
    try {
      const res = await fetch('/api/gbp/select-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not connect this location.');
        setSelecting(null);
        return;
      }
      router.push('/dashboard?connected=true');
    } catch {
      setError('Network error. Please try again.');
      setSelecting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <MapPin className="w-6 h-6 text-indigo-600" /> Choose your Google Business Profile
        </h1>
        <p className="text-slate-500 mt-1">
          {googleEmail
            ? `${googleEmail} manages more than one location. Pick the one for this workspace.`
            : 'This Google account manages more than one location. Pick the one for this workspace.'}
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && (
        <div className="space-y-3">
          {locations.map((loc) => (
            <button
              key={loc.locationId}
              type="button"
              onClick={() => choose(loc.locationId)}
              disabled={selecting !== null}
              className="w-full text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all flex items-start gap-4 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="bg-slate-100 p-2.5 rounded-xl shrink-0">
                <Store className="w-5 h-5 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-900">{loc.title || 'Untitled location'}</div>
                {loc.address && <div className="text-sm text-slate-500 mt-0.5">{loc.address}</div>}
              </div>
              {selecting === loc.locationId ? (
                <Loader2 className="w-5 h-5 text-indigo-600 animate-spin shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-slate-200 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <a href="/dashboard/gbp-profile" className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
          Cancel and go back
        </a>
      </div>
    </div>
  );
}
