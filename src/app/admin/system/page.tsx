'use client';

import { useEffect, useState, useCallback } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
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
  ok:           { badge: 'text-on-secondary-container bg-secondary-container/40', label: 'Healthy',       card: 'border-outline-variant',  bar: 'bg-secondary' },
  warning:      { badge: 'text-primary bg-primary-fixed',     label: 'Running low',   card: 'border-primary-fixed-dim',  bar: 'bg-primary-fixed-dim' },
  critical:     { badge: 'text-on-error-container bg-error-container',         label: 'Critical',      card: 'border-error',    bar: 'bg-error' },
  error:        { badge: 'text-on-error-container bg-error-container',         label: 'Check failed',  card: 'border-error-container',    bar: 'bg-error' },
  unconfigured: { badge: 'text-on-surface-variant bg-surface-container',    label: 'Not set',       card: 'border-outline-variant',  bar: 'bg-outline' },
};

function ProviderCard({ p }: { p: ProviderHealth }) {
  const s = PROVIDER_STYLES[p.status];
  const pct = p.usage && p.usage.limit > 0
    ? Math.min(100, Math.max(0, Math.round((p.usage.left / p.usage.limit) * 100)))
    : null;
  return (
    <div className={`bg-surface-container-lowest rounded-xl border p-5 card-shadow ${s.card}`}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <div className="font-semibold text-on-surface">{p.name}</div>
          <div className="text-xs text-outline">{p.powers}</div>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${s.badge}`}>{s.label}</span>
      </div>
      {p.usage && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-2xl font-bold text-on-surface">{p.usage.left.toLocaleString()}</span>
            <span className="text-xs text-outline">of {p.usage.limit.toLocaleString()} left</span>
          </div>
          {pct !== null && (
            <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      <p className={`text-xs mt-2 ${p.status === 'critical' || p.status === 'error' ? 'text-error font-medium' : p.status === 'warning' ? 'text-primary' : 'text-on-surface-variant'}`}>
        {p.detail}
      </p>
      {p.actionUrl && (p.status === 'critical' || p.status === 'warning' || p.status === 'error' || p.status === 'unconfigured') && (
        <a
          href={p.actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs font-semibold text-primary hover:text-primary"
        >
          Manage / top up →
        </a>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'healthy' | 'down' }) {
  return status === 'healthy' ? (
    <span className="flex items-center gap-1 text-xs font-bold text-secondary bg-secondary-container/40 px-2 py-1 rounded-lg">
      <CheckCircle2 className="w-3 h-3" /> Healthy
    </span>
  ) : (
    <span className="flex items-center gap-1 text-xs font-bold text-error bg-error-container px-2 py-1 rounded-lg">
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
    <div className={`bg-surface-container-lowest rounded-xl border p-6 card-shadow ${warning && Number(value) > 0 ? 'border-error-container' : 'border-outline-variant'}`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {warning && Number(value) > 0 && (
          <span className="flex items-center gap-1 text-xs font-bold text-error bg-error-container px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3 h-3" /> Needs attention
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-on-surface mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-sm text-on-surface-variant">{title}</div>
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
      setError(friendlyClientMessage(err, 'Failed to fetch system health'));
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
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">System Health</h1>
            <p className="text-sm text-on-surface-variant">
              {lastRefreshed ? `Last updated: ${lastRefreshed.toLocaleTimeString()}` : 'Loading...'}
            </p>
          </div>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary-fixed text-primary rounded-xl hover:bg-primary-fixed transition-all text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container border border-error-container rounded-xl text-on-error-container text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : data ? (
        <>
          {/* Database Status */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
                  <Database className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-semibold text-on-surface">MongoDB Database</div>
                  <div className="text-sm text-on-surface-variant">Primary database connection</div>
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
                <h2 className="font-semibold text-on-surface">API Tokens & Quotas</h2>
                {data.providers.some((p) => p.status === 'critical' || p.status === 'error') && (
                  <span className="flex items-center gap-1 text-xs font-bold text-error bg-error-container px-2 py-1 rounded-lg">
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
              color="bg-primary"
            />
            <StatCard
              title="Failed Jobs (24h)"
              value={data.jobs.failedJobs24h}
              icon={AlertTriangle}
              color="bg-error"
              warning
            />
            <StatCard
              title="Message Backlog"
              value={data.messages.messageBacklog}
              icon={MessageSquare}
              color="bg-primary-fixed-dim"
              warning
            />
          </div>

          {/* Recent Errors Table */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow">
            <div className="p-6 border-b border-outline-variant">
              <h2 className="font-semibold text-on-surface">Recent Errors</h2>
              <p className="text-sm text-on-surface-variant">Last 10 failed automation logs</p>
            </div>
            {data.recentErrors.length === 0 ? (
              <div className="p-8 text-center text-outline text-sm">
                No errors found — system is clean ✅
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low">
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Workflow</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Action</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Error</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentErrors.map((err) => (
                      <tr key={err._id} className="border-b border-outline-variant hover:bg-surface">
                        <td className="p-4 font-medium text-on-surface">{err.workflow || '—'}</td>
                        <td className="p-4 text-on-surface-variant">{err.action || '—'}</td>
                        <td className="p-4 text-error max-w-xs truncate">{err.error || friendlyClientMessage(err, '—')}</td>
                        <td className="p-4 text-outline">
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