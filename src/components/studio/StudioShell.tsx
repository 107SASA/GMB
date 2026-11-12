"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { cn } from "@/lib/utils";

export interface ShellViewer {
  name: string;
  email: string;
  isSuperAdmin: boolean;
  permissions: ("blog" | "cms")[];
}

const ViewerCtx = createContext<ShellViewer | null>(null);
export const useStudioViewer = () => useContext(ViewerCtx)!;

/** "Waiting for approval" count for the badge, refreshed every minute. */
function useWaiting() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/studio/summary?count=1")
        .then((r) => r.json())
        .then((d) => alive && d?.success && setN(d.data.waiting || 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return n;
}

export function StudioShell({ viewer, children }: { viewer: ShellViewer; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const waiting = useWaiting();
  const canBlog = viewer.permissions.includes("blog");
  const canCms = viewer.permissions.includes("cms");

  useEffect(() => setOpen(false), [pathname]);

  const links = [
    { name: "Home", icon: "home", href: "/studio", show: true, exact: true },
    { name: "Blog posts", icon: "article", href: "/studio/blog", show: canBlog },
    { name: "Write a new post", icon: "edit_square", href: "/studio/blog/new", show: canBlog, exact: true },
    { name: "Topics", icon: "label", href: "/studio/blog/topics", show: canBlog, exact: true },
    { name: "Website pages", icon: "web", href: "/studio/pages", show: canCms },
    {
      name: viewer.isSuperAdmin ? "Approvals" : "Waiting for approval",
      icon: "fact_check",
      href: "/studio/review",
      show: true,
      badge: waiting,
    },
  ].filter((l) => l.show);

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    if (href === "/studio/blog") return pathname === href || (/^\/studio\/blog\/[a-f0-9]{24}/.test(pathname || ""));
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  const logout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin-login");
    router.refresh();
  };

  const nav = (
    <nav className="flex flex-col gap-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors min-h-11",
            isActive(l.href, l.exact) ? "bg-primary text-white shadow-sm" : "text-on-surface hover:bg-surface-container"
          )}
        >
          <MaterialIcon name={l.icon} size={20} />
          <span className="flex-1">{l.name}</span>
          {!!l.badge && (
            <span
              className={cn(
                "min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-bold",
                isActive(l.href, l.exact) ? "bg-white text-primary" : "bg-[#f59e0b] text-[#1f1300]"
              )}
            >
              {l.badge}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto space-y-2 border-t border-outline-variant pt-4">
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-on-surface-variant hover:bg-surface-container min-h-11"
      >
        <MaterialIcon name="open_in_new" size={18} />
        View the website
      </a>
      {viewer.isSuperAdmin && (
        <Link href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-on-surface-variant hover:bg-surface-container min-h-11">
          <MaterialIcon name="shield" size={18} />
          Back to Super Admin
        </Link>
      )}
      <div className="rounded-xl bg-surface-container px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-on-surface">{viewer.name}</p>
        <p className="truncate text-xs text-on-surface-variant">{viewer.isSuperAdmin ? "Super Admin" : "Marketing team"}</p>
      </div>
      <button
        onClick={logout}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-error hover:bg-error-container/40 min-h-11"
      >
        <MaterialIcon name="logout" size={18} />
        Sign out
      </button>
    </div>
  );

  const brand = (
    <Link href="/studio" className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/icon.png" alt="" className="h-8 w-8 object-contain" />
      <span className="leading-tight">
        <span className="block text-base font-heading font-bold text-on-surface">Content Studio</span>
        <span className="block text-[11px] text-on-surface-variant">Growwmatics AI</span>
      </span>
    </Link>
  );

  return (
    <ViewerCtx.Provider value={viewer}>
      <div className="min-h-screen bg-background">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-6 overflow-y-auto border-r border-outline-variant bg-surface-container-low p-5 lg:flex">
          {brand}
          {nav}
          {footer}
        </aside>

        {/* Mobile top bar */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant bg-surface-container-lowest/95 px-4 py-3 backdrop-blur lg:hidden">
          {brand}
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-outline-variant"
          >
            <MaterialIcon name="menu" size={22} />
            {waiting > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#f59e0b]" />}
          </button>
        </header>

        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 right-0 flex w-[86%] max-w-xs flex-col gap-6 overflow-y-auto bg-surface-container-lowest p-5 shadow-xl">
              <div className="flex items-center justify-between">
                {brand}
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-xl">
                  <MaterialIcon name="close" size={22} />
                </button>
              </div>
              {nav}
              {footer}
            </div>
          </div>
        )}

        <main className="lg:pl-64">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </ViewerCtx.Provider>
  );
}
