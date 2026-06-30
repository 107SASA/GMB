"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Search, Loader2, Store, CheckCircle2, Building2 } from "lucide-react";
import { useBusiness } from "@/context/BusinessContext";

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
  "bg-indigo-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-pink-500",
  "bg-teal-500",
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

  // Fetch autocomplete suggestions
  useEffect(() => {
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
          address: d.formattedAddress || "",
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
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 ${nextColor} rounded-xl flex items-center justify-center`}>
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-base">Add Workspace</h2>
              <p className="text-xs text-slate-500">Search for your business to auto-fill details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-6">
          {error && (
            <div className="mb-4 px-4 py-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl">
              {error}
            </div>
          )}

          {/* Google Places search */}
          {!placeSelected && (
            <div ref={dropdownRef} className="relative mb-6">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Search on Google Maps
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  {isSearching || isFetchingDetails ? (
                    <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (e.target.value.length < 3) setShowDropdown(false);
                  }}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="Type your business name..."
                  autoFocus
                />
              </div>

              {showDropdown && suggestions.length > 0 && (
                <div className="absolute w-full mt-1 bg-white border border-slate-100 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.placeId}
                      type="button"
                      onClick={() => handleSelectPlace(s.placeId, s.mainText)}
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 flex items-center gap-3 transition-colors"
                    >
                      <div className="bg-slate-100 p-1.5 rounded-lg shrink-0">
                        <Store className="w-3.5 h-3.5 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{s.mainText}</div>
                        <div className="text-xs text-slate-400 truncate">{s.secondaryText}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setPlaceSelected(true)}
                  className="text-xs text-indigo-600 hover:underline font-medium"
                >
                  Skip search — enter details manually
                </button>
              </div>
            </div>
          )}

          {/* Form fields */}
          <form id="add-workspace-form" onSubmit={handleSubmit} className="space-y-4">
            {placeSelected && form.googlePlaceId && (
              <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl mb-4">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <p className="text-xs font-medium text-emerald-700">
                  Google Maps data auto-filled. Fill in any missing fields below.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Business Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="e.g. Acme Healthcare"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                Category <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="e.g. Dental Clinic, Restaurant, Retail"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  City <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="e.g. Pune"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Area / Locality</label>
                <input
                  type="text"
                  value={form.area}
                  onChange={(e) => update("area", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="e.g. Kothrud"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={2}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
                placeholder="What does this business do?"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="+91 98..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="https://..."
                />
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-workspace-form"
            disabled={submitting}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-xl transition-all flex items-center justify-center gap-2"
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
