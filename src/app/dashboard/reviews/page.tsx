'use client';

import { useState } from 'react';
import { Star, Megaphone } from 'lucide-react';
import ReviewsDashboard from '@/components/reviews/ReviewsDashboard';
import CampaignsDashboard from '@/components/reviews/CampaignsDashboard';

type Tab = 'monitor' | 'campaigns';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'monitor', label: 'Monitor Reviews', icon: Star },
  { id: 'campaigns', label: 'Review Campaigns', icon: Megaphone },
];

export default function ReviewManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('monitor');

  return (
    <div className="min-h-screen bg-surface/50 p-4 pt-10">
      <div className="max-w-350 mx-auto space-y-6">

        {/* Page header */}
        <div>
          <h1 className="font-heading text-3xl font-bold text-on-surface tracking-tight">Review Management</h1>
          <p className="text-on-surface-variant mt-1">Monitor incoming reviews and run campaigns to acquire new ones.</p>
        </div>

        {/* Top-level tabs */}
        <div className="flex gap-2 border-b border-outline-variant pb-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-tour={tab.id === 'campaigns' ? 'review-campaigns-tab' : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all -mb-px ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'monitor' && <ReviewsDashboard />}
        {activeTab === 'campaigns' && <CampaignsDashboard />}
      </div>
    </div>
  );
}
