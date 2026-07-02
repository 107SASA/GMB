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
  success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  failed:  'bg-rose-50    text-rose-700    border-rose-100',
  pending: 'bg-amber-50   text-amber-700   border-amber-100',
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
    <div className={cn('bg-white rounded-2xl border p-6 shadow-sm', warning && Number(value) > 0 ? 'border-red-200' : 'border-slate-200')}>
      <div className="flex items-start justify-between mb-4">
        <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', color)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {warning && Number(value) > 0 && (
          <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3 h-3" /> Alert
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
          <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Automations Monitor</h1>
            <p className="text-sm text-slate-500">Platform-wide automation workflow executions</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-xl hover:bg-violet-100 transition-all text-sm font-medium"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        </div>
      ) : data ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            <StatCard title="Total Runs"     value={data.stats.totalRuns}    icon={Zap}          color="bg-violet-600" />
            <StatCard title="Successful"     value={data.stats.successCount} icon={CheckCircle2} color="bg-emerald-500" />
            <StatCard title="Failed"         value={data.stats.failedCount}  icon={XCircle}      color="bg-red-500"    warning />
            <StatCard title="Failed Today"   value={data.stats.failedToday}  icon={AlertTriangle} color="bg-amber-500" warning />
            <StatCard title="Success Rate"   value={`${data.stats.successRate}%`} icon={TrendingUp} color="bg-blue-500" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Workflow Breakdown */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h2 className="font-semibold text-slate-900 mb-5">Top Workflows</h2>
              {data.byWorkflow.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-8">No data</div>
              ) : (
                <div className="space-y-4">
                  {data.byWorkflow.map(w => {
                    const pct = Math.round((w.count / maxWorkflow) * 100);
                    return (
                      <div key={w._id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">{w._id || 'Unknown'}</span>
                          <span className="text-xs font-bold text-slate-900">{w.count.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Success Rate Ring */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col">
              <h2 className="font-semibold text-slate-900 mb-5">Health Summary</h2>
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
                    <span className="text-xl font-bold text-slate-900">{data.stats.successRate}%</span>
                    <span className="text-[10px] text-slate-400">success</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 flex-1">
                  {[
                    { label: 'Total Runs',   value: data.stats.totalRuns,    color: 'bg-violet-100 text-violet-700' },
                    { label: 'Succeeded',    value: data.stats.successCount, color: 'bg-emerald-100 text-emerald-700' },
                    { label: 'Failed (all)', value: data.stats.failedCount,  color: 'bg-red-100 text-red-700' },
                    { label: 'Failed today', value: data.stats.failedToday,  color: 'bg-amber-100 text-amber-700' },
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
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">Recent Executions</h2>
                <p className="text-sm text-slate-500">Last 50 automation runs</p>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={statusFilter}
                  onChange={e => setStatus(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  <option value="all">All Statuses</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Pending</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={e => setType(e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
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
              <div className="p-8 text-center text-slate-400 text-sm">No automation logs found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left p-4 text-slate-500 font-medium">Workflow</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Action</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Status</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Duration</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Message / Error</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLogs.map(log => (
                      <tr key={log._id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-medium text-slate-800">{log.workflow || '—'}</td>
                        <td className="p-4 text-slate-600">{log.action || log.type || '—'}</td>
                        <td className="p-4">
                          <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', STATUS_STYLES[log.status] ?? STATUS_STYLES.pending)}>
                            {log.status}
                          </span>
                        </td>
                        <td className="p-4 text-slate-500">
                          {log.duration ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />{log.duration}ms
                            </span>
                          ) : '—'}
                        </td>
                        <td className="p-4 max-w-xs">
                          {log.status === 'failed' ? (
                            <span className="text-red-600 truncate block">{log.error || log.message || '—'}</span>
                          ) : (
                            <span className="text-slate-500 truncate block">{log.message || '—'}</span>
                          )}
                        </td>
                        <td className="p-4 text-slate-400 whitespace-nowrap">
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
