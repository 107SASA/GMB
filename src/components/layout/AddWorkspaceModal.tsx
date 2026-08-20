"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Search, Loader2, Store, CheckCircle2, Building2 } from "lucide-react";
import { useBusiness } from "@/context/BusinessContext";
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

interface Props {
  onClose: () => void;
}

interface PlaceSuggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
}

const AVATAR_COLORS = [
  "bg-primary",
  "bg-primary",
  "bg-secondary",
  "bg-error-container",
  "bg-error",
  "bg-primary-fixed",
  "bg-primary-fixed",
  "bg-secondary-container",
];

export function AddWorkspaceModal({ onClose }: Props) {
  const { businesses, switchBusiness, refreshBusinesses } = useBusiness();

  // Form state
  const [form, setForm] = useState({
    businessName: "",
    category: "",
    description: "",
    address: "",
    area: "",
    city: "",
    state: "",
    country: "",
    phone: "",
    website: "",
    googlePlaceId: "",
    googleMapsUrl: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFetchingDetails, setIsFetchingDetails] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [placeSelected, setPlaceSelected] = useState(false);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Next avatar color based on how many businesses already exist
  const nextColor = AVATAR_COLORS[businesses.length % AVATAR_COLORS.length];

  // handleSelectPlace sets `searchQuery` to the picked business's name,
  // which re-arms this debounced search. If the place-details fetch it also
  // kicks off hasn't resolved into `placeSelected` by the time the 300ms
  // debounce fires, this effect would re-run the autocomplete search and
  // reopen the dropdown right after the user closed it. Set synchronously at
  // selection time so the very next debounce firing is skipped unconditionally,
  // no matter how long the place-details fetch takes.
  const skipNextSearchRef = useRef(false);

  // Fetch autocomplete suggestions
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
    const fetch_ = async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/google/autocomplete?q=${encodeURIComponent(debouncedQuery)}`);
        const json = await res.json();
        if (json.success) {
          setSuggestions(json.data);
          setShowDropdown(true);
        }
      } catch {
        /* ignore */
      } finally {
        setIsSearching(false);
      }
    };
    fetch_();
  }, [debouncedQuery]);

  // Click outside closes dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectPlace = async (placeId: string, mainText: string) => {
    setShowDropdown(false);
    skipNextSearchRef.current = true;
    setSearchQuery(mainText);
    setIsFetchingDetails(true);
    try {
      const res = await fetch(`/api/google/place-details?placeId=${placeId}`);
      const json = await res.json();
      if (json.success && json.data) {
        const d = json.data;
        setForm((prev) => ({
          ...prev,
          businessName: d.name || mainText,
          // Auto-fill the category from Google (place-details derives a
          // human-readable primaryCategory) so a picked business isn't blocked
          // by the required "Category" field — the friction that made it look
          // like the same business couldn't be added again.
          category: d.primaryCategory || d.category || "",
          // Google's own one-line summary of the place — a genuinely useful
          // starting description when it exists (most listings don't have
          // one; the field just stays blank then, same as before).
          description: d.editorialSummary || prev.description,
          address: d.formattedAddress || "",
          // Was already being fetched (services/google/places.ts derives it
          // from address_components) but never actually wired into the form,
          // despite "Area / Locality" being a real field below — silently
          // dropped data, not a deliberate omission.
          area: d.area || "",
          phone: d.phoneNumber || "",
          website: d.website || "",
          googlePlaceId: placeId,
          googleMapsUrl: d.googleMapsUrl || "",
          latitude: d.latitude || null,
          longitude: d.longitude || null,
          city: d.city || "",
          state: d.state || "",
          country: d.country || "",
        }));
        setPlaceSelected(true);
      }
    } catch {
      setError("Could not fetch details. Fill in manually below.");
      setPlaceSelected(true);
    } finally {
      setIsFetchingDetails(false);
    }
  };

  const update = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessName.trim()) {
      setError("Business name is required.");
      return;
    }
    if (!form.category.trim()) {
      setError("Category is required.");
      return;
    }
    if (!form.city.trim()) {
      setError("City is required.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/business/add-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create workspace");

      // Refresh the business list then switch to the new one
      await refreshBusinesses();
      await switchBusiness(json.businessId);
      onClose();
    } catch (err: any) {
      setError(friendlyClientMessage(err, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-primary/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 ${nextColor} rounded-xl flex items-center justify-center`}>
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-on-surface text-base">Add Workspace</h2>
              <p className="text-xs text-on-surface-variant">Search for your business to auto-fill details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-outline hover:text-on-surface hover:bg-surface-container transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-error-container border border-error-container text-on-error-container text-sm rounded-xl">
              {error}
            </div>
          )}

          {/* Google Places search */}
          {!placeSelected && (
            <div ref={dropdownRef} className="relative mb-6">
              <label className="block text-xs font-bold text-on-surface uppercase tracking-wider mb-2">
                Search on Google Maps
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  {isSearching || isFetchingDetails ? (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  ) : (
                    <Search className="w-4 h-4 text-outline" />
                  )}
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.length < 3) setShowDropdown(false);
                  }}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="Type your business name..."
                  autoFocus
                />
              </div>

              {showDropdown && suggestions.length > 0 && (
                <div className="absolute w-full mt-1 bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow z-50 max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.placeId}
                      type="button"
                      onClick={() => handleSelectPlace(s.placeId, s.mainText)}
                      className="w-full text-left px-4 py-3 hover:bg-surface border-b border-outline-variant last:border-0 flex items-center gap-3 transition-colors"
                    >
                      <div className="bg-surface-container p-1.5 rounded-lg shrink-0">
                        <Store className="w-3.5 h-3.5 text-on-surface-variant" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-on-surface truncate">{s.mainText}</div>
                        <div className="text-xs text-outline truncate">{s.secondaryText}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setPlaceSelected(true)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Skip search — enter details manually
                </button>
              </div>
            </div>
          )}

          {/* Form fields */}
          <form id="add-workspace-form" onSubmit={handleSubmit} className="space-y-4">
            {placeSelected && form.googlePlaceId && (
              <div className="flex items-start gap-3 p-3 bg-secondary-container/40 border border-secondary-fixed rounded-xl mb-4">
                <CheckCircle2 className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
                <p className="text-xs font-medium text-on-secondary-container">
                  Google Maps data auto-filled. Fill in any missing fields below.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1.5">
                Business Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={form.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                placeholder="e.g. Acme Healthcare"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1.5">
                Category <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                placeholder="e.g. Salon, Restaurant, Retail"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1.5">
                  City <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="e.g. Pune"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1.5">Area / Locality</label>
                <input
                  type="text"
                  value={form.area}
                  onChange={(e) => update("area", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="e.g. Kothrud"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface mb-1.5">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={2}
                className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all resize-none"
                placeholder="What does this business do?"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="+91 98..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface mb-1.5">Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-surface border border-outline-variant rounded-xl focus:bg-surface-container-lowest focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="https://..."
                />
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-outline-variant flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-workspace-form"
            disabled={submitting}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-container disabled:opacity-60 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {submitting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating...</>
            ) : (
              "Add Workspace"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
