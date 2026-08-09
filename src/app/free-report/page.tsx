'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface PlaceSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

interface SelectedBusiness {
  name: string;
  address?: string;
  category?: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  website?: string;
  googlePlaceId?: string;
  googleMapsUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
  // Live rating/review-count read from the Places Details response — see
  // handleSelect(). Previously fetched and then discarded here, which is
  // why every free report showed 0 reviews/0 rating regardless of the
  // business's real Google listing.
  rating?: number;
  totalReviews?: number;
  // Google's own one-line summary of the place, when it has one.
  editorialSummary?: string;
}

const BUDGET_OPTIONS = [
  { value: 'under-10k', label: 'Under ₹10,000/mo' },
  { value: '10k-50k', label: '₹10,000 – ₹50,000/mo' },
  { value: '50k-plus', label: '₹50,000+/mo' },
  { value: 'not-sure', label: 'Not sure yet' },
];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function FreeReportPage() {
  const router = useRouter();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  const [selected, setSelected] = useState<SelectedBusiness | null>(null);
  const [phone, setPhone] = useState('');
  const [budget, setBudget] = useState(BUDGET_OPTIONS[0].value);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // handleSelect sets `query` to the picked business's name, which re-arms
  // the debounced search below. If the place-details fetch it also kicks off
  // hasn't resolved into `selected` by the time that 300ms debounce fires,
  // the effect would see a non-empty query with `selected` still null and
  // re-run the autocomplete search — reopening the dropdown right after the
  // user closed it. This ref is set synchronously at selection time so the
  // very next debounce firing is skipped unconditionally, no matter how long
  // the place-details fetch takes.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    if (debouncedQuery.length < 3 || selected) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    (async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/google/autocomplete?q=${encodeURIComponent(debouncedQuery)}`);
        const json = await res.json();
        if (json.success) {
          setSuggestions(json.data);
          setShowDropdown(true);
        } else {
          setSuggestions([]);
          setShowDropdown(false);
        }
      } catch {
        setSuggestions([]);
        setShowDropdown(false);
      } finally {
        setIsSearching(false);
      }
    })();
  }, [debouncedQuery, selected]);

  const handleSelect = async (placeId: string, mainText: string) => {
    setShowDropdown(false);
    skipNextSearchRef.current = true;
    setQuery(mainText);
    setIsFetchingDetails(true);
    setError('');
    try {
      const res = await fetch(`/api/google/place-details?placeId=${placeId}`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        setSelected({
          name: d.name || mainText,
          address: d.formattedAddress,
          category: d.primaryCategory,
          area: d.area,
          city: d.city,
          state: d.state,
          country: d.country,
          phone: d.phoneNumber,
          website: d.website,
          googlePlaceId: placeId,
          googleMapsUrl: d.googleMapsUrl,
          latitude: d.latitude ?? null,
          longitude: d.longitude ?? null,
          rating: d.rating,
          totalReviews: d.totalReviews,
          editorialSummary: d.editorialSummary,
        });
      } else {
        throw new Error();
      }
    } catch {
      // Fall back to a manual entry using just what the visitor typed.
      setSelected({ name: mainText });
      setError('Could not fetch full details for this listing — you can still continue.');
    } finally {
      setIsFetchingDetails(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    const business = selected || (query.trim() ? { name: query.trim() } : null);
    if (!business) {
      setError('Please search for and select your business.');
      return;
    }
    if (!phone.trim()) {
      setError('Please enter your phone number.');
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
          phone,
          budget,
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
        <div className="w-12 h-12 bg-primary-fixed rounded-xl flex items-center justify-center mb-6">
          <MaterialIcon name="location_on" size={24} className="text-primary" />
        </div>
        <h1 className="font-heading text-3xl font-bold text-on-surface mb-2">Get your free Google Business report</h1>
        <p className="text-on-surface-variant mb-8">
          See your ranking, review score, and profile completion in minutes — no account needed.
        </p>

        <div className="space-y-5">
          <div className="relative">
            <label className="block text-sm font-bold text-on-surface mb-2">Business name</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                {isSearching || isFetchingDetails ? (
                  <MaterialIcon name="progress_activity" size={20} className="text-primary animate-spin" />
                ) : (
                  <MaterialIcon name="search" size={20} className="text-outline" />
                )}
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                  if (e.target.value.length < 3) setShowDropdown(false);
                }}
                className="w-full pl-12 pr-4 py-3.5 bg-surface border border-outline-variant rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none"
                placeholder="Start typing your business name..."
              />
            </div>
            {showDropdown && suggestions.length > 0 && (
              <div className="absolute w-full mt-2 bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow z-50 max-h-[280px] overflow-y-auto">
                {suggestions.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelect(item.placeId, item.mainText)}
                    className="w-full text-left px-5 py-4 hover:bg-surface-container-low border-b border-outline-variant flex items-start gap-4 transition-colors group"
                  >
                    <div className="bg-surface-container p-2 rounded-lg group-hover:bg-surface-container-lowest transition-colors">
                      <MaterialIcon name="storefront" size={20} className="text-on-surface-variant" />
                    </div>
                    <div>
                      <div className="font-bold text-on-surface">{item.mainText}</div>
                      <div className="text-sm text-on-surface-variant mt-0.5">{item.secondaryText}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-on-surface mb-2">Mobile number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3.5 bg-surface border border-outline-variant rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none"
              placeholder="+91 98765 43210"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-on-surface mb-2">Monthly marketing budget</label>
            <select
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full px-4 py-3.5 bg-surface border border-outline-variant rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none"
            >
              {BUDGET_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
