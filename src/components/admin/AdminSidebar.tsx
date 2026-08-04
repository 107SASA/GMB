'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

const adminGroups = [
  {
    label: null as string | null,
    links: [
      { name: 'Dashboard', icon: 'dashboard', href: '/admin' },
      { name: 'Sales Leads', icon: 'view_kanban', href: '/admin/leads' },
      { name: 'Customers', icon: 'group', href: '/admin/customers' },
      { name: 'Businesses', icon: 'storefront', href: '/admin/businesses' },
      { name: 'Subscriptions', icon: 'credit_card', href: '/admin/subscriptions' },
      { name: 'Revenue', icon: 'payments', href: '/admin/revenue' },
    ],
  },
  {
    label: 'OPERATIONS',
    links: [
      { name: 'System Health', icon: 'monitor_heart', href: '/admin/system' },
      { name: 'Automations', icon: 'bolt', href: '/admin/automations' },
      { name: 'AI & API Usage', icon: 'psychology', href: '/admin/ai-usage' },
    ],
  },
  {
    label: 'ACTIVITY MONITOR',
    links: [
      { name: 'Audit Monitor', icon: 'analytics', href: '/admin/audits' },
      { name: 'Content Monitor', icon: 'campaign', href: '/admin/content' },
      { name: 'CRM Monitor', icon: 'view_kanban', href: '/admin/crm' },
      { name: 'Review Monitor', icon: 'star', href: '/admin/reviews' },
      { name: 'WhatsApp Monitor', icon: 'chat', href: '/admin/whatsapp' },
      { name: 'WhatsApp Inbox', icon: 'forum', href: '/admin/whatsapp-agent' },
      { name: 'Demo Bookings', icon: 'event_note', href: '/admin/demo-bookings' },
    ],
  },
  // Separate from ACTIVITY MONITOR on purpose — these edit live WhatsApp
  // message templates (config), the group above is read-only observation.
  {
    label: 'WHATSAPP AGENTS',
    links: [
      { name: 'Sales Agent', icon: 'support_agent', href: '/admin/sales-agent' },
      { name: 'Booking Agent', icon: 'event_available', href: '/admin/booking-agent' },
      { name: 'Report Agent', icon: 'summarize', href: '/admin/report-agent' },
    ],
  },
  {
    label: 'ADMIN',
    links: [
      { name: 'Settings', icon: 'tune', href: '/admin/settings' },
      { name: 'Support', icon: 'headset_mic', href: '/admin/support' },
      { name: 'Team Invites', icon: 'person_add', href: '/admin/invites' },
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
    <aside className="w-64 border-r border-outline-variant bg-surface-container-low flex flex-col hidden lg:flex h-screen fixed top-0 left-0 z-50 overflow-y-auto custom-scrollbar">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2 mb-6 group">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <MaterialIcon name="rocket_launch" size={18} className="text-on-primary" />
          </div>
          <span className="text-lg font-heading font-bold tracking-tight text-on-surface">
            Groww<span className="text-primary">Matics</span> AI
          </span>
        </Link>

        <div className="mb-6 px-3 py-2 bg-primary-fixed border border-primary-fixed-dim rounded-lg flex items-center gap-2">
          <MaterialIcon name="shield" size={16} className="text-primary flex-shrink-0" />
          <span className="text-xs font-bold text-primary uppercase tracking-wider">
            Super Admin
          </span>
        </div>

        <nav>
          {adminGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <div className="px-4 pt-5 pb-1 text-label-sm text-on-surface-variant">
                  {group.label}
                </div>
              )}
              <div className="space-y-1">
                {group.links.map((link) => {
                  const isActive =
                    pathname === link.href ||
                    (link.href !== '/admin' && pathname.startsWith(link.href + '/'));
                  return (
                    <Link
                      key={link.name}
                      href={link.href}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all',
                        isActive
                          ? 'bg-primary-container text-on-primary-container'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                      )}
                    >
                      <MaterialIcon name={link.icon} size={20} filled={isActive} />
                      <span className="font-medium text-sm">{link.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-2">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-error hover:bg-error-container transition-all"
        >
          <MaterialIcon name="logout" size={20} />
          <span className="font-medium text-sm">Logout</span>
        </button>
      </div>
    </aside>
  );
}
