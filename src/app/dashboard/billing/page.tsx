'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, CheckCircle2, ArrowRight, RefreshCw,
  BarChart3, FileText, MessageSquare, Bot, Clock,
  TrendingUp, Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface UsageData {
  plan: string;
  month: string;
  limits: {
    maxAuditsPerBusiness:      number;
    maxPostsPerMonth:          number;
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
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', color)}>
            <Icon className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700">{label}</span>
        </div>
        <span className={cn(
          'text-sm font-bold',
          isFull ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-slate-900'
        )}>
          {used} <span className="text-slate-400 font-normal">/ {limit}</span>
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isFull ? 'bg-red-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-slate-400">{pct}% used</span>
        {isFull ? (
          <span className="text-[11px] font-bold text-red-500">Limit reached</span>
        ) : isWarning ? (
          <span className="text-[11px] font-bold text-amber-500">{limit - used} remaining</span>
        ) : (
          <span className="text-[11px] text-slate-400">{limit - used} remaining</span>
        )}
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, string> = {
    Free:       'bg-slate-100 text-slate-600 border-slate-200',
    Pro:        'bg-indigo-50 text-indigo-700 border-indigo-100',
    Enterprise: 'bg-violet-50 text-violet-700 border-violet-100',
  };
  return (
    <span className={cn('px-3 py-1 text-sm font-bold rounded-lg border', map[plan] ?? map.Free)}>
      {plan}
    </span>
  );
}

export default function BillingPage() {
  const router = useRouter();
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

  useEffect(() => { load(); }, []);

  const monthLabel = data
    ? new Date(`${data.month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Usage & Billing</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your plan usage for {monthLabel || '...'}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 bg-slate-200 rounded-lg" />
                <div className="h-4 w-32 bg-slate-200 rounded" />
              </div>
              <div className="h-2 bg-slate-100 rounded-full" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Plan card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
            <div className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center',
              data.plan === 'Enterprise' ? 'bg-violet-600' :
              data.plan === 'Pro'        ? 'bg-indigo-600' : 'bg-slate-400'
            )}>
              <Crown className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold text-slate-900">Current Plan</span>
                <PlanBadge plan={data.plan} />
                {data.hasOverride && (
                  <span className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-md">Custom limits</span>
                )}
              </div>
              <p className="text-sm text-slate-500">Resets on the 1st of every month</p>
            </div>
            {data.plan === 'Free' && (
              <Link
                href="#upgrade"
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 transition-colors shadow-sm"
              >
                <Zap className="w-4 h-4" /> Upgrade
              </Link>
            )}
          </div>

          {/* Usage bars */}
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-3">This Month's Usage</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <UsageBar
                label="AI Generations"
                icon={Bot}
                used={data.usage.aiGenerationsUsed}
                limit={data.limits.maxAIGenerations}
                color="bg-violet-500"
              />
              <UsageBar
                label="Audits Run"
                icon={FileText}
                used={data.usage.auditsUsed}
                limit={data.limits.maxAuditsPerBusiness}
                color="bg-blue-500"
              />
              <UsageBar
                label="Posts Generated"
                icon={BarChart3}
                used={data.usage.postsUsed}
                limit={data.limits.maxPostsPerMonth}
                color="bg-emerald-500"
              />
              <UsageBar
                label="WhatsApp Messages"
                icon={MessageSquare}
                used={data.usage.whatsappUsed}
                limit={data.limits.maxWhatsAppMessagesPerDay}
                color="bg-amber-500"
              />
            </div>
          </div>

          {/* Plan limits reference */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-slate-900 mb-4">Plan Limits</h2>
            <div className="space-y-2.5 text-sm">
              {[
                { label: 'AI Generations / Month',     icon: Bot,            value: data.limits.maxAIGenerations },
                { label: 'Audits / Business / Month',  icon: FileText,       value: data.limits.maxAuditsPerBusiness },
                { label: 'Posts / Month',               icon: BarChart3,      value: data.limits.maxPostsPerMonth },
                { label: 'WhatsApp Messages / Day',     icon: MessageSquare,  value: data.limits.maxWhatsAppMessagesPerDay },
                { label: 'Review Request Cooldown',     icon: Clock,          value: `${data.limits.reviewRequestCooldownDays} days` },
              ].map(({ label, icon: Icon, value }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Icon className="w-4 h-4 text-slate-400" />
                    {label}
                  </div>
                  <span className="font-bold text-slate-800">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upgrade CTA — only shown on Free/Pro */}
          {data.plan !== 'Enterprise' && (
            <div id="upgrade" className="bg-linear-to-br from-violet-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg shadow-violet-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold mb-1">
                    {data.plan === 'Free' ? 'Upgrade to Pro' : 'Upgrade to Enterprise'}
                  </h2>
                  <p className="text-violet-200 text-sm mb-4">
                    Get higher limits, more AI generations, and priority processing.
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-5 text-sm">
                    {(data.plan === 'Free' ? [
                      '100 AI generations/month',
                      '10 audits/business',
                      '50 posts/month',
                      '200 WhatsApp msgs/day',
                    ] : [
                      '500 AI generations/month',
                      '50 audits/business',
                      '200 posts/month',
                      '1000 WhatsApp msgs/day',
                    ]).map(b => (
                      <div key={b} className="flex items-center gap-2 text-violet-100">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        {b}
                      </div>
                    ))}
                  </div>
                  <button className="flex items-center gap-2 px-6 py-3 bg-white text-violet-700 font-bold rounded-xl hover:bg-violet-50 transition-colors shadow-sm text-sm">
                    Contact us to upgrade
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
