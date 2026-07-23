'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Database,
  BriefcaseBusiness,
  MessageSquare,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
} from 'lucide-react';

type ProviderStatus = 'ok' | 'warning' | 'critical' | 'unconfigured' | 'error';

interface ProviderHealth {
  key: string;
  name: string;
  powers: string;
  status: ProviderStatus;
  detail: string;
  usage?: { used: number; limit: number; left: number };
  actionUrl?: string;
}

interface SystemHealthData {
  database: { status: 'healthy' | 'down' };
  jobs: { pendingJobs: number; failedJobs24h: number };
  messages: { messageBacklog: number };
  recentErrors: Array<{
    _id: string;
    workflow?: string;
    action?: string;
    error?: string;
    message?: string;
    businessId?: string;
    createdAt: string;
  }>;
  providers?: ProviderHealth[];
  fetchedAt: string;
}

const PROVIDER_STYLES: Record<ProviderStatus, { badge: string; label: string; card: string; bar: string }> = {
  ok:           { badge: 'text-emerald-700 bg-emerald-50', label: 'Healthy',       card: 'border-slate-200',  bar: 'bg-emerald-500' },
  warning:      { badge: 'text-amber-700 bg-amber-50',     label: 'Running low',   card: 'border-amber-300',  bar: 'bg-amber-500' },
  critical:     { badge: 'text-red-700 bg-red-50',         label: 'Critical',      card: 'border-red-300',    bar: 'bg-red-500' },
  error:        { badge: 'text-red-700 bg-red-50',         label: 'Check failed',  card: 'border-red-200',    bar: 'bg-red-400' },
  unconfigured: { badge: 'text-slate-600 bg-slate-100',    label: 'Not set',       card: 'border-slate-200',  bar: 'bg-slate-400' },
};

function ProviderCard({ p }: { p: ProviderHealth }) {
  const s = PROVIDER_STYLES[p.status];
  const pct = p.usage && p.usage.limit > 0
    ? Math.min(100, Math.max(0, Math.round((p.usage.left / p.usage.limit) * 100)))
    : null;
  return (
    <div className={`bg-white rounded-2xl border p-5 shadow-sm ${s.card}`}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <div className="font-semibold text-slate-900">{p.name}</div>
          <div className="text-xs text-slate-400">{p.powers}</div>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${s.badge}`}>{s.label}</span>
      </div>
      {p.usage && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-2xl font-bold text-slate-900">{p.usage.left.toLocaleString()}</span>
            <span className="text-xs text-slate-400">of {p.usage.limit.toLocaleString()} left</span>
          </div>
          {pct !== null && (
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      <p className={`text-xs mt-2 ${p.status === 'critical' || p.status === 'error' ? 'text-red-600 font-medium' : p.status === 'warning' ? 'text-amber-700' : 'text-slate-500'}`}>
        {p.detail}
      </p>
      {p.actionUrl && (p.status === 'critical' || p.status === 'warning' || p.status === 'error' || p.status === 'unconfigured') && (
        <a
          href={p.actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs font-semibold text-violet-600 hover:text-violet-700"
        >
          Manage / top up →
        </a>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'healthy' | 'down' }) {
  return status === 'healthy' ? (
    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
      <CheckCircle2 className="w-3 h-3" /> Healthy
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
      <XCircle className="w-3 h-3" /> Down
    </span>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  warning,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  warning?: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl border p-6 shadow-sm ${warning && Number(value) > 0 ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {warning && Number(value) > 0 && (
          <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3 h-3" /> Needs attention
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-slate-900 mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-sm text-slate-500">{title}</div>
    </div>
  );
}

export default function SystemHealthPage() {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/system-health');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch system health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">System Health</h1>
            <p className="text-sm text-slate-500">
              {lastRefreshed ? `Last updated: ${lastRefreshed.toLocaleTimeString()}` : 'Loading...'}
            </p>
          </div>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-xl hover:bg-violet-100 transition-all text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        </div>
      ) : data ? (
        <>
          {/* Database Status */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center">
                  <Database className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">MongoDB Database</div>
                  <div className="text-sm text-slate-500">Primary database connection</div>
                </div>
              </div>
              <StatusBadge status={data.database.status} />
            </div>
          </div>

          {/* API Tokens & Quotas — surfaces metered credits (SerpApi) before
              they run out and break the live site. */}
          {data.providers && data.providers.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="font-semibold text-slate-900">API Tokens & Quotas</h2>
                {data.providers.some((p) => p.status === 'critical' || p.status === 'error') && (
                  <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                    <AlertTriangle className="w-3 h-3" /> Action needed
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.providers.map((p) => (
                  <ProviderCard key={p.key} p={p} />
                ))}
              </div>
            </div>
          )}

          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <StatCard
              title="Pending Jobs"
              value={data.jobs.pendingJobs}
              icon={BriefcaseBusiness}
              color="bg-violet-600"
            />
            <StatCard
              title="Failed Jobs (24h)"
              value={data.jobs.failedJobs24h}
              icon={AlertTriangle}
              color="bg-red-500"
              warning
            />
            <StatCard
              title="Message Backlog"
              value={data.messages.messageBacklog}
              icon={MessageSquare}
              color="bg-amber-500"
              warning
            />
          </div>

          {/* Recent Errors Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Recent Errors</h2>
              <p className="text-sm text-slate-500">Last 10 failed automation logs</p>
            </div>
            {data.recentErrors.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No errors found — system is clean ✅
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left p-4 text-slate-500 font-medium">Workflow</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Action</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Error</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentErrors.map((err) => (
                      <tr key={err._id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="p-4 font-medium text-slate-700">{err.workflow || '—'}</td>
                        <td className="p-4 text-slate-600">{err.action || '—'}</td>
                        <td className="p-4 text-red-600 max-w-xs truncate">{err.error || err.message || '—'}</td>
                        <td className="p-4 text-slate-400">
                          {new Date(err.createdAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}