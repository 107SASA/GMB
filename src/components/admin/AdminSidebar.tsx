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
  Star,
  Megaphone,
  Clock,
  SlidersHorizontal,
  KanbanSquare,
  MessageCircle,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const adminGroups = [
  {
    label: null,
    links: [
      { name: 'Dashboard',     icon: LayoutDashboard, href: '/admin' },
      { name: 'Customers',     icon: Users,           href: '/admin/customers' },
      { name: 'Businesses',    icon: Building2,       href: '/admin/businesses' },
      { name: 'Subscriptions', icon: CreditCard,      href: '/admin/subscriptions' },
      { name: 'Revenue',       icon: DollarSign,      href: '/admin/revenue' },
    ],
  },
  {
    label: 'OPERATIONS',
    links: [
      { name: 'System Health',  icon: Activity,        href: '/admin/system' },
      { name: 'Queues & Jobs',  icon: Clock,           href: '/admin/jobs' },
      { name: 'Automations',    icon: Zap,             href: '/admin/automations' },
      { name: 'AI & API Usage', icon: BrainCircuit,    href: '/admin/ai-usage' },
    ],
  },
  {
    label: 'ACTIVITY MONITOR',
    links: [
      { name: 'Audit Monitor',    icon: Zap,           href: '/admin/audits' },
      { name: 'Content Monitor',  icon: Megaphone,     href: '/admin/content' },
      { name: 'CRM Monitor',      icon: KanbanSquare,  href: '/admin/crm' },
      { name: 'Review Monitor',   icon: Star,          href: '/admin/reviews' },
      { name: 'WhatsApp Monitor', icon: MessageCircle, href: '/admin/whatsapp' },
    ],
  },
  {
    label: 'ADMIN',
    links: [
      { name: 'Settings', icon: SlidersHorizontal, href: '/admin/settings' },
    ],
  },
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

        <nav>
          {adminGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="px-4 pt-5 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {group.label}
                </div>
              )}
              <div className="space-y-1">
                {group.links.map(link => {
                  const isActive =
                    pathname === link.href ||
                    (link.href !== '/admin' && pathname.startsWith(link.href + '/'));
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
              </div>
            </div>
          ))}
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
