'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  BrainCircuit,
  Zap,
  DollarSign,
  XCircle,
  RefreshCw,
  ArrowUpRight,
  MessageCircle,
  CheckCircle2,
  Clock,
  AlertCircle,
  BarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DailyStat { date: string; generations: number; tokens: number; cost: number; failed: number; }
interface TopUser { userId: string; fullName: string; email: string; plan: string; generations: number; tokens: number; estimatedCost: number; }
interface PromptBucket { _id: string; count: number; tokens: number; }
interface RecentActivity { _id: string; userName: string; userEmail: string; promptType: string; aiModel: string; tokensUsed: number; estimatedCost: number; status: string; createdAt: string; }
interface AIData {
  overview: { totalGenerations: number; totalTokens: number; totalCost: number; failedGenerations: number; successRate: number; };
  period: { days: number; generations: number; tokens: number; cost: number; failedCount: number; };
  dailyStats: DailyStat[];
  topUsers: TopUser[];
  promptBreakdown: PromptBucket[];
  recentActivity: RecentActivity[];
}
interface APIData {
  groq:         { tracked: boolean; calls: number; tokens: number; cost: number; byDay: any[]; };
  twilio:       { tracked: boolean; sent: number; failed: number; pending: number; total: number; byDay: any[]; };
  serp:         { tracked: boolean; calls: number; note: string | null; };
  googlePlaces: { tracked: boolean; note: string; };
}

const RANGE_OPTIONS = [
  { label: '7 days',  value: '7' },
  { label: '14 days', value: '14' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
];

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ title, value, sub, icon: Icon, color, subColor = 'text-secondary' }: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; subColor?: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {sub && (
          <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg bg-surface ${subColor}`}>
            <ArrowUpRight className="w-3 h-3" />{sub}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-on-surface mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-sm font-medium text-on-surface-variant">{title}</div>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-outline w-8 text-right">{pct}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
    failed:  'bg-error-container    text-on-error-container    border-error-container',
    partial: 'bg-primary-fixed   text-primary   border-primary-fixed-dim',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[status] ?? map.partial)}>
      {status}
    </span>
  );
}

// ── API Usage tab content ─────────────────────────────────────────────────────
function APIUsageTab({ range }: { range: string }) {
  const router = useRouter();
  const [data, setData]       = useState<APIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const fetchData = useCallback(async (r = range) => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`/api/admin/ai-usage?tab=api&range=${r}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else if (json.error?.includes('Unauthorized') || json.error?.includes('Forbidden')) {
        router.push('/admin/login');
      } else {
        setError(json.error || 'Failed to load API usage data');
      }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  }, [range, router]);

  useEffect(() => { fetchData(range); }, [range, fetchData]);

  if (loading) return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
    </div>
  );
  if (error) return (
    <div className="text-center py-12">
      <p className="text-error text-sm font-medium mb-2">{error}</p>
      <button onClick={() => fetchData()} className="text-sm text-primary hover:underline">Retry</button>
    </div>
  );
  if (!data) return null;

  const { groq, twilio, serp, googlePlaces } = data;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

      {/* Groq */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-on-surface">Groq</h3>
            <p className="text-xs text-outline">AI inference API</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-2xl font-bold text-on-surface">{groq.calls.toLocaleString()}</div>
            <div className="text-xs text-on-surface-variant">Calls ({range}d)</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-on-surface">{groq.tokens.toLocaleString()}</div>
            <div className="text-xs text-on-surface-variant">Tokens</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-on-surface">${groq.cost.toFixed(4)}</div>
            <div className="text-xs text-on-surface-variant">Est. Cost</div>
          </div>
        </div>
        {groq.calls === 0 && (
          <p className="text-xs text-outline italic">No Groq calls logged in this period</p>
        )}
      </div>

      {/* Twilio */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-on-surface">Twilio / WhatsApp</h3>
            <p className="text-xs text-outline">Outbound messages sent</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-secondary" />
              <span className="text-2xl font-bold text-on-surface">{twilio.sent}</span>
            </div>
            <div className="text-xs text-on-surface-variant">Sent</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <XCircle className="w-3.5 h-3.5 text-error" />
              <span className="text-2xl font-bold text-on-surface">{twilio.failed}</span>
            </div>
            <div className="text-xs text-on-surface-variant">Failed</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-3.5 h-3.5 text-primary-fixed-dim" />
              <span className="text-2xl font-bold text-on-surface">{twilio.pending}</span>
            </div>
            <div className="text-xs text-on-surface-variant">Pending</div>
          </div>
        </div>
        {twilio.total > 0 && (
          <div>
            <div className="flex justify-between text-xs text-outline mb-1">
              <span>Delivery rate</span>
              <span>{twilio.total > 0 ? Math.round((twilio.sent / twilio.total) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
              <div
                className="h-full bg-secondary rounded-full"
                style={{ width: `${twilio.total > 0 ? (twilio.sent / twilio.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
        {twilio.total === 0 && (
          <p className="text-xs text-outline italic">No outbound messages in this period</p>
        )}
      </div>

      {/* SerpApi */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
            <BarChart2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-on-surface">SerpApi</h3>
            <p className="text-xs text-outline">Google search data</p>
          </div>
        </div>
        {serp.tracked ? (
          <div>
            <div className="text-2xl font-bold text-on-surface mb-1">{serp.calls.toLocaleString()}</div>
            <div className="text-xs text-on-surface-variant">Calls found in AutomationLog ({range}d)</div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 bg-primary-fixed border border-primary-fixed-dim rounded-xl">
            <AlertCircle className="w-4 h-4 text-primary-fixed-dim flex-shrink-0 mt-0.5" />
            <p className="text-xs text-primary font-medium">{serp.note}</p>
          </div>
        )}
      </div>

      {/* Google Places */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-error rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base font-bold text-on-surface">Google Places</h3>
            <p className="text-xs text-outline">Places API calls</p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 bg-primary-fixed border border-primary-fixed-dim rounded-xl">
          <AlertCircle className="w-4 h-4 text-primary-fixed-dim flex-shrink-0 mt-0.5" />
          <p className="text-xs text-primary font-medium">{googlePlaces.note}</p>
        </div>
      </div>

    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AIUsagePage() {
  const router = useRouter();
  const [activeTab, setActiveTab]   = useState<'ai' | 'api'>('ai');
  const [data, setData]             = useState<AIData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange]           = useState('7');
  const [error, setError]           = useState('');

  const fetchAIData = useCallback(async (r = range, isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/admin/ai-usage?range=${r}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else if (json.error?.includes('Unauthorized') || json.error?.includes('Forbidden')) {
        router.push('/admin/login');
      } else {
        setError(json.error || 'Failed to load AI usage data');
      }
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [range, router]);

  useEffect(() => { fetchAIData(); }, [fetchAIData]);

  const handleRange = (r: string) => { setRange(r); if (activeTab === 'ai') fetchAIData(r); };

  // ── Shared header ─────────────────────────────────────────────────────────
  const Header = (
    <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center card-shadow">
          <BrainCircuit className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">AI & API Usage</h1>
          <p className="text-sm text-on-surface-variant font-medium">Platform-wide consumption analytics</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-surface-container-lowest border border-outline-variant rounded-xl p-1 shadow-sm">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleRange(opt.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                range === opt.value ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {activeTab === 'ai' && (
          <button
            onClick={() => fetchAIData(range, true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface transition-all shadow-sm disabled:opacity-60"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            Refresh
          </button>
        )}
      </div>
    </div>
  );

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const Tabs = (
    <div className="flex gap-1 bg-surface-container rounded-xl p-1 mb-8 w-fit">
      {([['ai', 'AI Usage'], ['api', 'API Usage']] as const).map(([key, label]) => (
        <button
          key={key}
          onClick={() => setActiveTab(key)}
          className={cn(
            'px-5 py-2 rounded-lg text-sm font-bold transition-all',
            activeTab === key
              ? 'bg-surface-container-lowest text-primary shadow-sm border border-outline-variant'
              : 'text-on-surface-variant hover:text-on-surface'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // ── API tab ───────────────────────────────────────────────────────────────
  if (activeTab === 'api') {
    return (
      <div>
        {Header}
        {Tabs}
        <APIUsageTab range={range} />
      </div>
    );
  }

  // ── AI tab loading / error ────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-medium text-on-surface-variant">Loading AI usage analytics...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-error font-medium mb-3">{error}</p>
        <button onClick={() => fetchAIData()} className="text-sm text-primary hover:underline font-medium">Retry</button>
      </div>
    </div>
  );

  if (!data) return null;

  const { overview, period, dailyStats, topUsers, promptBreakdown, recentActivity } = data;
  const maxDailyGen    = Math.max(...dailyStats.map(d => d.generations), 1);
  const maxPromptCount = Math.max(...promptBreakdown.map(p => p.count), 1);

  return (
    <div>
      {Header}
      {Tabs}

      {/* Overview stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard title="Total AI Generations" value={overview.totalGenerations} sub={`+${period.generations} in ${range}d`} icon={BrainCircuit} color="bg-primary" />
        <StatCard title="Total Tokens Used" value={overview.totalTokens.toLocaleString()} sub={`${period.tokens.toLocaleString()} in ${range}d`} icon={Zap} color="bg-primary" />
        <StatCard title="Estimated AI Cost" value={`$${overview.totalCost.toFixed(4)}`} sub={`$${period.cost.toFixed(4)} in ${range}d`} icon={DollarSign} color="bg-secondary" />
        <StatCard title="Failed Generations" value={overview.failedGenerations} sub={`${overview.successRate}% success rate`} icon={XCircle} color="bg-error" subColor={overview.successRate >= 90 ? 'text-secondary' : 'text-error'} />
      </div>

      {/* Daily chart + Prompt breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-on-surface">Daily Generations</h2>
            <span className="text-xs font-medium text-outline">Last {range} days</span>
          </div>
          {dailyStats.every(d => d.generations === 0) ? (
            <div className="h-40 flex items-center justify-center text-outline text-sm">No AI usage data in this period</div>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {dailyStats.map(day => {
                const pct = maxDailyGen > 0 ? (day.generations / maxDailyGen) * 100 : 0;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div className="w-full bg-primary-fixed-dim rounded-t-sm transition-all group-hover:bg-primary" style={{ height: `${Math.max(pct, day.generations > 0 ? 4 : 0)}%` }} />
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-primary text-on-primary text-xs rounded-lg px-2 py-1 whitespace-nowrap z-10 card-shadow">
                      <div className="font-bold">{day.generations} gen</div>
                      <div className="text-outline">{day.tokens.toLocaleString()} tokens</div>
                      <div className="text-outline">${day.cost.toFixed(4)}</div>
                      <div className="text-outline text-[10px]">{day.date}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-between mt-2">
            <span className="text-[10px] text-outline">{dailyStats[0]?.date?.slice(5)}</span>
            <span className="text-[10px] text-outline">{dailyStats[Math.floor(dailyStats.length / 2)]?.date?.slice(5)}</span>
            <span className="text-[10px] text-outline">{dailyStats[dailyStats.length - 1]?.date?.slice(5)}</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <h2 className="text-base font-bold text-on-surface mb-5">By Prompt Type</h2>
          {promptBreakdown.length === 0 ? (
            <div className="text-sm text-outline text-center py-10">No data</div>
          ) : (
            <div className="space-y-4">
              {promptBreakdown.map(p => (
                <div key={p._id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-on-surface truncate max-w-[140px]">{p._id || 'Unknown'}</span>
                    <span className="text-xs font-bold text-on-surface">{p.count}</span>
                  </div>
                  <MiniBar value={p.count} max={maxPromptCount} color="bg-primary-fixed-dim" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Users + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface">Top Active Users</h2>
            <span className="text-xs font-medium text-outline">By generations ({range}d)</span>
          </div>
          {topUsers.length === 0 ? (
            <div className="px-6 py-10 text-center text-outline text-sm">No usage data in this period</div>
          ) : (
            <div className="divide-y divide-outline-variant">
              {topUsers.map((u, idx) => (
                <div key={u.userId} className="px-6 py-3 flex items-center gap-3 hover:bg-surface/50 transition-colors">
                  <span className="w-6 h-6 rounded-full bg-primary-fixed border border-primary-fixed-dim text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-on-surface truncate">{u.fullName}</div>
                    <div className="text-xs text-outline truncate">{u.email}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-on-surface">{u.generations} gen</div>
                    <div className="text-xs text-outline">{u.tokens.toLocaleString()} tokens</div>
                  </div>
                  <span className="ml-2 px-2 py-0.5 bg-primary-fixed text-primary text-xs font-bold rounded-md border border-primary-fixed-dim flex-shrink-0">{u.plan}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface">Recent AI Activity</h2>
            <span className="text-xs font-medium text-outline">Latest 10 requests</span>
          </div>
          {recentActivity.length === 0 ? (
            <div className="px-6 py-10 text-center text-outline text-sm">No recent activity</div>
          ) : (
            <div className="divide-y divide-outline-variant">
              {recentActivity.map(log => (
                <div key={log._id} className="px-6 py-3 hover:bg-surface/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-on-surface truncate">{log.promptType || 'unknown'}</span>
                        <StatusBadge status={log.status} />
                      </div>
                      <div className="text-xs text-outline truncate">{log.userName} · {log.aiModel}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-on-surface">{log.tokensUsed} tok</div>
                      <div className="text-xs text-outline">{new Date(log.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
