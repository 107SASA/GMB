'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskSummary, TaskView } from '@/services/tasks/planTasks';

export interface PlanTasksData {
  tasks: TaskView[];
  summary: TaskSummary;
  report: { auditId: string; createdAt: string } | null;
  showPopup: boolean;
}

/**
 * The active workspace's plan tasks (GET /api/tasks) — dashboard checklist,
 * "fixes ready" popup, report "Fix now" buttons and the guided-fix bar.
 * `enabled` false skips the request (e.g. a free report has no tasks).
 */
export function usePlanTasks(businessId: string | undefined, enabled = true) {
  const [data, setData] = useState<PlanTasksData | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!businessId || !enabled) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setData({ tasks: json.tasks, summary: json.summary, report: json.report, showPopup: json.showPopup });
    } catch {
      // Tasks are an extra — the page works without them.
    } finally {
      setLoading(false);
    }
  }, [businessId, enabled]);

  useEffect(() => {
    setData(null);
    setLoading(true);
    reload();
  }, [reload]);

  /** "I've done this" — returns an error message, or null on success. */
  const markDone = useCallback(async (taskId: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/done`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) return json.error || 'Could not save that. Please try again.';
      await reload();
      return null;
    } catch {
      return 'Could not reach the server. Please try again.';
    }
  }, [reload]);

  const dismissPopup = useCallback(async () => {
    const auditId = data?.report?.auditId;
    setData((d) => (d ? { ...d, showPopup: false } : d));
    if (!auditId) return;
    await fetch('/api/tasks/popup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditId }),
    }).catch(() => {});
  }, [data?.report?.auditId]);

  return { data, loading, reload, markDone, dismissPopup };
}
