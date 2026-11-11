'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

/**
 * Growth Partner area chrome: sidebar on desktop, top bar + drawer on mobile.
 * Deliberately has no WhatsApp, AI-agent or workspace items — partners only
 * get their own leads, customers and commissions (added phase by phase).
 */

const NAV = [
  { name: 'Overview', icon: 'dashboard', href: '/partner' },
  { name: 'KYC & Bank', icon: 'badge', href: '/partner/kyc' },
];

export function PartnerShell({
  partnerName,
  companyName,
  children,
}: {
  partnerName: string;
  companyName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    await fetch('/api/partner/auth', { method: 'DELETE' }).catch(() => {});
    router.push('/partner-login');
    router.refresh();
  };

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = item.href === '/partner' ? pathname === '/partner' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active ? 'bg-primary-fixed text-primary' : 'text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <MaterialIcon name={item.icon} size={20} />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-outline-variant pt-4 mt-4">
      <p className="text-sm font-semibold text-on-surface truncate">{partnerName}</p>
      <p className="text-xs text-on-surface-variant truncate mb-3">{companyName}</p>
      <button
        onClick={logout}
        className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface min-h-11"
      >
        <MaterialIcon name="logout" size={18} />
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-surface-container-lowest border-r border-outline-variant p-5">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/brand/icon.png" alt="" className="w-8 h-8 object-contain" />
          <div>
            <p className="font-heading font-bold text-on-surface leading-tight">Growwmatics AI</p>
            <p className="text-[11px] text-on-surface-variant">Growth Partner</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {footer}
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-surface-container-lowest border-b border-outline-variant px-4 h-14">
        <div className="flex items-center gap-2">
          <img src="/brand/icon.png" alt="" className="w-7 h-7 object-contain" />
          <span className="font-heading font-bold text-on-surface">Growth Partner</span>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="min-h-11 min-w-11 flex items-center justify-center rounded-lg hover:bg-surface-container"
        >
          <MaterialIcon name={open ? 'close' : 'menu'} size={22} />
        </button>
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 top-14 z-20 bg-surface-container-lowest p-4 flex flex-col">
          <div className="flex-1">{nav}</div>
          {footer}
        </div>
      )}

      <main className="lg:ml-64 p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
