'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Activity,
  Zap,
  BarChart3,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stats {
  totalRuns: number;
  successCount: number;
  failedCount: number;
  failedToday: number;
  successRate: number;
}

interface WorkflowStat {
  _id: string;
  count: number;
}

interface LogEntry {
  _id: string;
  workflow?: string;
  action?: string;
  type: string;
  status?: string;
  message?: string;
  error?: string;
  businessId?: string;
  createdAt: string;
  duration?: number;
}

interface DashboardData {
  stats: Stats;
  byWorkflow: WorkflowStat[];
  recentLogs: LogEntry[];
}

// ─── Workflow definitions ─────────────────────────────────────────────────────

const WORKFLOWS = [
  {
    id: 'buffer-monitor',
    label: 'Buffer Monitor',
    description: 'Daily 8 AM · generates AI posts when buffer < 7 days',
    trigger: 'buffer-check' as const,
    needsBusinessId: true,
    matchWorkflow: 'content-scheduler',
    matchAction: 'generate_post_batch',
  },
  {
    id: 'lead-followup',
    label: 'Lead Follow-Up',
    description: 'Hourly · WhatsApp follow-ups to stale leads',
    trigger: null,
    needsBusinessId: false,
    matchWorkflow: 'lead-followup',
    matchAction: undefined,
  },
  {
    id: 'review-autopoll',
    label: 'Review Autopoll',
    description: 'Hourly · marks clicked review requests as reviewed',
    trigger: 'review-autopoll' as const,
    needsBusinessId: false,
    matchWorkflow: 'review-autopoll',
    matchAction: undefined,
  },
  {
    id: 'content-scheduler',
    label: 'Content Scheduler',
    description: 'On-demand · AI generates GMB posts for a business',
    trigger: 'generate-content' as const,
    needsBusinessId: true,
    matchWorkflow: 'content-scheduler',
    matchAction: 'generate_post_batch',
  },
  {
    id: 'publish-cron',
    label: 'Publish Cron',
    description: 'Every 15 min · publishes due scheduled posts to GMB',
    trigger: 'publish-posts' as const,
    needsBusinessId: false,
    matchWorkflow: 'publish-cron',
    matchAction: 'publish_post',
  },
  {
    id: 'critical-alert',
    label: 'Critical Alert',
    description: 'Event-driven · WhatsApp alert on 1-star reviews',
    trigger: null,
    needsBusinessId: false,
    matchWorkflow: 'critical-alert',
    matchAction: undefined,
  },
] as const;

type WorkflowTrigger = 'buffer-check' | 'publish-posts' | 'sync-reviews' | 'review-autopoll' | 'generate-content';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status }: { status?: string }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3" />
        success
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
        <XCircle className="w-3 h-3" />
        failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
      {status ?? 'unknown'}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Per-workflow trigger state
  const [triggering, setTriggering] = useState<Record<string, boolean>>({});
  const [triggerError, setTriggerError] = useState<Record<string, string>>({});
  const [businessIdInput, setBusinessIdInput] = useState<Record<string, string>>({});
  const [showInput, setShowInput] = useState<Record<string, boolean>>({});

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (status: string, type: string) => {
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (type !== 'all') params.set('type', type);
      const qs = params.toString();

      const res = await fetch(`/api/admin/automations${qs ? `?${qs}` : ''}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setFetchError(null);
      } else {
        setFetchError(json.error || 'Failed to load data');
      }
    } catch (e: any) {
      setFetchError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(statusFilter, typeFilter);
    intervalRef.current = setInterval(() => fetchData(statusFilter, typeFilter), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, statusFilter, typeFilter]);

  // ── Per-workflow helpers ──────────────────────────────────────────────────

  function getLastRun(wf: (typeof WORKFLOWS)[number]): LogEntry | undefined {
    if (!data) return undefined;
    return data.recentLogs.find((l) => {
      if (l.workflow !== wf.matchWorkflow) return false;
      if (wf.matchAction && l.action !== wf.matchAction) return false;
      return true;
    });
  }

  function getTotalRuns(wf: (typeof WORKFLOWS)[number]): number {
    if (!data) return 0;
    const stat = data.byWorkflow.find((b) => b._id === wf.matchWorkflow);
    return stat?.count ?? 0;
  }

  async function handleTrigger(wfId: string, trigger: WorkflowTrigger, needsBusinessId: boolean) {
    if (needsBusinessId && !showInput[wfId]) {
      setShowInput((prev) => ({ ...prev, [wfId]: true }));
      return;
    }

    const businessId = needsBusinessId ? businessIdInput[wfId]?.trim() : undefined;
    if (needsBusinessId && !businessId) {
      setTriggerError((prev) => ({ ...prev, [wfId]: 'Enter a businessId first' }));
      return;
    }

    setTriggering((prev) => ({ ...prev, [wfId]: true }));
    setTriggerError((prev) => ({ ...prev, [wfId]: '' }));

    try {
      const res = await fetch('/api/admin/automations/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: trigger, businessId }),
      });
      const json = await res.json();
      if (!json.success) {
        setTriggerError((prev) => ({ ...prev, [wfId]: json.error ?? 'Trigger failed' }));
      } else {
        setShowInput((prev) => ({ ...prev, [wfId]: false }));
        setBusinessIdInput((prev) => ({ ...prev, [wfId]: '' }));
        // Refresh after a brief delay so Inngest has time to enqueue
        setTimeout(() => fetchData(statusFilter, typeFilter), 2000);
      }
    } catch (e: any) {
      setTriggerError((prev) => ({ ...prev, [wfId]: e.message }));
    } finally {
      setTriggering((prev) => ({ ...prev, [wfId]: false }));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const stats = data?.stats;
  const logs = data?.recentLogs ?? [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Automation Dashboard</h1>
            <p className="text-sm text-slate-500">Inngest background jobs · auto-refreshes every 30 s</p>
          </div>
        </div>
        <button
          onClick={() => fetchData(statusFilter, typeFilter)}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {fetchError}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Runs',
            value: loading ? '—' : (stats?.totalRuns ?? 0).toLocaleString(),
            icon: BarChart3,
            color: 'text-violet-600 bg-violet-50',
          },
          {
            label: 'Success Rate',
            value: loading ? '—' : `${stats?.successRate ?? 0}%`,
            icon: CheckCircle2,
            color: 'text-emerald-600 bg-emerald-50',
          },
          {
            label: 'Failed Today',
            value: loading ? '—' : (stats?.failedToday ?? 0).toString(),
            icon: XCircle,
            color: stats?.failedToday ? 'text-red-600 bg-red-50' : 'text-slate-500 bg-slate-50',
          },
          {
            label: 'Active Workflows',
            value: '6',
            icon: Activity,
            color: 'text-blue-600 bg-blue-50',
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-start gap-4"
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.color}`}>
              <card.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{card.label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-0.5">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Automation Health — one card per workflow */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Automation Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {WORKFLOWS.map((wf) => {
            const lastRun = getLastRun(wf);
            const totalRuns = getTotalRuns(wf);
            const isBusy = triggering[wf.id];

            return (
              <div
                key={wf.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-3"
              >
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">{wf.label}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{wf.description}</p>
                  </div>
                  {lastRun && <StatusBadge status={lastRun.status} />}
                </div>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400 block">Last run</span>
                    {lastRun ? timeAgo(lastRun.createdAt) : <span className="text-slate-300">No data</span>}
                  </div>
                  <div>
                    <span className="text-slate-400 block">Total runs</span>
                    {totalRuns.toLocaleString()}
                  </div>
                </div>

                {/* Trigger section */}
                {wf.trigger && (
                  <div className="mt-auto pt-2 border-t border-slate-100 space-y-2">
                    {wf.needsBusinessId && showInput[wf.id] && (
                      <input
                        type="text"
                        placeholder="Paste businessId (MongoDB ObjectId)"
                        value={businessIdInput[wf.id] ?? ''}
                        onChange={(e) =>
                          setBusinessIdInput((prev) => ({ ...prev, [wf.id]: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 font-mono"
                      />
                    )}
                    {triggerError[wf.id] && (
                      <p className="text-xs text-red-600">{triggerError[wf.id]}</p>
                    )}
                    <button
                      onClick={() => handleTrigger(wf.id, wf.trigger!, wf.needsBusinessId)}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isBusy ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      {wf.needsBusinessId && !showInput[wf.id] ? 'Run Now…' : 'Run Now'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Automation Logs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Recent Automation Logs</h2>
          <div className="flex items-center gap-2">
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
            {/* Workflow type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="all">All workflows</option>
              <option value="content-scheduler">content-scheduler</option>
              <option value="publish-cron">publish-cron</option>
              <option value="review-autopoll">review-autopoll</option>
              <option value="lead-followup">lead-followup</option>
              <option value="critical-alert">critical-alert</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-slate-300" />
              Loading logs…
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">No automation logs yet</p>
              <p className="text-slate-400 text-xs mt-1">Logs appear here once workflows start running.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Workflow</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Business</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Duration</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {logs.map((log) => (
                    <tr key={log._id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {log.workflow ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {log.action ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={log.status} />
                        {log.error && (
                          <p className="text-xs text-red-500 mt-1 truncate max-w-[200px]" title={log.error}>
                            {log.error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">
                        {log.businessId ? (
                          <a
                            href={`/admin/businesses/${log.businessId}`}
                            className="text-violet-600 hover:underline"
                          >
                            {log.businessId.slice(-8)}…
                          </a>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {log.duration != null ? `${log.duration}ms` : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {timeAgo(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
