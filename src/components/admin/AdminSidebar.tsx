'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

// SuperAdmin navigation — reorganised Sep 2026 around the Sales → Demo →
// Payment → Customer conversion lifecycle.
//
//   CONVERSION group   = the Lead Engine acquisition funnel (Lead model,
//                        tenantId 'gmbboost-internal'). "Leads & Pipeline"
//                        REPLACES the old "GrowwMatics Pipeline" Kanban that
//                        ran on the legacy Business.pipelineStage field.
//   Customer Leads     = a DIFFERENT thing — the leads our CUSTOMERS build
//                        their own CRM from (leadType 'Client Prospect').
//                        Moved under MONITORS and renamed to make that clear.
//   /admin/support     = removed from nav (thin mailto: stub; the support
//                        email lives in Settings). Route left in place.
const adminGroups = [
  {
    label: null as string | null,
    links: [
      { name: 'Overview', icon: 'dashboard', href: '/admin' },
    ],
  },
  {
    label: 'CONVERSION',
    links: [
      { name: 'Conversion Overview', icon: 'trending_up', href: '/admin/pipeline' },
      { name: 'Leads & Pipeline', icon: 'filter_alt', href: '/admin/leads' },
      { name: 'Demos', icon: 'event_available', href: '/admin/demo-bookings' },
      { name: 'Analytics', icon: 'query_stats', href: '/admin/conversion-analytics' },
    ],
  },
  {
    label: 'CUSTOMERS & BILLING',
    links: [
      { name: 'Customers', icon: 'group', href: '/admin/customers' },
      { name: 'Businesses', icon: 'storefront', href: '/admin/businesses' },
      { name: 'Subscriptions', icon: 'credit_card', href: '/admin/subscriptions' },
      { name: 'Revenue', icon: 'payments', href: '/admin/revenue' },
    ],
  },
  {
    label: 'AGENTS',
    links: [
      { name: 'Sales Agent', icon: 'support_agent', href: '/admin/sales-agent' },
      { name: 'Booking Agent', icon: 'event_note', href: '/admin/booking-agent' },
      { name: 'Report Agent', icon: 'summarize', href: '/admin/report-agent' },
      { name: 'WhatsApp Inbox', icon: 'forum', href: '/admin/whatsapp-agent' },
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
    label: 'MONITORS',
    links: [
      { name: 'Customer Leads (tenant CRM)', icon: 'contacts', href: '/admin/crm' },
      { name: 'Audit Monitor', icon: 'analytics', href: '/admin/audits' },
      { name: 'Content Monitor', icon: 'campaign', href: '/admin/content' },
      { name: 'Review Monitor', icon: 'star', href: '/admin/reviews' },
      { name: 'WhatsApp Monitor', icon: 'chat', href: '/admin/whatsapp' },
    ],
  },
  // Approve/reject client submissions before they go public on
  // growwmatics.com/showcase (photo/video uploads and client testimonials).
  {
    label: 'MODERATION QUEUE',
    links: [
      { name: 'Showcase Approvals', icon: 'photo_camera', href: '/admin/showcase' },
      { name: 'Testimonial Approvals', icon: 'rate_review', href: '/admin/testimonials' },
    ],
  },
  {
    label: 'ADMIN',
    links: [
      { name: 'Settings', icon: 'tune', href: '/admin/settings' },
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
          <img src="/brand/icon.png" alt="GrowwMatics AI" className="w-8 h-8 object-contain" />
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
