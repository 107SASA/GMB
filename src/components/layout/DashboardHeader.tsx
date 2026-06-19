"use client";

import { Search, Bell, MapPin, MessageSquare, Store } from "lucide-react";
import { useBusiness } from "@/context/BusinessContext";
import { BusinessSwitcher } from "./BusinessSwitcher";

export function DashboardHeader() {
  const { activeBusiness, loading } = useBusiness();

  if (loading || !activeBusiness) {
    return (
      <header className="h-20 border-b border-slate-200 px-8 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-40 w-full">
        <div className="animate-pulse bg-slate-100 h-8 w-64 rounded-xl"></div>
      </header>
    );
  }

  return (
    <header className="h-20 border-b border-slate-200 px-8 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-40 w-full">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4">
          <BusinessSwitcher />
          <div>
            <h1 className="text-xl font-bold text-slate-900">{activeBusiness.name}</h1>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-500 mt-1">
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

      <div className="flex items-center gap-6">
        <button className="relative w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all border border-slate-200">
          <Bell className="w-5 h-5 text-slate-500" />
          <div className="absolute top-2 right-2 w-2 h-2 bg-indigo-500 rounded-full border-2 border-white" />
        </button>
        <div className="flex items-center gap-3 pl-6 border-l border-slate-200">
          <div className="text-right">
            <div className="text-sm font-bold text-slate-900">Admin User</div>
            <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Growth Plan</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center font-bold text-white shadow-sm">
            AD
          </div>
        </div>
      </div>
    </header>
  );
}
