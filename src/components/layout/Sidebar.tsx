"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/context/BusinessContext";
import { useMobileNav } from "@/context/MobileNavContext";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { AddWorkspaceModal } from "./AddWorkspaceModal";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const AVATAR_COLORS = [
  "bg-primary",
  "bg-primary-container",
  "bg-secondary",
  "bg-tertiary-container",
  "bg-on-surface-variant",
  "bg-outline",
];

function avatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function BusinessAvatar({ name, index, size = "md" }: { name: string; index: number; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-sm";
  return (
    <div
      className={`${sizeClass} ${avatarColor(index)} rounded-full flex items-center justify-center text-on-primary font-bold shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const sidebarLinks = [
  { name: "Dashboard", icon: "dashboard", href: "/dashboard" },
  { name: "Audit Engine", icon: "analytics", href: "/dashboard/audit" },
  { name: "Google Profile", icon: "location_on", href: "/dashboard/gbp-profile" },
  { name: "Review Management", icon: "star", href: "/dashboard/reviews" },
  { name: "CRM", icon: "forum", href: "/dashboard/crm" },
  { name: "Content Generator", icon: "campaign", href: "/dashboard/content" },
  { name: "Content Scheduler", icon: "calendar_month", href: "/dashboard/scheduler" },
  { name: "WhatsApp AI Agent", icon: "chat", href: "/dashboard/whatsapp", superAdminOnly: true },
  { name: "Settings", icon: "settings", href: "/dashboard/settings" },
  { name: "Billing", icon: "bar_chart", href: "/dashboard/billing" },
  { name: "Profile", icon: "person", href: "/dashboard/profile" },
];

function UsagePill() {
  const [used, setUsed] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [active, setActive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/user/usage")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setUsed(json.data.usage.aiGenerationsUsed);
          setLimit(json.data.limits.maxAIGenerations);
        }
      })
      .catch(() => {});

    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((json) => setActive(!json?.workspace || !!json.workspace.isActive))
      .catch(() => setActive(false));
  }, []);

  if (active !== true) return null;
  if (used === null || limit === null) return null;

  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isFull = pct >= 100;
  const isWarning = pct >= 80 && !isFull;

  return (
    <Link
      href="/dashboard/billing"
      className="block mb-3 px-3 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-lg hover:bg-primary-fixed hover:border-primary-fixed-dim transition-colors group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-on-surface-variant group-hover:text-primary transition-colors">
          <MaterialIcon name="smart_toy" size={14} />
          <span className="text-[11px] font-semibold">AI Generations</span>
        </div>
        <span
          className={cn(
            "text-[11px] font-bold",
            isFull ? "text-error" : isWarning ? "text-on-surface-variant" : "text-on-surface"
          )}
        >
          {used}/{limit}
        </span>
      </div>
      <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isFull ? "bg-error" : isWarning ? "bg-outline" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isFull && (
        <p className="text-[10px] text-error font-semibold mt-1">Limit reached · Upgrade</p>
      )}
    </Link>
  );
}

/**
 * "Upgrade Plan" CTA — this is single-plan billing (there is only one
 * sellable plan, "Pro"), so once the active workspace's subscription is
 * active there is nothing left to upgrade to. Previously this button always
 * rendered and always linked to /dashboard/upgrade regardless of plan state.
 */
function UpgradeCta({ isSuperAdmin, mobile, onClick }: { isSuperAdmin: boolean; mobile?: boolean; onClick?: () => void }) {
  const [active, setActive] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then((json) => setActive(!json?.workspace || !!json.workspace.isActive))
      .catch(() => setActive(false));
  }, []);

  // The owner isn't on a customer plan at all — never show either state.
  if (isSuperAdmin) return null;
  // Unresolved yet — avoid flashing "Upgrade" then swapping to the other state.
  if (active === null) return null;

  if (active) {
    return (
      <div className={cn(
        'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-surface-container text-on-surface-variant font-semibold text-sm',
        mobile && 'text-xs'
      )}>
        <MaterialIcon name="verified" size={18} className="text-secondary" />
        You already have the Pro Plan
      </div>
    );
  }

  return (
    <Link
      href="/dashboard/upgrade"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-secondary text-on-secondary font-semibold text-sm hover:opacity-95 transition-opacity"
    >
      <MaterialIcon name="trending_up" size={18} className="text-on-secondary" />
      Upgrade Plan
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { businesses, activeBusiness, switchBusiness, refreshBusinesses, loading } = useBusiness();
  const { isOpen, close, toggle } = useMobileNav();
  const { isSuperAdmin } = useCurrentUserRole();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteWorkspace = async (e: React.MouseEvent, businessId: string, name: string) => {
    e.stopPropagation();
    if (deletingId) return;
    if (!confirm(`Delete workspace "${name}"? It will be removed from your list — you can re-add the business later.`)) return;
    setDeletingId(businessId);
    try {
      const res = await fetch("/api/business/delete-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete workspace");
      await refreshBusinesses();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete workspace");
    } finally {
      setDeletingId(null);
    }
  };

  const visibleLinks = sidebarLinks.filter(
    (link) => !(link as { superAdminOnly?: boolean }).superAdminOnly || isSuperAdmin
  );

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // Hard navigation, not router.push — mirrors the login page's same
    // deliberate choice. A soft client-side transition leaves the just-logged-
    // out dashboard eligible for the browser's back/forward cache, so hitting
    // Back could resurrect the authenticated view without re-checking the
    // (now-cleared) session. window.location forces a real reload instead.
    window.location.href = "/login";
  };

  const handleSwitch = async (businessId: string) => {
    setDropdownOpen(false);
    await switchBusiness(businessId);
  };

  const activeIndex = businesses.findIndex((b) => b._id === activeBusiness?._id);

  const navLinkClass = (isActive: boolean) =>
    cn(
      "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
      isActive
        ? "bg-primary-container text-on-primary-container"
        : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
    );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="w-64 border-r border-outline-variant bg-surface-container-low flex-col hidden lg:flex h-screen fixed top-0 left-0 z-50 overflow-y-auto custom-scrollbar">
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-2 mb-6 group">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <MaterialIcon name="rocket_launch" size={18} className="text-on-primary" />
            </div>
            <span className="text-lg font-heading font-bold tracking-tight text-on-surface">
              Groww<span className="text-primary">Matics</span> AI
            </span>
          </Link>

          {!loading && businesses.length > 0 && (
            <div className="mb-6" ref={dropdownRef}>
              <p className="text-label-sm text-on-surface-variant mb-2">Active Workspace</p>

              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className={cn(
                  "w-full flex items-center gap-2.5 p-2.5 rounded-lg border transition-all text-left",
                  dropdownOpen
                    ? "bg-primary-fixed border-primary-fixed-dim card-shadow"
                    : "bg-surface-container-lowest border-outline-variant hover:bg-surface-container"
                )}
              >
                {activeBusiness && (
                  <BusinessAvatar name={activeBusiness.name} index={activeIndex} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-on-surface truncate">
                    {activeBusiness?.name ?? "Select workspace"}
                  </p>
                  {activeBusiness?.category && (
                    <p className="text-[10px] text-on-surface-variant truncate">{activeBusiness.category}</p>
                  )}
                </div>
                <MaterialIcon
                  name="expand_more"
                  size={18}
                  className={cn(
                    "text-on-surface-variant shrink-0 transition-transform duration-200",
                    dropdownOpen && "rotate-180"
                  )}
                />
              </button>

              {dropdownOpen && (
                <div className="mt-1.5 bg-surface-container-lowest border border-outline-variant rounded-lg card-shadow overflow-hidden z-50">
                  <div className="py-1 max-h-52 overflow-y-auto">
                    {businesses.map((b, i) => {
                      const isActive = b._id === activeBusiness?._id;
                      return (
                        <div
                          key={b._id}
                          className={cn(
                            "group/ws w-full flex items-center gap-1 px-3 py-2.5 hover:bg-surface-container-low transition-colors",
                            isActive && "bg-primary-fixed/60"
                          )}
                        >
                          <button
                            onClick={() => handleSwitch(b._id)}
                            className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                          >
                            <BusinessAvatar name={b.name} index={i} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  "text-sm font-medium truncate",
                                  isActive ? "text-primary" : "text-on-surface"
                                )}
                              >
                                {b.name}
                              </p>
                              {b.category && (
                                <p className="text-[10px] text-on-surface-variant truncate">{b.category}</p>
                              )}
                            </div>
                            {isActive && <MaterialIcon name="check" size={14} className="text-primary shrink-0" />}
                          </button>
                          <button
                            onClick={(e) => handleDeleteWorkspace(e, b._id, b.name)}
                            disabled={deletingId === b._id}
                            title="Delete workspace"
                            className="shrink-0 p-1.5 rounded-lg text-outline hover:text-error hover:bg-error-container opacity-0 group-hover/ws:opacity-100 focus:opacity-100 transition-all disabled:opacity-100"
                          >
                            {deletingId === b._id ? (
                              <MaterialIcon name="progress_activity" size={14} className="animate-spin" />
                            ) : (
                              <MaterialIcon name="delete" size={14} />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-outline-variant">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowAddModal(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary-fixed transition-colors"
                    >
                      <div className="w-6 h-6 rounded-lg border-2 border-dashed border-primary-fixed-dim flex items-center justify-center shrink-0">
                        <MaterialIcon name="add" size={12} className="text-primary" />
                      </div>
                      Add Workspace
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && businesses.length === 0 && (
            <div className="mb-6">
              <button
                onClick={() => setShowAddModal(true)}
                className="w-full flex items-center gap-2.5 p-3 rounded-lg border-2 border-dashed border-outline-variant hover:border-primary hover:bg-primary-fixed/50 transition-all group"
              >
                <div className="w-8 h-8 bg-surface-container group-hover:bg-primary-fixed rounded-lg flex items-center justify-center shrink-0 transition-colors">
                  <MaterialIcon name="storefront" size={16} className="text-on-surface-variant group-hover:text-primary" />
                </div>
                <span className="text-sm font-semibold text-on-surface-variant group-hover:text-primary transition-colors">
                  Add your first workspace
                </span>
              </button>
            </div>
          )}

          <nav className="space-y-1">
            {visibleLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link key={link.name} href={link.href} className={navLinkClass(isActive)}>
                  <MaterialIcon name={link.icon} size={20} filled={isActive} />
                  <span className="font-medium text-sm flex-1">{link.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-6 space-y-2">
          <UsagePill />
          {/* "Support / Settings" used to duplicate the "Settings" nav item
              above (both pointed at /dashboard/settings) — removed rather
              than kept as a second link to the same page. */}
          <UpgradeCta isSuperAdmin={isSuperAdmin} />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-error hover:bg-error-container transition-all"
          >
            <MaterialIcon name="logout" size={20} />
            <span className="font-medium text-sm">Logout</span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 bg-on-surface/40 transition-opacity duration-300 ease-in-out",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Mobile drawer */}
      <div
        className={cn(
          "lg:hidden fixed top-0 left-0 h-full w-64 bg-surface-container-low z-50 flex flex-col overflow-y-auto custom-scrollbar card-shadow",
          "transform transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-2 mb-6" onClick={close}>
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <MaterialIcon name="rocket_launch" size={18} className="text-on-primary" />
            </div>
            <span className="text-lg font-heading font-bold tracking-tight text-on-surface">
              Groww<span className="text-primary">Matics</span> AI
            </span>
          </Link>

          <nav className="space-y-1">
            {visibleLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={close}
                  className={navLinkClass(isActive)}
                >
                  <MaterialIcon name={link.icon} size={20} filled={isActive} />
                  <span className="font-medium text-sm flex-1">{link.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-6 space-y-2">
          <UpgradeCta isSuperAdmin={isSuperAdmin} mobile onClick={close} />
          <button
            onClick={() => {
              close();
              handleLogout();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-error hover:bg-error-container transition-all"
          >
            <MaterialIcon name="logout" size={20} />
            <span className="font-medium text-sm">Logout</span>
          </button>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-around px-2 safe-area-pb">
        {[
          { name: "Home", icon: "dashboard", href: "/dashboard" },
          { name: "Audit", icon: "analytics", href: "/dashboard/audit" },
          { name: "Reviews", icon: "star", href: "/dashboard/reviews" },
          { name: "CRM", icon: "forum", href: "/dashboard/crm" },
          { name: "More", icon: "menu", href: "#more" },
        ].map((tab) => {
          const isActive = tab.href === "#more" ? false : pathname === tab.href;
          if (tab.href === "#more") {
            return (
              <button
                key={tab.name}
                onClick={toggle}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition-colors",
                  isOpen ? "bg-primary-fixed text-primary" : "text-on-surface-variant"
                )}
                aria-label="Open menu"
                type="button"
              >
                <MaterialIcon name={tab.icon} size={22} filled={isOpen} />
                <span className="text-[10px] font-medium">{tab.name}</span>
              </button>
            );
          }
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition-colors",
                isActive
                  ? "bg-primary-fixed text-primary"
                  : "text-on-surface-variant"
              )}
            >
              <MaterialIcon name={tab.icon} size={22} filled={isActive} />
              <span className="text-[10px] font-medium">{tab.name}</span>
            </Link>
          );
        })}
      </nav>

      {showAddModal && <AddWorkspaceModal onClose={() => setShowAddModal(false)} />}
    </>
  );
}
