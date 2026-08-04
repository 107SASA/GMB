 'use client';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Cookies from 'js-cookie';
import Link from 'next/link';
import {
  LayoutDashboard, Upload, Megaphone, Star, Sparkles,
  Settings, LogOut, ChevronRight, Menu, X
} from 'lucide-react';

const NAV = [
  { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/upload',     label: 'Upload',      icon: Upload },
  { href: '/campaigns',  label: 'Campaigns',   icon: Megaphone },
  { href: '/reviews',    label: 'Reviews',     icon: Star },
  { href: '/ai',         label: 'AI Suggest',  icon: Sparkles },
  { href: '/settings',   label: 'Settings',    icon: Settings },
];

export default function AppLayout({ children }) {
  const router   = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored || !Cookies.get('accessToken')) { router.push('/login'); return; }
    setUser(JSON.parse(stored));
  }, []);

  const logout = () => {
    Cookies.remove('accessToken');
    Cookies.remove('refreshToken');
    localStorage.removeItem('user');
    router.push('/login');
  };

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-56 bg-surface-container-lowest border-r border-outline-variant flex flex-col transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="px-4 py-4 border-b border-outline-variant">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Star size={14} className="text-white" fill="white" />
            </div>
            <div>
              <div className="text-sm font-bold leading-none text-on-surface">Review Gen</div>
              <div className="text-[10px] text-outline mt-0.5">Module 9</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link key={href} href={href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all group
                  ${active
                    ? 'bg-primary-fixed text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
              >
                <Icon size={16} />
                {label}
                {active && <ChevronRight size={12} className="ml-auto opacity-60" />}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-outline-variant">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate text-on-surface">{user?.name || 'User'}</div>
              <div className="text-[10px] text-outline truncate">{user?.email || ''}</div>
            </div>
          </div>
          <button onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-on-surface-variant hover:text-error hover:bg-error-container transition">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-surface-container-lowest border-b border-outline-variant">
          <button onClick={() => setOpen(true)} className="text-on-surface-variant">
            <Menu size={20} />
          </button>
          <span className="font-semibold text-sm text-on-surface">Review Generation</span>
        </div>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}