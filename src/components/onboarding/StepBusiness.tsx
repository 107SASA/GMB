import { useState, useEffect } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, MapPin, Search, Loader2, Store, CheckCircle2, Link, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [manualMode, setManualMode] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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
    if (!data.businessName || !data.phone || !data.category || !data.city || !data.area || !data.description) {
      setError('Please fill in all required fields: Business Name, Category, Description, Phone, City, and Area.');
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
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100 relative">
      <div className={`flex-1 custom-scrollbar pr-2 pb-4 ${manualMode ? 'overflow-y-auto' : 'overflow-visible'}`}>
        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
          <MapPin className="text-slate-900 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Find your business</h2>
        <p className="text-slate-500 mb-8">Search for your business on Google Maps to autofill your details instantly.</p>

        {!manualMode && (
          <div className="relative z-50">
            {/* Tab toggle */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4">
              <button
                onClick={() => setInputMode('search')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${inputMode === 'search' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Search className="w-4 h-4" /> Search by Name
              </button>
              <button
                onClick={() => setInputMode('url')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${inputMode === 'url' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Link className="w-4 h-4" /> Paste GBP URL
              </button>
            </div>

            {inputMode === 'search' ? (
              <>
                <label className="block text-sm font-bold text-slate-900 mb-2">Search Business Name</label>
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
                    value={searchQuery}
                    onChange={e => {
                      setSearchQuery(e.target.value);
                      if (e.target.value.length < 3) setShowDropdown(false);
                    }}
                    className="w-full pl-12 pr-4 py-4 text-lg bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
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
                      className="absolute w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl z-[100] max-h-[300px] overflow-y-auto left-0"
                    >
                      {suggestions.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectBusiness(item.placeId, item.mainText)}
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <>
                <label className="block text-sm font-bold text-slate-900 mb-2">Paste Google Maps / GBP URL</label>
                <p className="text-xs text-slate-500 mb-3">Works with short links (maps.app.goo.gl), full Google Maps URLs, and Business Profile links.</p>
                <textarea
                  value={gbpUrlInput}
                  onChange={e => setGbpUrlInput(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-none text-sm"
                  placeholder="https://maps.app.goo.gl/... or https://www.google.com/maps/place/..."
                  autoFocus
                />
                <button
                  onClick={handleResolveGbpUrl}
                  disabled={!gbpUrlInput.trim() || isResolvingUrl || isFetchingDetails}
                  className="mt-3 w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResolvingUrl || isFetchingDetails ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Resolving...</>
                  ) : (
                    <><Link className="w-4 h-4" /> Resolve & Autofill</>
                  )}
                </button>
              </>
            )}

            <div className="mt-6 text-center">
              <span className="text-slate-400 text-sm">Can't find your business? </span>
              <button
                onClick={() => setManualMode(true)}
                className="text-indigo-600 font-bold hover:underline text-sm"
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
              <div className="p-4 bg-green-50 border border-green-100 rounded-xl flex items-start gap-3 mb-6">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-green-800">Connected to Google Maps</div>
                  <div className="text-xs text-green-600 mt-0.5">We've auto-filled your details. Please provide the remaining information below.</div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">Business Name *</label>
                <input
                  type="text"
                  value={data.businessName}
                  onChange={e => updateData({ businessName: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                  placeholder="e.g. Acme Downtown"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">Business Category *</label>
                <p className="text-xs text-slate-500 mb-2">Please enter your exact business category manually (e.g. University, Dental Clinic, Restaurant).</p>
                <input
                  type="text"
                  value={data.category}
                  onChange={e => updateData({ category: e.target.value })}
                  /* No `capitalize` class here: CSS text-transform also applies
                     to the placeholder, which rendered it as "E.G. Dental Clinic".
                     deriveCategory() in services/google/places.ts already returns
                     Title Case. */
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                  placeholder="e.g. Dental Clinic"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">Business Description *</label>
                <textarea
                  value={data.description}
                  onChange={e => updateData({ description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none resize-none"
                  placeholder="Tell us what your business does..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">City *</label>
                  <input
                    type="text"
                    value={data.city}
                    onChange={e => updateData({ city: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    placeholder="e.g. Pune"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Area / Locality *</label>
                  <input
                    type="text"
                    value={data.area}
                    onChange={e => updateData({ area: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    placeholder="e.g. PCMC"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">State</label>
                  <input
                    type="text"
                    value={data.state}
                    onChange={e => updateData({ state: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    placeholder="e.g. Maharashtra"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Country</label>
                  <input
                    type="text"
                    value={data.country}
                    onChange={e => updateData({ country: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    placeholder="e.g. India"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Phone Number *</label>
                  <input
                    type="tel"
                    value={data.phone}
                    onChange={e => updateData({ phone: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-900 mb-2">Website</label>
                  <input
                    type="text"
                    value={data.website}
                    onChange={e => updateData({ website: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    placeholder="https://acme.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-900 mb-2">Full Address</label>
                <input
                  type="text"
                  value={data.address}
                  onChange={e => updateData({ address: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                  placeholder="123 Main St, City, State"
                />
              </div>

              {!data.googlePlaceId && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-900 mb-2">Google Place ID</label>
                    <input
                      type="text"
                      value={data.googlePlaceId}
                      onChange={e => updateData({ googlePlaceId: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-900 mb-2">Google Maps URL</label>
                    <input
                      type="text"
                      value={data.googleMapsUrl}
                      onChange={e => updateData({ googleMapsUrl: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
                    />
                  </div>
                </div>
              )}

            </div>

            {!data.googlePlaceId && (
              <div className="mt-4 text-center">
                <button 
                  onClick={() => setManualMode(false)}
                  className="text-slate-500 font-medium hover:text-slate-900 text-sm transition-colors mt-4"
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
          className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-200 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-slate-100 mt-auto">
        <button onClick={onBack} className="text-slate-500 font-bold hover:text-slate-900 transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={handleContinue}
          disabled={!manualMode && !data.googlePlaceId}
          className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
