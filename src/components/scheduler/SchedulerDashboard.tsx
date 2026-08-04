'use client';

import { useState, useEffect, useCallback } from 'react';
import BufferHealthBar from './BufferHealthBar';
import LowBufferBanner from './LowBufferBanner';
import WeeklyCalendar from './WeeklyCalendar';
import { useBusiness } from '@/context/BusinessContext';

export default function SchedulerDashboard() {
  const { activeBusiness } = useBusiness();
  const [bufferData, setBufferData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchBuffer = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/buffer');
      const json = await res.json();
      if (json.success) setBufferData(json.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // /api/scheduler/buffer is scoped to the active business server-side, but
  // this previously fetched once on mount only — switching workspaces left
  // the buffer health bar and calendar (which is fully driven by this data,
  // see the WeeklyCalendar posts prop below) showing the PREVIOUS workspace.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    fetchBuffer();
  }, [fetchBuffer, activeBusiness?._id]);

  const handleManualGenerate = async () => {
    try {
      const res = await fetch('/api/scheduler/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Generation failed to dispatch');
      alert('AI Generation job dispatched to Inngest! The calendar will update shortly.');
      setTimeout(fetchBuffer, 5000);
    } catch {
      alert('Failed to dispatch generation.');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      const res = await fetch('/api/scheduler/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Publish failed');
      }
      await fetchBuffer();
    } catch (err: any) {
      alert(err.message ?? 'Failed to publish');
    }
  };

  // Called by WeeklyCalendar after an optimistic drag-drop update.
  // Throws on failure so the calendar can roll back its local state.
  const handleReschedule = useCallback(async (postId: string, newDate: Date) => {
    const res = await fetch('/api/scheduler/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, scheduledDate: newDate.toISOString() }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? 'Reschedule failed');
    }
    // Refresh in the background so health bar reflects the new state
    fetchBuffer();
  }, [fetchBuffer]);

  if (loading) return <div className="p-8 text-center text-on-surface-variant">Loading scheduler...</div>;
  if (!bufferData) return <div className="p-8 text-center text-error">Failed to load scheduler data.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-bold text-on-surface tracking-tight">AI Marketing Automation</h1>
        <p className="text-on-surface-variant mt-1">
          Manage your 14-day content buffer and automated publishing workflow.
        </p>
      </div>

      <BufferHealthBar
        scheduled={bufferData.scheduledThisWeek}
        target={bufferData.weeklyTarget}
        healthStatus={bufferData.healthStatus}
      />

      <LowBufferBanner postsNeeded={bufferData.postsNeeded} onGenerate={handleManualGenerate} />

      <WeeklyCalendar
        posts={bufferData.allPosts}
        onPublish={handlePublish}
        onReschedule={handleReschedule}
        onDataChanged={fetchBuffer}
      />
    </div>
  );
}
