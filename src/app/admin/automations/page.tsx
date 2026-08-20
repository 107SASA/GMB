'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
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
  Play,
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

// Known workflows, their manual-trigger config, and how to match them against
// AutomationLog rows (by `workflow` [+ `action`], not the coarse `type` enum).
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

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
  failed:  'bg-error-container    text-on-error-container    border-error-container',
  pending: 'bg-primary-fixed   text-primary   border-primary-fixed-dim',
};

function StatusBadge({ status }: { status?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', STATUS_STYLES[status ?? ''] ?? STATUS_STYLES.pending)}>
      {status === 'success' && <CheckCircle2 className="w-3 h-3" />}
      {status === 'failed' && <XCircle className="w-3 h-3" />}
      {status ?? 'unknown'}
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
  const [data, setData]               = useState<AutomationsData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [statusFilter, setStatus]     = useState('all');
  const [workflowFilter, setWorkflow] = useState('all');

  // Per-workflow manual-trigger state
  const [triggering, setTriggering]         = useState<Record<string, boolean>>({});
  const [triggerError, setTriggerError]     = useState<Record<string, string>>({});
  const [businessIdInput, setBusinessIdInput] = useState<Record<string, string>>({});
  const [showInput, setShowInput]           = useState<Record<string, boolean>>({});

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter   !== 'all') params.set('status',   statusFilter);
      if (workflowFilter !== 'all') params.set('workflow', workflowFilter);
      const res  = await fetch(`/api/admin/automations?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (err: any) {
      setError(friendlyClientMessage(err, 'Failed to fetch automations data'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, workflowFilter]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  function getLastRun(wf: (typeof WORKFLOWS)[number]): AutomationLogEntry | undefined {
    if (!data) return undefined;
    return data.recentLogs.find((l) => {
      if (l.workflow !== wf.matchWorkflow) return false;
      if (wf.matchAction && l.action !== wf.matchAction) return false;
      return true;
    });
  }

  function getTotalRuns(wf: (typeof WORKFLOWS)[number]): number {
    if (!data) return 0;
    return data.byWorkflow.find((b) => b._id === wf.matchWorkflow)?.count ?? 0;
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
        setTimeout(fetchData, 2000); // give Inngest time to enqueue before refreshing
      }
    } catch (e: any) {
      setTriggerError((prev) => ({ ...prev, [wfId]: e.message }));
    } finally {
      setTriggering((prev) => ({ ...prev, [wfId]: false }));
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Automations</h1>
            <p className="text-sm text-on-surface-variant">Inngest background jobs · auto-refreshes every 30s</p>
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

          {/* Automation Health — one card per known workflow, with a manual trigger */}
          <div className="mb-8">
            <h2 className="font-semibold text-on-surface mb-4">Automation Health</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {WORKFLOWS.map((wf) => {
                const lastRun = getLastRun(wf);
                const totalRuns = getTotalRuns(wf);
                const isBusy = triggering[wf.id];

                return (
                  <div
                    key={wf.id}
                    className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-on-surface text-sm">{wf.label}</h3>
                        <p className="text-xs text-on-surface-variant mt-0.5">{wf.description}</p>
                      </div>
                      {lastRun && <StatusBadge status={lastRun.status} />}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-on-surface-variant">
                      <div>
                        <span className="text-outline block">Last run</span>
                        {lastRun ? timeAgo(lastRun.createdAt) : <span className="text-outline">No data</span>}
                      </div>
                      <div>
                        <span className="text-outline block">Total runs</span>
                        {totalRuns.toLocaleString()}
                      </div>
                    </div>

                    {wf.trigger && (
                      <div className="mt-auto pt-2 border-t border-outline-variant space-y-2">
                        {wf.needsBusinessId && showInput[wf.id] && (
                          <input
                            type="text"
                            placeholder="Paste businessId (MongoDB ObjectId)"
                            value={businessIdInput[wf.id] ?? ''}
                            onChange={(e) =>
                              setBusinessIdInput((prev) => ({ ...prev, [wf.id]: e.target.value }))
                            }
                            className="w-full px-2.5 py-1.5 text-xs border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                          />
                        )}
                        {triggerError[wf.id] && (
                          <p className="text-xs text-error">{triggerError[wf.id]}</p>
                        )}
                        <button
                          onClick={() => handleTrigger(wf.id, wf.trigger!, wf.needsBusinessId)}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-on-primary rounded-lg hover:bg-primary-container disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          {wf.needsBusinessId && !showInput[wf.id] ? 'Run Now…' : 'Run Now'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
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
                  value={workflowFilter}
                  onChange={e => setWorkflow(e.target.value)}
                  className="text-xs border border-outline-variant rounded-lg px-2 py-1.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Workflows</option>
                  {WORKFLOWS.map(wf => (
                    <option key={wf.matchWorkflow} value={wf.matchWorkflow}>{wf.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {data.recentLogs.length === 0 ? (
              <div className="p-12 text-center">
                <Clock className="w-10 h-10 text-outline-variant mx-auto mb-3" />
                <p className="text-on-surface-variant text-sm font-medium">No automation logs yet</p>
                <p className="text-outline text-xs mt-1">Logs appear here once workflows start running.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low">
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Workflow</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Action</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Status</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Business</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Duration</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Message / Error</th>
                      <th className="text-left p-4 text-label-sm text-on-surface-variant">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentLogs.map(log => (
                      <tr key={log._id} className="border-b border-outline-variant hover:bg-surface transition-colors">
                        <td className="p-4 font-mono text-xs text-on-surface">{log.workflow || '—'}</td>
                        <td className="p-4 text-xs text-on-surface-variant">{log.action || '—'}</td>
                        <td className="p-4"><StatusBadge status={log.status} /></td>
                        <td className="p-4 text-xs font-mono text-on-surface-variant">
                          {log.businessId ? (
                            <a href={`/admin/businesses/${log.businessId}`} className="text-primary hover:underline">
                              {log.businessId.slice(-8)}…
                            </a>
                          ) : '—'}
                        </td>
                        <td className="p-4 text-on-surface-variant">
                          {log.duration != null ? (
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
                        <td className="p-4 text-outline whitespace-nowrap" title={new Date(log.createdAt).toLocaleString()}>
                          {timeAgo(log.createdAt)}
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
