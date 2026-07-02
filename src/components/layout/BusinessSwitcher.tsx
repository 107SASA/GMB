"use client";

import React, { useState, useRef, useEffect } from "react";
import { useBusiness } from "@/context/BusinessContext";
import { ChevronDown, Store, Check } from "lucide-react";

export function BusinessSwitcher() {
  const { businesses, activeBusiness, switchBusiness } = useBusiness();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!businesses || businesses.length <= 1) {
    return null; // Don't show switcher if they only have 1 business
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
      >
        <Store className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-medium text-slate-700 max-w-[150px] truncate">
          {activeBusiness?.name || "Select Business"}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
            Switch Business
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {businesses.map((business) => (
              <button
                key={business._id}
                onClick={() => {
                  switchBusiness(business._id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-left rounded-lg transition-colors text-sm ${
                  activeBusiness?._id === business._id
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                <span className="truncate pr-2">{business.name}</span>
                {activeBusiness?._id === business._id && (
                  <Check className="w-4 h-4 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
