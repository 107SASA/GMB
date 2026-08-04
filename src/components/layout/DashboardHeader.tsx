"use client";

import { useState, useEffect } from "react";
import { useBusiness } from "@/context/BusinessContext";
import { useMobileNav } from "@/context/MobileNavContext";
import { BusinessSwitcher } from "./BusinessSwitcher";
import { NotificationBell } from "./NotificationBell";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

interface HeaderUser {
  fullName?: string;
  subscriptionPlan?: string;
}

function initialsOf(name?: string): string {
  if (!name) return "U";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "U"
  );
}

export function DashboardHeader() {
  const { activeBusiness, loading } = useBusiness();
  const { toggle } = useMobileNav();
  const [user, setUser] = useState<HeaderUser | null>(null);

  useEffect(() => {
    fetch("/api/user/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.user) setUser(json.user);
      })
      .catch(() => {});
  }, []);

  if (loading || !activeBusiness) {
    return (
      <header className="h-16 border-b border-outline-variant px-4 lg:px-6 flex items-center justify-between bg-surface-container-lowest sticky top-0 z-40 w-full">
        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="lg:hidden p-2 rounded-lg hover:bg-surface-container transition-colors"
            aria-label="Open menu"
          >
            <MaterialIcon name="menu" size={20} className="text-on-surface-variant" />
          </button>
          <div className="animate-pulse bg-surface-container h-8 w-48 rounded-lg" />
        </div>
      </header>
    );
  }

  return (
    <header className="h-16 border-b border-outline-variant px-4 lg:px-6 flex items-center justify-between bg-surface-container-lowest sticky top-0 z-40 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={toggle}
          className="lg:hidden p-2 rounded-lg hover:bg-surface-container transition-colors shrink-0"
          aria-label="Open menu"
        >
          <MaterialIcon name="menu" size={20} className="text-on-surface-variant" />
        </button>

        <div className="flex items-center gap-3 min-w-0">
          <BusinessSwitcher />
          <div className="min-w-0">
            <h1 className="text-base lg:text-lg font-heading font-bold text-on-surface truncate">
              {activeBusiness.name}
            </h1>
            <div className="hidden md:flex items-center gap-4 text-xs font-medium text-on-surface-variant mt-0.5">
              {activeBusiness.category && (
                <span className="flex items-center gap-1">
                  <MaterialIcon name="storefront" size={12} /> {activeBusiness.category}
                </span>
              )}
              {activeBusiness.address && (
                <span className="flex items-center gap-1">
                  <MaterialIcon name="location_on" size={12} /> {activeBusiness.address.split(",")[0]}
                </span>
              )}
              <div className="flex gap-2 ml-2">
                {activeBusiness.googleConnected && (
                  <span className="px-2 py-0.5 bg-primary-fixed text-primary rounded-md border border-primary-fixed-dim flex items-center gap-1 text-[10px] font-semibold">
                    Google Connected
                  </span>
                )}
                {activeBusiness.whatsappConfig?.isConnected && (
                  <span className="px-2 py-0.5 bg-secondary-container text-on-secondary-container rounded-md border border-secondary-fixed flex items-center gap-1 text-[10px] font-semibold">
                    <MaterialIcon name="chat" size={12} /> WhatsApp
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <NotificationBell />
        <div className="hidden sm:flex items-center gap-3 pl-3 lg:pl-6 border-l border-outline-variant">
          <div className="text-right">
            <div className="text-sm font-bold text-on-surface">{user?.fullName || "…"}</div>
            <div className="text-label-sm text-on-surface-variant normal-case tracking-wider">
              {user?.subscriptionPlan ? `${user.subscriptionPlan} Plan` : ""}
            </div>
          </div>
          <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-primary flex items-center justify-center font-bold text-on-primary text-sm">
            {initialsOf(user?.fullName)}
          </div>
        </div>
      </div>
    </header>
  );
}
