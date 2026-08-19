'use client';

import { useEffect, useRef, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface PlaceSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

export interface SelectedBusiness {
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
  rating?: number;
  totalReviews?: number;
  editorialSummary?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Google Places business search + a "Selected" confirmation card once picked
 * (see the free-report page's redesign and the /book-demo page for the two
 * call sites this shape is now shared between). Falls back to a manual
 * `{ name: <typed text> }` entry if place-details fails to resolve, same as
 * the original free-report-only implementation this was extracted from.
 */
export function BusinessAutocomplete({
  selected,
  onSelect,
  onClear,
  placeholder = 'Start typing, then select your business from the list',
}: {
  selected: SelectedBusiness | null;
  onSelect: (business: SelectedBusiness) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const [fetchError, setFetchError] = useState('');

  // See free-report's original comment: skips the very next debounced search
  // so the place-details fetch racing the 300ms debounce can't reopen the
  // dropdown right after the visitor closed it by selecting an item.
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

  const handlePick = async (placeId: string, mainText: string) => {
    setShowDropdown(false);
    skipNextSearchRef.current = true;
    setQuery('');
    setIsFetchingDetails(true);
    setFetchError('');
    try {
      const res = await fetch(`/api/google/place-details?placeId=${placeId}`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        onSelect({
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
      onSelect({ name: mainText });
      setFetchError('Could not fetch full details for this listing — you can still continue.');
    } finally {
      setIsFetchingDetails(false);
    }
  };

  if (selected) {
    return (
      <div className="border border-primary/40 bg-primary-fixed/40 rounded-lg px-4 py-3.5 flex items-start gap-3">
        <div className="bg-surface-container-lowest p-2 rounded-lg shrink-0 mt-0.5">
          <MaterialIcon name="storefront" size={18} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-on-surface truncate">{selected.name}</div>
          {selected.address && (
            <div className="text-xs text-on-surface-variant mt-0.5 truncate">{selected.address}</div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-bold text-primary">Selected</span>
          <button
            type="button"
            onClick={() => {
              onClear();
              setQuery('');
              setFetchError('');
            }}
            aria-label="Change business"
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <MaterialIcon name="close" size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
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
            if (e.target.value.length < 3) setShowDropdown(false);
          }}
          className="w-full pl-12 pr-4 py-3.5 bg-surface border border-outline-variant rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none"
          placeholder={placeholder}
        />
      </div>
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute w-full mt-2 bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow z-50 max-h-[280px] overflow-y-auto">
          {suggestions.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handlePick(item.placeId, item.mainText)}
              className="w-full text-left px-5 py-4 hover:bg-surface-container-low border-b border-outline-variant last:border-b-0 flex items-start gap-4 transition-colors group"
            >
              <div className="bg-surface-container p-2 rounded-lg group-hover:bg-surface-container-lowest transition-colors">
                <MaterialIcon name="storefront" size={20} className="text-on-surface-variant" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-on-surface truncate">{item.mainText}</div>
                <div className="text-sm text-on-surface-variant mt-0.5 truncate">{item.secondaryText}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {fetchError && <p className="text-xs text-error mt-1.5">{fetchError}</p>}
    </div>
  );
}
