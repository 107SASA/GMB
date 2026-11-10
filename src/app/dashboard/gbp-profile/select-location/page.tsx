'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Store, AlertCircle, CheckCircle2 } from 'lucide-react';

interface CandidateLocation {
  locationId: string;
  title: string;
  address: string;
  /** Same Google place as this workspace's business. */
  matchesBusiness?: boolean;
  /** Google confirms this login controls the profile. */
  verified?: boolean;
  /** Google marks this profile as a copy of another one: posts and edits won't work. */
  duplicate?: boolean;
}

/**
 * Shown whenever the connected Google login holds more than one Business
 * Profile, or only one that Google flags as a duplicate (see
 * src/app/api/auth/google/callback/route.ts). Never guessing: silently
 * taking the first match connected an unverified duplicate for "Michelle's
 * Foods" (Nov 2026). Profiles are listed with this workspace's own listing
 * first and duplicates labelled, so the owner can tell identical-looking
 * copies apart.
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
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-on-surface tracking-tight flex items-center gap-2">
          <MapPin className="w-6 h-6 text-primary" /> Choose your Google Business Profile
        </h1>
        <p className="text-on-surface-variant mt-1">
          {googleEmail
            ? `Profiles managed by ${googleEmail}. Pick the one for this workspace.`
            : 'Profiles managed by this Google account. Pick the one for this workspace.'}
        </p>
      </div>

      {!error && locations.length > 0 && locations.every((l) => l.duplicate) && (
        <div className="mb-4 flex items-start gap-2 bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Google marks every profile in this account as a duplicate copy. The original listing is managed by a
            different Google account. Sign in with that account instead, or ask its owner to add you as an Owner.
          </span>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container">
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
              className="w-full text-left bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 shadow-sm hover:border-primary-fixed-dim hover:card-shadow transition-all flex items-start gap-4 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="bg-surface-container p-2.5 rounded-xl shrink-0">
                <Store className="w-5 h-5 text-on-surface-variant" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-on-surface">{loc.title || 'Untitled location'}</div>
                {loc.address && <div className="text-sm text-on-surface-variant mt-0.5">{loc.address}</div>}
                {(loc.matchesBusiness || loc.verified) && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {loc.matchesBusiness && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-container text-on-primary-container">Your business</span>
                    )}
                    {loc.verified && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-container text-on-surface">Verified</span>
                    )}
                  </div>
                )}
                {loc.duplicate && (
                  <div className="flex items-start gap-1.5 mt-2 text-xs text-error">
                    <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span>Google marks this as a duplicate copy. Posts and edits won&apos;t work on it.</span>
                  </div>
                )}
              </div>
              {selecting === loc.locationId ? (
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-outline-variant shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        <a href="/dashboard/gbp-profile" className="text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel and go back
        </a>
      </div>
    </div>
  );
}
