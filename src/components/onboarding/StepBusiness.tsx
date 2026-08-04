import { useState, useEffect, useRef } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { motion, AnimatePresence } from 'framer-motion';

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function StepBusiness({ data, updateData, onNext, onBack }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebounce(searchQuery, 300);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);

  // GBP URL paste mode
  const [inputMode, setInputMode] = useState<'search' | 'url'>('search');
  const [gbpUrlInput, setGbpUrlInput] = useState('');
  const [isResolvingUrl, setIsResolvingUrl] = useState(false);

  // UI States
  const [showDropdown, setShowDropdown] = useState(false);
  // Defaults to the review/manual form when a business is already selected —
  // this step remounts fresh every time the wizard navigates back to it, so
  // without this, a returning user would see a blank search box (and could
  // search again and silently overwrite their earlier selection) even though
  // `data` still holds their chosen business.
  const [manualMode, setManualMode] = useState(!!data.businessName);
  const [error, setError] = useState('');

  // handleSelectBusiness sets `searchQuery` to the picked business's name,
  // which re-arms this debounced search. `manualMode` (which unmounts the
  // search UI) only flips to true after the place-details fetch resolves —
  // if the 300ms debounce fires first, this effect would re-run the
  // autocomplete search and reopen the dropdown right after the user closed
  // it. Set synchronously at selection time so the very next debounce firing
  // is skipped unconditionally, no matter how long that fetch takes.
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    if (debouncedQuery.length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const fetchSuggestions = async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/google/autocomplete?q=${encodeURIComponent(debouncedQuery)}`);
        const json = await res.json();
        if (json.success) {
          setSuggestions(json.data);
          setShowDropdown(true);
          setError('');
        } else {
          setError(`Maps API Error: ${json.error || 'Failed to fetch suggestions'}`);
          setSuggestions([]);
          setShowDropdown(false);
        }
      } catch (err: any) {
        console.error(err);
        setError('Network error: Could not connect to Google Maps API.');
      } finally {
        setIsSearching(false);
      }
    };

    fetchSuggestions();
  }, [debouncedQuery]);

  const handleSelectBusiness = async (placeId: string, mainText: string) => {
    setShowDropdown(false);
    skipNextSearchRef.current = true;
    setSearchQuery(mainText);
    setIsFetchingDetails(true);
    setError('');

    try {
      const res = await fetch(`/api/google/place-details?placeId=${placeId}`);
      const json = await res.json();
      
      if (json.success && json.data) {
        const d = json.data;
        const generatedReviewLink = `https://search.google.com/local/writereview?placeid=${placeId}`;

        // Autofill everything Google can tell us. area/city/state/country come
        // from address_components (see services/google/places.ts) and category
        // from the place `types`. The user still reviews all of it below — the
        // green "Connected to Google Maps" banner prompts them to verify.
        // `description` stays manual: Places has no equivalent field.
        //
        // `|| data.x` keeps any value the user already typed rather than
        // blanking it when Google has no answer for that component.
        updateData({
          businessName: d.name || mainText,
          address: d.formattedAddress || '',
          phone: d.phoneNumber || '',
          website: d.website || '',
          googlePlaceId: placeId,
          googleMapsUrl: d.googleMapsUrl || '',
          latitude: d.latitude || null,
          longitude: d.longitude || null,
          rating: d.rating || 0,
          totalReviews: d.totalReviews || 0,
          gbpUrl: generatedReviewLink,
          area: d.area || data.area || '',
          city: d.city || data.city || '',
          state: d.state || data.state || '',
          country: d.country || data.country || '',
          category: d.primaryCategory || data.category || '',
          // Google only writes editorial_summary for a minority of listings,
          // so this is usually empty and the user writes their own.
          description: d.editorialSummary || data.description || '',
        });
        
        setManualMode(true);
      } else {
        throw new Error('Failed to fetch details');
      }
    } catch (err) {
      console.error(err);
      setError('Could not fetch details. Please enter manually.');
      setManualMode(true);
    } finally {
      setIsFetchingDetails(false);
    }
  };

  const handleResolveGbpUrl = async () => {
    const url = gbpUrlInput.trim();
    if (!url) return;
    setIsResolvingUrl(true);
    setError('');
    try {
      const res = await fetch('/api/google/resolve-gbp-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        await handleSelectBusiness(json.data.placeId, json.data.name);
      } else {
        setError(json.error || 'Could not resolve this URL. Try searching by name instead.');
      }
    } catch {
      setError('Network error while resolving URL.');
    } finally {
      setIsResolvingUrl(false);
    }
  };

  const handleContinue = () => {
    // Category/description are NOT required here — Google's Places data only
    // has them for a minority of listings (see the autofill notes below), so
    // forcing every user to type them in manually during signup was pure
    // friction. They're collected properly in the post-payment intake form
    // instead, where there's time to get them right.
    if (!data.businessName || !data.phone || !data.city || !data.area) {
      setError('Please fill in all required fields: Business Name, Phone, City, and Area.');
      return;
    }
    if (!PHONE_REGEX.test(normalizePhone(data.phone))) {
      setError('Please enter a valid phone number in international format, e.g. +14155550100.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-surface-container-lowest rounded-xl card-shadow p-10 flex flex-col border border-outline-variant relative">
      <div className={`flex-1 custom-scrollbar pr-2 pb-4 ${manualMode ? 'overflow-y-auto' : 'overflow-visible'}`}>
        <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
          <MaterialIcon name="location_on" size={24} className="text-primary" />
        </div>
        <h2 className="text-headline-md font-heading text-on-surface mb-2">Find your business</h2>
        <p className="text-on-surface-variant mb-8">Search for your business on Google Maps to autofill your details instantly.</p>

        {!manualMode && (
          <div className="relative z-50">
            {/* Tab toggle */}
            <div className="flex gap-1 p-1 bg-surface-container rounded-lg mb-4">
              <button
                onClick={() => setInputMode('search')}
                className={`flex-1 flex items-center justify-center gap-1 sm:gap-2 py-2 px-2 sm:px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all truncate ${inputMode === 'search' ? 'bg-surface-container-lowest text-on-surface card-shadow' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <MaterialIcon name="search" size={16} className="shrink-0" /> <span className="truncate">Search by Name</span>
              </button>
              <button
                onClick={() => setInputMode('url')}
                className={`flex-1 flex items-center justify-center gap-1 sm:gap-2 py-2 px-2 sm:px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all truncate ${inputMode === 'url' ? 'bg-surface-container-lowest text-on-surface card-shadow' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <MaterialIcon name="link" size={16} className="shrink-0" /> <span className="truncate">Paste GBP URL</span>
              </button>
            </div>

            {inputMode === 'search' ? (
              <>
                <label className="block text-label-md text-on-surface mb-2">Search Business Name</label>
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
                    value={searchQuery}
                    onChange={e => {
                      setSearchQuery(e.target.value);
                      if (e.target.value.length < 3) setShowDropdown(false);
                    }}
                    className="w-full pl-12 pr-4 py-3 text-lg bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    placeholder="Start typing your business name..."
                    autoFocus
                  />
                </div>

                <AnimatePresence>
                  {showDropdown && suggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute w-full mt-2 bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow z-[100] max-h-[300px] overflow-y-auto left-0"
                    >
                      {suggestions.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectBusiness(item.placeId, item.mainText)}
                          className="w-full text-left px-5 py-4 hover:bg-surface-container-low border-b border-outline-variant flex items-start gap-4 transition-colors group"
                        >
                          <div className="bg-surface-container p-2 rounded-lg group-hover:bg-surface-container-lowest transition-colors">
                            <MaterialIcon name="store" size={20} className="text-on-surface-variant" />
                          </div>
                          <div>
                            <div className="font-bold text-on-surface">{item.mainText}</div>
                            <div className="text-sm text-on-surface-variant mt-0.5">{item.secondaryText}</div>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <>
                <label className="block text-label-md text-on-surface mb-2">Paste Google Maps / GBP URL</label>
                <p className="text-xs text-on-surface-variant mb-3">Works with short links (maps.app.goo.gl), full Google Maps URLs, and Business Profile links.</p>
                <textarea
                  value={gbpUrlInput}
                  onChange={e => setGbpUrlInput(e.target.value)}
                  rows={3}
                  className={`${inputCls} resize-none text-sm`}
                  placeholder="https://maps.app.goo.gl/... or https://www.google.com/maps/place/..."
                  autoFocus
                />
                <button
                  onClick={handleResolveGbpUrl}
                  disabled={!gbpUrlInput.trim() || isResolvingUrl || isFetchingDetails}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResolvingUrl || isFetchingDetails ? (
                    <><MaterialIcon name="progress_activity" size={16} className="animate-spin" /> Resolving...</>
                  ) : (
                    <><MaterialIcon name="link" size={16} /> Resolve & Autofill</>
                  )}
                </button>
              </>
            )}

            <div className="mt-6 text-center">
              <span className="text-outline text-sm">Can't find your business? </span>
              <button
                onClick={() => setManualMode(true)}
                className="text-primary font-bold hover:underline text-sm"
              >
                Enter details manually
              </button>
            </div>
          </div>
        )}

        {manualMode && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {data.googlePlaceId && (
              <div className="p-4 bg-secondary-container/40 border border-secondary-fixed rounded-lg flex items-start gap-3 mb-6">
                <MaterialIcon name="check_circle" size={20} className="text-secondary mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-on-secondary-container">Connected to Google Maps</div>
                  <div className="text-xs text-secondary mt-0.5">We&apos;ve auto-filled your details. Please provide the remaining information below.</div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-label-md text-on-surface mb-2">Business Name *</label>
                <input
                  type="text"
                  value={data.businessName}
                  onChange={e => updateData({ businessName: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Acme Downtown"
                />
              </div>

              {/* Category and description are collected in the post-payment
                  intake form instead (Google's data only covers a minority
                  of listings for either, so this was pure friction here
                  with no reliable payoff). Google-sourced values (when
                  available) still flow through via handleSelectBusiness —
                  they just aren't required or edited on this screen. */}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-label-md text-on-surface mb-2">City *</label>
                  <input
                    type="text"
                    value={data.city}
                    onChange={e => updateData({ city: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. Pune"
                  />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-2">Area / Locality *</label>
                  <input
                    type="text"
                    value={data.area}
                    onChange={e => updateData({ area: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. PCMC"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-label-md text-on-surface mb-2">State</label>
                  <input
                    type="text"
                    value={data.state}
                    onChange={e => updateData({ state: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. Maharashtra"
                  />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-2">Country</label>
                  <input
                    type="text"
                    value={data.country}
                    onChange={e => updateData({ country: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. India"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-label-md text-on-surface mb-2">Phone Number *</label>
                  <input
                    type="tel"
                    value={data.phone}
                    onChange={e => updateData({ phone: e.target.value })}
                    className={inputCls}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-2">Website</label>
                  <input
                    type="text"
                    value={data.website}
                    onChange={e => updateData({ website: e.target.value })}
                    className={inputCls}
                    placeholder="https://acme.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-label-md text-on-surface mb-2">Full Address</label>
                <input
                  type="text"
                  value={data.address}
                  onChange={e => updateData({ address: e.target.value })}
                  className={inputCls}
                  placeholder="123 Main St, City, State"
                />
              </div>

              {!data.googlePlaceId && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-label-md text-on-surface mb-2">Google Place ID</label>
                    <input
                      type="text"
                      value={data.googlePlaceId}
                      onChange={e => updateData({ googlePlaceId: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-label-md text-on-surface mb-2">Google Maps URL</label>
                    <input
                      type="text"
                      value={data.googleMapsUrl}
                      onChange={e => updateData({ googleMapsUrl: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                </div>
              )}

            </div>

            {!data.googlePlaceId && (
              <div className="mt-4 text-center">
                <button 
                  onClick={() => setManualMode(false)}
                  className="text-on-surface-variant font-medium hover:text-on-surface text-sm transition-colors mt-4"
                >
                  ← Back to search
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Errors sit here — directly above the Continue button and OUTSIDE the
          scrolling content area. Previously this lived at the top of the form:
          the user would scroll to the bottom, hit Continue, and the message
          would render off-screen above them, making it look like the button
          simply did nothing. */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 p-4 bg-error-container text-on-error-container rounded-lg text-sm font-medium border border-outline-variant flex items-start gap-3"
        >
          <MaterialIcon name="error" size={20} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-outline-variant mt-auto">
        <button onClick={onBack} className="text-on-surface-variant font-bold hover:text-on-surface transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={handleContinue}
          disabled={!manualMode && !data.googlePlaceId}
          className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue <MaterialIcon name="arrow_forward" size={16} />
        </button>
      </div>
    </div>
  );
}
