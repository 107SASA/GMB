'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Zap,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AutomationStats {
  totalRuns: number;
  successCount: number;
  failedCount: number;
  failedToday: number;
  successRate: number;
}

interface WorkflowBucket {
  _id: string;
  count: number;
}

interface AutomationLogEntry {
  _id: string;
  workflow?: string;
  action?: string;
  type?: string;
  status: 'success' | 'failed' | 'pending';
  message?: string;
  error?: string;
  businessId?: string;
  duration?: number;
  createdAt: string;
}

interface AutomationsData {
  stats: AutomationStats;
  byWorkflow: WorkflowBucket[];
  recentLogs: AutomationLogEntry[];
}

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
  failed:  'bg-error-container    text-on-error-container    border-error-container',
  pending: 'bg-primary-fixed   text-primary   border-primary-fixed-dim',
};

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
    <div className={cn('bg-surface-container-lowest rounded-xl border p-6 card-shadow', warning && Number(value) > 0 ? 'border-error-container' : 'border-outline-variant')}>
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {warning && Number(value) > 0 && (
          <span className="flex items-center gap-1 text-xs font-bold text-error bg-error-container px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3 h-3" /> Alert
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

export default function AutomationsPage() {
  const [data, setData]           = useState<AutomationsData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [statusFilter, setStatus] = useState('all');
  const [typeFilter, setType]     = useState('all');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter   !== 'all') params.set('type',   typeFilter);
      const res  = await fetch(`/api/admin/automations?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch automations data');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const maxWorkflow = data ? Math.max(...data.byWorkflow.map(w => w.count), 1) : 1;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Automations Monitor</h1>
            <p className="text-sm text-on-surface-variant">Platform-wide automation workflow executions</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary-fixed text-primary rounded-xl hover:bg-primary-fixed transition-all text-sm font-medium"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container border border-error-container rounded-xl text-on-error-container text-sm">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : data ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            <StatCard title="Total Runs"     value={data.stats.totalRuns}    icon={Zap}          color="bg-primary" />
            <StatCard title="Successful"     value={data.stats.successCount} icon={CheckCircle2} color="bg-secondary" />
            <StatCard title="Failed"         value={data.stats.failedCount}  icon={XCircle}      color="bg-error"    warning />
            <StatCard title="Failed Today"   value={data.stats.failedToday}  icon={AlertTriangle} color="bg-primary-fixed-dim" warning />
            <StatCard title="Success Rate"   value={`${data.stats.successRate}%`} icon={TrendingUp} color="bg-primary-fixed-dim" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Workflow Breakdown */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <h2 className="font-semibold text-on-surface mb-5">Top Workflows</h2>
              {data.byWorkflow.length === 0 ? (
                <div className="text-sm text-outline text-center py-8">No data</div>
              ) : (
                <div className="space-y-4">
                  {data.byWorkflow.map(w => {
                    const pct = Math.round((w.count / maxWorkflow) * 100);
                    return (
                      <div key={w._id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-on-surface truncate max-w-[140px]">{w._id || 'Unknown'}</span>
                          <span className="text-xs font-bold text-on-surface">{w.count.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                          <div className="h-full bg-primary-fixed-dim rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Success Rate Ring */}
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 flex flex-col">
              <h2 className="font-semibold text-on-surface mb-5">Health Summary</h2>
              <div className="flex-1 flex items-center gap-8">
                {/* SVG ring */}
                <div className="relative w-28 h-28 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none"
                      stroke={data.stats.successRate >= 90 ? '#10b981' : data.stats.successRate >= 70 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="3.5"
                      strokeDasharray={`${data.stats.successRate} ${100 - data.stats.successRate}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold text-on-surface">{data.stats.successRate}%</span>
                    <span className="text-[10px] text-outline">success</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 flex-1">
                  {[
                    { label: 'Total Runs',   value: data.stats.totalRuns,    color: 'bg-primary-fixed text-primary' },
                    { label: 'Succeeded',    value: data.stats.successCount, color: 'bg-secondary-container text-on-secondary-container' },
                    { label: 'Failed (all)', value: data.stats.failedCount,  color: 'bg-error-container text-on-error-container' },
                    { label: 'Failed today', value: data.stats.failedToday,  color: 'bg-primary-fixed text-primary' },
                  ].map(item => (
                    <div key={item.label} className={cn('rounded-xl p-3', item.color)}>
                      <div className="text-xl font-bold">{item.value.toLocaleString()}</div>
                      <div className="text-xs font-medium opacity-80">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Logs Table */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow">
            <div className="p-6 border-b border-outline-variant flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <h2 className="font-semibold text-on-surface">Recent Executions</h2>
                <p className="text-sm text-on-surface-variant">Last 50 automation runs</p>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-outline" />
                <select
                  value={statusFilter}
                  onChange={e => setStatus(e.target.value)}
                  className="text-xs border border-outline-variant rounded-lg px-2 py-1.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Statuses</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Pending</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={e => setType(e.target.value)}
                  className="text-xs border border-outline-variant rounded-lg px-2 py-1.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Types</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="review">Review</option>
                  <option value="content">Content</option>
                  <option value="audit">Audit</option>
                </select>
              </div>
            </div>

            {data.recentLogs.length === 0 ? (
              <div className="p-8 text-center text-outline text-sm">No automation logs found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low">
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Workflow</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Action</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Status</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Duration</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Message / Error</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLogs.map(log => (
                      <tr key={log._id} className="border-b border-outline-variant hover:bg-surface transition-colors">
                        <td className="p-4 font-medium text-on-surface">{log.workflow || '—'}</td>
                        <td className="p-4 text-on-surface-variant">{log.action || log.type || '—'}</td>
                        <td className="p-4">
                          <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', STATUS_STYLES[log.status] ?? STATUS_STYLES.pending)}>
                            {log.status}
                          </span>
                        </td>
                        <td className="p-4 text-on-surface-variant">
                          {log.duration ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />{log.duration}ms
                            </span>
                          ) : '—'}
                        </td>
                        <td className="p-4 max-w-xs">
                          {log.status === 'failed' ? (
                            <span className="text-error truncate block">{log.error || log.message || '—'}</span>
                          ) : (
                            <span className="text-on-surface-variant truncate block">{log.message || '—'}</span>
                          )}
                        </td>
                        <td className="p-4 text-outline whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
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
