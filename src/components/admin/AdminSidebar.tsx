'use client';

import {
  ShieldCheck,
  LayoutDashboard,
  Building2,
  LogOut,
  Rocket,
  BrainCircuit,
  CreditCard,
  Activity,
  Zap,
  DollarSign,
  Users,
  MessageSquare,
  Star,
  Megaphone,
  Clock,
  Headset,
  Settings,
  Calendar
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const adminLinks = [
  { name: 'Dashboard',     icon: LayoutDashboard, href: '/admin' },
  { name: 'Customers',     icon: Users,           href: '/admin/customers' },
  { name: 'Demo Bookings', icon: Calendar,        href: '/admin/demo-bookings' },
  { name: 'Businesses',    icon: Building2,       href: '/admin/businesses' },
  { name: 'Subscriptions', icon: CreditCard,      href: '/admin/subscriptions' },
  { name: 'Revenue',       icon: DollarSign,      href: '/admin/revenue' },
  { name: 'Audit Monitor', icon: Zap,             href: '/admin/audits' },
  { name: 'CRM Monitor',   icon: MessageSquare,   href: '/admin/crm' },
  { name: 'WhatsApp Monitor', icon: MessageSquare, href: '/admin/whatsapp' },
  { name: 'Review Monitor', icon: Star,           href: '/admin/reviews' },
  { name: 'Content Monitor', icon: Megaphone,     href: '/admin/content' },
  { name: 'System Health', icon: Activity,        href: '/admin/system' },
  { name: 'API Usage',     icon: Activity,        href: '/admin/api-usage' },
  { name: 'AI Usage',      icon: BrainCircuit,    href: '/admin/ai-usage' },
  { name: 'Queues & Jobs', icon: Clock,           href: '/admin/jobs' },
  { name: 'Support',       icon: Headset,         href: '/admin/support' },
  { name: 'Settings',      icon: Settings,        href: '/admin/settings' },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    router.push('/admin-login');
    router.refresh();
  };

  return (
    <aside className="w-64 border-r border-slate-200 bg-white flex flex-col hidden lg:flex h-screen fixed top-0 left-0 z-50 overflow-y-auto custom-scrollbar">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 mb-6 group">
          <div className="w-8 h-8 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center group-hover:rotate-12 transition-transform duration-300">
            <Rocket className="text-primary w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">
            GMB<span className="text-primary">Boost</span>
          </span>
        </Link>

        <div className="mb-6 px-3 py-2 bg-violet-50 border border-violet-100 rounded-xl flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-violet-600 flex-shrink-0" />
          <span className="text-xs font-bold text-violet-700 uppercase tracking-wider">
            Super Admin
          </span>
        </div>

        <nav className="space-y-1">
          {adminLinks.map(link => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + '/');
            return (
              <Link
                key={link.name}
                href={link.href}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all border border-transparent',
                  isActive
                    ? 'bg-violet-50 text-violet-700 border-violet-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                )}
              >
                <link.icon className="w-5 h-5" />
                <span className="font-medium text-sm">{link.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6">
        <div className="mb-3 px-4 py-2 text-xs text-slate-400 font-medium">
          Back to regular app?{' '}
          <Link href="/dashboard" className="text-indigo-600 hover:underline">
            Dashboard
          </Link>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-400/10 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium text-sm">Logout</span>
        </button>
      </div>
    </aside>
  );
}