'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, Store, AlertCircle, MapPin } from 'lucide-react';

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

  useEffect(() => {
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8 sm:p-10">
        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
          <MapPin className="text-slate-900 w-6 h-6" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Get your free Google Business report</h1>
        <p className="text-slate-500 mb-8">
          See your ranking, review score, and profile completion in minutes — no account needed.
        </p>

        <div className="space-y-5">
          <div className="relative">
            <label className="block text-sm font-bold text-slate-900 mb-2">Business name</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                {isSearching || isFetchingDetails ? (
                  <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                ) : (
                  <Search className="w-5 h-5 text-slate-400" />
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
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                placeholder="Start typing your business name..."
              />
            </div>
            {showDropdown && suggestions.length > 0 && (
              <div className="absolute w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl z-50 max-h-[280px] overflow-y-auto">
                {suggestions.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelect(item.placeId, item.mainText)}
                    className="w-full text-left px-5 py-4 hover:bg-slate-50 border-b border-slate-50 flex items-start gap-4 transition-colors group"
                  >
                    <div className="bg-slate-100 p-2 rounded-lg group-hover:bg-white transition-colors">
                      <Store className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900">{item.mainText}</div>
                      <div className="text-sm text-slate-500 mt-0.5">{item.secondaryText}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <p className="mt-2 text-xs text-green-700 font-medium">Selected: {selected.name}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Mobile number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
              placeholder="+91 98765 43210"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Monthly marketing budget</label>
            <select
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
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
              className="p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-200 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Generating your report…
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
