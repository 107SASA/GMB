"use client";

import { Menu, Bell, MapPin, MessageSquare, Store } from "lucide-react";
import { useBusiness } from "@/context/BusinessContext";
import { useMobileNav } from "@/context/MobileNavContext";
import { BusinessSwitcher } from "./BusinessSwitcher";

export function DashboardHeader() {
  const { activeBusiness, loading } = useBusiness();
  const { toggle } = useMobileNav();

  if (loading || !activeBusiness) {
    return (
      <header className="h-16 lg:h-20 border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-40 w-full">
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="lg:hidden p-2 rounded-xl hover:bg-slate-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
          <div className="animate-pulse bg-slate-100 h-8 w-48 rounded-xl" />
        </div>
      </header>
    );
  }

  return (
    <header className="h-16 lg:h-20 border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-40 w-full">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggle}
          className="lg:hidden p-2 rounded-xl hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-slate-600" />
        </button>

        {/* Business info */}
        <div className="flex items-center gap-3 min-w-0">
          <BusinessSwitcher />
          <div className="min-w-0">
            <h1 className="text-base lg:text-xl font-bold text-slate-900 truncate">
              {activeBusiness.name}
            </h1>
            {/* Detail row — hidden below md to avoid overflow */}
            <div className="hidden md:flex items-center gap-4 text-xs font-medium text-slate-500 mt-1">
              {activeBusiness.category && (
                <span className="flex items-center gap-1">
                  <Store className="w-3 h-3" /> {activeBusiness.category}
                </span>
              )}
              {activeBusiness.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {activeBusiness.address.split(',')[0]}
                </span>
              )}
              <div className="flex gap-2 ml-2">
                {activeBusiness.googleConnected && (
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md border border-blue-100 flex items-center gap-1">
                    Google Connected
                  </span>
                )}
                {activeBusiness.whatsappConfig?.isConnected && (
                  <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded-md border border-green-100 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> WhatsApp
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button className="relative w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all border border-slate-200">
          <Bell className="w-4 h-4 lg:w-5 lg:h-5 text-slate-500" />
          <div className="absolute top-2 right-2 w-2 h-2 bg-indigo-500 rounded-full border-2 border-white" />
        </button>
        <div className="hidden sm:flex items-center gap-3 pl-3 lg:pl-6 border-l border-slate-200">
          <div className="text-right">
            <div className="text-sm font-bold text-slate-900">Admin User</div>
            <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Growth Plan</div>
          </div>
          <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-slate-900 flex items-center justify-center font-bold text-white shadow-sm text-sm">
            AD
          </div>
        </div>
      </div>
    </header>
  );
}
