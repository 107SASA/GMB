'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, CheckCircle2, ArrowRight, RefreshCw,
  BarChart3, FileText, Bot, Clock,
  TrendingUp, Crown, Download, Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { planDisplayLabel, isPaidPlanLabel } from '@/lib/billing/planLabel';
import Link from 'next/link';
import { useBusiness } from '@/context/BusinessContext';
import { BRAND_ATTRIBUTION } from '@/lib/companyInfo';

interface BillingStatus {
  planType: string;
  billingStatus: string;
  trialStatus?: { isActive: boolean; endsAt?: string };
  modules?: Record<string, { enabled: boolean }>;
  hasPaymentMethod: boolean;
  currentPeriodEnd: string | null;
}

const MODULE_LABELS: Record<string, string> = {
  google_ranking_agent: 'Google Ranking Agent',
  reputation_agent: 'Reputation Agent',
  sales_agent: 'AI Sales Agent',
  content_studio: 'Content Studio',
  marketing_automation: 'Marketing Automation',
};

interface UsageData {
  plan: string;
  month: string;
  limits: {
    maxAuditsPerBusiness:      number;
    maxPostsPerMonth:          number;
    postLimitFrequency?:       'monthly' | 'weekly';
    maxWhatsAppMessagesPerDay: number;
    reviewRequestCooldownDays: number;
    maxAIGenerations:          number;
  };
  usage: {
    auditsUsed:        number;
    postsUsed:         number;
    whatsappUsed:      number;
    aiGenerationsUsed: number;
  };
  hasOverride: boolean;
}

function UsageBar({
  label, icon: Icon, used, limit, color,
}: {
  label: string;
  icon: React.ElementType;
  used: number;
  limit: number;
  color: string;
}) {
  const pct = limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const isWarning = pct >= 80;
  const isFull = pct >= 100;

  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', color)}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-on-surface">{label}</span>
        </div>
        <span className={cn(
          'text-sm font-bold',
          isFull ? 'text-error' : isWarning ? 'text-error' : 'text-on-surface'
        )}>
          {used} <span className="text-outline font-normal">/ {limit}</span>
        </span>
      </div>
      <div className="h-2 bg-surface-container rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isFull ? 'bg-error' : isWarning ? 'bg-error' : 'bg-secondary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-outline">{pct}% used</span>
        {isFull ? (
          <span className="text-[11px] font-bold text-error">Limit reached</span>
        ) : isWarning ? (
          <span className="text-[11px] font-bold text-error">{limit - used} remaining</span>
        ) : (
          <span className="text-[11px] text-outline">{limit - used} remaining</span>
        )}
      </div>
    </div>
  );
}

function PlanBadge({ plan, planName }: { plan: string; planName?: string | null }) {
  // 'Pro'/'Enterprise' are internal values, never shown to a customer — there
  // is only one sellable plan. See src/lib/billing/planLabel.ts.
  const paid = isPaidPlanLabel(plan);
  return (
    <span
      className={cn(
        'px-3 py-1 text-sm font-bold rounded-lg border',
        paid
          ? 'bg-primary-fixed text-primary border-primary-fixed-dim'
          : 'bg-surface-container text-on-surface-variant border-outline-variant'
      )}
    >
      {planDisplayLabel(plan, planName)}
    </span>
  );
}

interface WorkspaceBilling {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
  isActive?: boolean;
}

function SubscriptionCard() {
  const { activeBusiness } = useBusiness();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceBilling | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState('');

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/billing/status');
      const json = await res.json();
      if (json.success) { setStatus(json.subscription); setWorkspace(json.workspace ?? null); }
    } catch { /* card just doesn't render */ }
  };

  // /api/billing/status reads the ACTIVE workspace's subscription — this
  // previously fetched once on mount only, so switching workspaces left the
  // billing card showing the PREVIOUS workspace's plan/status, which could
  // seriously mislead a user about whether the workspace they're looking at
  // is actually paid.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    loadStatus();
  }, [activeBusiness?._id]);

  if (!status) return null;

  const statusStyles: Record<string, string> = {
    Active:   'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
    Trialing: 'bg-primary-fixed text-primary border-primary-fixed-dim',
    PastDue:  'bg-error-container text-on-error-container border-error',
    Canceled: 'bg-surface-container text-on-surface-variant border-outline-variant',
  };

  const enabledModules = Object.entries(status.modules ?? {})
    .filter(([, v]) => v?.enabled)
    .map(([k]) => MODULE_LABELS[k] ?? k);

  const handleCancel = async () => {
    setCancelling(true); setMessage('');
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setMessage(json.message);
        setConfirmCancel(false);
        // Cancel-at-period-end sets the workspace flag synchronously, so the
        // "won't renew / access until" state shows right away.
        loadStatus();
      } else {
        setMessage(json.error || 'Cancellation failed');
      }
    } catch {
      setMessage('Network error');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-on-surface">Subscription</h2>
        <span className={cn(
          'px-2.5 py-1 text-xs font-bold rounded-lg border',
          statusStyles[status.billingStatus] ?? statusStyles.Canceled
        )}>
          {status.billingStatus}
        </span>
      </div>

      <div className="space-y-2.5 text-sm">
        <div className="flex items-center justify-between py-2 border-b border-outline-variant">
          <span className="text-on-surface-variant">Plan</span>
          <PlanBadge plan={status.planType} />
        </div>
        {status.trialStatus?.isActive && status.trialStatus.endsAt && (
          <div className="flex items-center justify-between py-2 border-b border-outline-variant">
            <span className="text-on-surface-variant">Trial ends</span>
            <span className="font-bold text-on-surface">
              {new Date(status.trialStatus.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
        {(status.currentPeriodEnd || workspace?.currentPeriodEnd) && status.billingStatus === 'Active' && (
          <div className="flex items-center justify-between py-2 border-b border-outline-variant">
            <span className="text-on-surface-variant">{workspace?.cancelAtPeriodEnd ? 'Access until' : 'Renews on'}</span>
            <span className="font-bold text-on-surface">
              {new Date((workspace?.currentPeriodEnd || status.currentPeriodEnd)!).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
        {workspace?.cancelAtPeriodEnd && (
          <div className="flex items-start gap-2 py-2 text-xs text-on-error-container bg-error-container border border-error-container rounded-lg px-3">
            <span>Your subscription is cancelled and <strong>won&apos;t renew</strong>. You keep full access until the date above — then this workspace locks. Resubscribe anytime to stay unlocked.</span>
          </div>
        )}
        <div className="py-2">
          <span className="text-on-surface-variant block mb-2">Enabled modules</span>
          <div className="flex flex-wrap gap-1.5">
            {enabledModules.length > 0 ? enabledModules.map(m => (
              <span key={m} className="px-2 py-0.5 text-xs font-semibold bg-primary-fixed text-primary border border-primary-fixed-dim rounded-md">
                {m}
              </span>
            )) : (
              <span className="text-xs text-outline">None</span>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className="mt-3 p-3 bg-surface border border-outline-variant rounded-lg text-xs text-on-surface-variant">{message}</div>
      )}

      <div className="mt-4 flex items-center gap-3">
        {(status.billingStatus !== 'Active' || workspace?.cancelAtPeriodEnd) && (
          <Link
            href="/pricing"
            className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary-container transition-colors"
          >
            {workspace?.cancelAtPeriodEnd ? 'Resubscribe' : 'Subscribe'}
          </Link>
        )}
        {status.hasPaymentMethod && status.billingStatus === 'Active' && !workspace?.cancelAtPeriodEnd && (
          confirmCancel ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Confirm cancel'}
              </button>
              <button
                onClick={() => setConfirmCancel(false)}
                className="px-3 py-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface"
              >
                Keep plan
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmCancel(true)}
              className="px-4 py-2 text-sm font-semibold text-error hover:bg-error-container rounded-xl transition-colors"
            >
              Cancel subscription
            </button>
          )
        )}
      </div>
    </div>
  );
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  paidAt: string | null;
  downloadUrl: string | null;
}

function InvoicesCard() {
  const { activeBusiness } = useBusiness();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/invoices');
      const json = await res.json();
      setInvoices(json.success ? json.invoices : []);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!activeBusiness?._id) return;
    load();
  }, [activeBusiness?._id]);

  // No payment has ever gone through for this workspace — nothing to show,
  // and no point rendering an empty card above the fold.
  if (!loading && invoices && invoices.length === 0) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
      <div className="flex items-center gap-2 mb-4">
        <Receipt className="w-4 h-4 text-on-surface-variant" />
        <h2 className="text-base font-bold text-on-surface">Invoices</h2>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-11 bg-surface-container rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-outline-variant">
          {invoices!.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  {inv.paidAt
                    ? new Date(inv.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
                    : inv.invoiceNumber}
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  ₹{inv.amount.toLocaleString('en-IN')} · {inv.invoiceNumber}
                </p>
              </div>
              {inv.downloadUrl ? (
                <a
                  href={inv.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-primary bg-primary-fixed hover:bg-primary-fixed-dim rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              ) : (
                <span className="text-xs text-outline">Unavailable</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  const router = useRouter();
  const { activeBusiness } = useBusiness();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/user/usage');
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error || 'Failed to load usage');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  // Despite the URL, /api/user/usage reads SubscriptionUsage scoped by the
  // ACTIVE business (see src/app/api/user/usage/route.ts) — this previously
  // fetched once on mount only, so switching workspaces left the usage
  // panel showing the PREVIOUS workspace's numbers.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    load();
  }, [activeBusiness?._id]);

  const monthLabel = data
    ? new Date(`${data.month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface tracking-tight">Usage & Billing</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Your plan usage for {monthLabel || '...'}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-error-container border border-error-container rounded-xl text-sm text-on-error-container">{error}</div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-5 shadow-sm animate-pulse">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 bg-surface-container-high rounded-lg" />
                <div className="h-4 w-32 bg-surface-container-high rounded" />
              </div>
              <div className="h-2 bg-surface-container rounded-full" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Subscription (Razorpay) */}
          <SubscriptionCard />

          {/* Downloadable invoices — Razorpay-hosted, one per successful charge */}
          <InvoicesCard />

          {/* Plan card */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5 flex items-center gap-4">
            <div className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              isPaidPlanLabel(data.plan) ? 'bg-primary' : 'bg-outline'
            )}>
              <Crown className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold text-on-surface">Current Plan</span>
                <PlanBadge plan={data.plan} />
                {data.hasOverride && (
                  <span className="text-[10px] font-bold text-primary bg-primary-fixed border border-primary-fixed-dim px-1.5 py-0.5 rounded-md">Custom limits</span>
                )}
              </div>
              <p className="text-sm text-on-surface-variant">Resets on the 1st of every month</p>
            </div>
            {data.plan === 'Free' && (
              <Link
                href="#upgrade"
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary-container transition-colors shadow-sm"
              >
                <Zap className="w-4 h-4" /> Upgrade
              </Link>
            )}
          </div>

          {/* Usage bars */}
          <div>
            <h2 className="text-base font-bold text-on-surface mb-3">This Month's Usage</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <UsageBar
                label="AI Generations"
                icon={Bot}
                used={data.usage.aiGenerationsUsed}
                limit={data.limits.maxAIGenerations}
                color="bg-primary"
              />
              <UsageBar
                label="Audits Run"
                icon={FileText}
                used={data.usage.auditsUsed}
                limit={data.limits.maxAuditsPerBusiness}
                color="bg-primary"
              />
              <UsageBar
                label={data.limits.postLimitFrequency === 'weekly' ? 'Posts Generated (This Week)' : 'Posts Generated'}
                icon={BarChart3}
                used={data.usage.postsUsed}
                limit={data.limits.maxPostsPerMonth}
                color="bg-secondary"
              />
              {/* WhatsApp usage is no longer surfaced as a billed/limited
                  feature on the customer-facing billing page — the sales &
                  booking WhatsApp agents keep working and usage still tracks
                  internally (SubscriptionUsage.whatsappMessagesUsed), this is
                  a display-only removal. */}
            </div>
          </div>

          {/* Plan limits reference */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
            <h2 className="text-base font-bold text-on-surface mb-4">Plan Limits</h2>
            <div className="space-y-2.5 text-sm">
              {[
                { label: 'AI Generations / Month',     icon: Bot,            value: data.limits.maxAIGenerations },
                { label: 'Audits / Business / Month',  icon: FileText,       value: data.limits.maxAuditsPerBusiness },
                { label: data.limits.postLimitFrequency === 'weekly' ? 'Posts / Week' : 'Posts / Month', icon: BarChart3, value: data.limits.maxPostsPerMonth },
                { label: 'Review Request Cooldown',     icon: Clock,          value: `${data.limits.reviewRequestCooldownDays} days` },
              ].map(({ label, icon: Icon, value }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-outline-variant last:border-0">
                  <div className="flex items-center gap-2 text-on-surface-variant">
                    <Icon className="w-4 h-4 text-outline" />
                    {label}
                  </div>
                  <span className="font-bold text-on-surface">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Subscribe CTA — only shown to unpaid users; there is one plan */}
          {data.plan === 'Free' && (
            <div id="upgrade" className="bg-linear-to-br from-primary to-primary-container rounded-2xl p-6 text-white card-shadow card-shadow">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-surface-container-lowest/20 rounded-xl flex items-center justify-center shrink-0">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold mb-1">Unlock all features</h2>
                  <p className="text-on-primary-container text-sm mb-4">
                    One plan, everything included — on the website and the mobile app.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-5 text-sm">
                    {[
                      'Google Ranking Agent',
                      'Reputation Agent',
                      'AI Sales Agent',
                      'Content Studio',
                      'Marketing Automation',
                      'Higher usage limits',
                    ].map(b => (
                      <div key={b} className="flex items-center gap-2 text-on-primary-container">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {b}
                      </div>
                    ))}
                  </div>
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-surface-container-lowest text-primary font-bold rounded-xl hover:bg-primary-fixed transition-colors shadow-sm text-sm"
                  >
                    Subscribe now
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

      <p className="text-center text-xs text-outline pt-2">{BRAND_ATTRIBUTION}</p>
    </div>
  );
}
