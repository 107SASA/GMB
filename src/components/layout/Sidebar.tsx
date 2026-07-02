"use client";

import {
  Rocket,
  LayoutDashboard,
  MessageSquare,
  Calendar,
  Users,
  BarChart3,
  BarChart2,
  Settings,
  LogOut,
  Zap,
  Megaphone,
  Star,
  ChevronDown,
  Check,
  Plus,
  Building2,
  Bot,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/context/BusinessContext";
import { useMobileNav } from "@/context/MobileNavContext";
import { AddWorkspaceModal } from "./AddWorkspaceModal";

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

function avatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function BusinessAvatar({ name, index, size = "md" }: { name: string; index: number; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-sm";
  return (
    <div
      className={`${sizeClass} ${avatarColor(index)} rounded-lg flex items-center justify-center text-white font-bold shrink-0`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

const sidebarLinks = [
  { name: "Dashboard Home", icon: LayoutDashboard, href: "/dashboard" },
  { name: "Audit Engine", icon: Zap, href: "/dashboard/audit" },
  { name: "Review Management", icon: Star, href: "/dashboard/reviews" },
  { name: "CRM", icon: MessageSquare, href: "/dashboard/crm" },
  { name: "Content Generator", icon: Megaphone, href: "/dashboard/content" },
  { name: "Content Scheduler", icon: Calendar, href: "/dashboard/scheduler" },
  { name: "WhatsApp AI Agent", icon: MessageSquare, href: "/dashboard/whatsapp" },
  { name: "Settings", icon: Settings, href: "/dashboard/settings" },
  { name: "Billing", icon: BarChart3, href: "/dashboard/billing" },
  { name: "Profile", icon: Users, href: "/dashboard/profile" },
];

function UsagePill() {
  const [used, setUsed]   = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/user/usage')
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setUsed(json.data.usage.aiGenerationsUsed);
          setLimit(json.data.limits.maxAIGenerations);
        }
      })
      .catch(() => {});
  }, []);

  if (used === null || limit === null) return null;

  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isFull    = pct >= 100;
  const isWarning = pct >= 80 && !isFull;

  return (
    <Link href="/dashboard/billing" className="block mb-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-indigo-50 hover:border-indigo-200 transition-colors group">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-slate-500 group-hover:text-indigo-600 transition-colors">
          <Bot className="w-3.5 h-3.5" />
          <span className="text-[11px] font-semibold">AI Generations</span>
        </div>
        <span className={cn(
          'text-[11px] font-bold',
          isFull ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-slate-600'
        )}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isFull ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-indigo-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isFull && (
        <p className="text-[10px] text-red-500 font-semibold mt-1">Limit reached · Upgrade</p>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { businesses, activeBusiness, switchBusiness, loading } = useBusiness();
  const { isOpen, close } = useMobileNav();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
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
    router.push("/login");
  };

  const handleSwitch = async (businessId: string) => {
    setDropdownOpen(false);
    await switchBusiness(businessId);
  };

  const activeIndex = businesses.findIndex((b) => b._id === activeBusiness?._id);

  return (
    <>
      {/* ── Desktop sidebar (unchanged) ────────────────────────────────── */}
      <aside className="w-64 border-r border-slate-200 bg-white flex-col hidden lg:flex h-screen fixed top-0 left-0 z-50 overflow-y-auto custom-scrollbar">
        <div className="p-6">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 mb-6 group">
            <div className="w-8 h-8 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center group-hover:rotate-12 transition-transform duration-300">
              <Rocket className="text-primary w-5 h-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              GMB<span className="text-primary">Boost</span>
            </span>
          </Link>

          {/* Workspace Switcher */}
          {!loading && businesses.length > 0 && (
            <div className="mb-6" ref={dropdownRef}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Active Workspace
              </p>

              {/* Trigger button */}
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className={cn(
                  "w-full flex items-center gap-2.5 p-2.5 rounded-xl border transition-all text-left",
                  dropdownOpen
                    ? "bg-indigo-50 border-indigo-200 shadow-sm"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                )}
              >
                {activeBusiness && (
                  <BusinessAvatar name={activeBusiness.name} index={activeIndex} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {activeBusiness?.name ?? "Select workspace"}
                  </p>
                  {activeBusiness?.category && (
                    <p className="text-[10px] text-slate-400 truncate">{activeBusiness.category}</p>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200",
                    dropdownOpen && "rotate-180"
                  )}
                />
              </button>

              {/* Dropdown panel */}
              {dropdownOpen && (
                <div className="mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
                  {/* Business list */}
                  <div className="py-1 max-h-52 overflow-y-auto">
                    {businesses.map((b, i) => {
                      const isActive = b._id === activeBusiness?._id;
                      return (
                        <button
                          key={b._id}
                          onClick={() => handleSwitch(b._id)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left",
                            isActive && "bg-indigo-50/60"
                          )}
                        >
                          <BusinessAvatar name={b.name} index={i} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                "text-sm font-medium truncate",
                                isActive ? "text-indigo-700" : "text-slate-800"
                              )}
                            >
                              {b.name}
                            </p>
                            {b.category && (
                              <p className="text-[10px] text-slate-400 truncate">{b.category}</p>
                            )}
                          </div>
                          {isActive && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  {/* Divider + Add Workspace */}
                  <div className="border-t border-slate-100">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setShowAddModal(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors"
                    >
                      <div className="w-6 h-6 rounded-lg border-2 border-dashed border-indigo-300 flex items-center justify-center shrink-0">
                        <Plus className="w-3 h-3 text-indigo-500" />
                      </div>
                      Add Workspace
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state — no businesses yet */}
          {!loading && businesses.length === 0 && (
            <div className="mb-6">
              <button
                onClick={() => setShowAddModal(true)}
                className="w-full flex items-center gap-2.5 p-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group"
              >
                <div className="w-8 h-8 bg-slate-100 group-hover:bg-indigo-100 rounded-lg flex items-center justify-center shrink-0 transition-colors">
                  <Building2 className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                </div>
                <span className="text-sm font-semibold text-slate-500 group-hover:text-indigo-600 transition-colors">
                  Add your first workspace
                </span>
              </button>
            </div>
          )}

          {/* Navigation links */}
          <nav className="space-y-1">
            {sidebarLinks.map((link) => {
              const isActive = pathname === link.href;
              const isGbpLink = (link as any).gbpBadge;
              const isGbpConnected = activeBusiness?.googleConnected;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all border border-transparent",
                    isActive
                      ? "bg-indigo-50 text-primary border-indigo-100 shadow-sm"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  <link.icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium text-sm flex-1">{link.name}</span>
                  {isGbpLink && (
                    isGbpConnected ? (
                      <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full leading-none">
                        LIVE
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full leading-none">
                        Connect
                      </span>
                    )
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Usage pill + Logout */}
        <div className="mt-auto p-6">
          <UsagePill />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium text-sm">Logout</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile drawer ──────────────────────────────────────────────── */}
      {/* Overlay */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ease-in-out",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Drawer panel — slides in from left */}
      <div
        className={cn(
          "lg:hidden fixed top-0 left-0 h-full w-64 bg-white z-50 flex flex-col overflow-y-auto custom-scrollbar shadow-2xl",
          "transform transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-6">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 mb-6" onClick={close}>
            <div className="w-8 h-8 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center">
              <Rocket className="text-primary w-5 h-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">
              GMB<span className="text-primary">Boost</span>
            </span>
          </Link>

          {/* Navigation links — same sidebarLinks array */}
          <nav className="space-y-1">
            {sidebarLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={close}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all border border-transparent",
                    isActive
                      ? "bg-indigo-50 text-primary border-indigo-100 shadow-sm"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  <link.icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium text-sm flex-1">{link.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Logout */}
        <div className="mt-auto p-6">
          <button
            onClick={() => { close(); handleLogout(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium text-sm">Logout</span>
          </button>
        </div>
      </div>

      {/* Add Workspace modal (rendered outside aside so it's not clipped) */}
      {showAddModal && <AddWorkspaceModal onClose={() => setShowAddModal(false)} />}
    </>
  );
}
