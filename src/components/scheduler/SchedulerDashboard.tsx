'use client';

import React, { useState, useEffect } from 'react';
import BufferHealthBar from './BufferHealthBar';
import LowBufferBanner from './LowBufferBanner';
import WeeklyCalendar from './WeeklyCalendar';

export default function SchedulerDashboard() {
  const [bufferData, setBufferData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchBuffer = async () => {
    try {
      const res = await fetch('/api/scheduler/buffer');
      const json = await res.json();
      if (json.success) setBufferData(json.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBuffer();
  }, []);

  const handleManualGenerate = async () => {
    try {
      const res = await fetch('/api/scheduler/generate', { method: 'POST', body: JSON.stringify({}) });
      if (!res.ok) throw new Error('Generation failed to dispatch');
      alert('AI Generation job dispatched to Inngest! The calendar will update shortly.');
      // Optionally poll for updates, but for MVP we just refresh after 5 seconds
      setTimeout(fetchBuffer, 5000);
    } catch (error) {
      alert('Failed to dispatch generation.');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      await fetch('/api/scheduler/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id })
      });
      fetchBuffer();
    } catch (err) {
      alert('Failed to publish');
    }
  };

  const handleSchedule = async (id: string) => {
    try {
      // Mock scheduling to today
      const d = new Date();
      await fetch('/api/scheduler/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id, scheduledDate: d.toISOString() })
      });
      fetchBuffer();
    } catch (err) {
      alert('Failed to schedule');
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading scheduler...</div>;
  if (!bufferData) return <div className="p-8 text-center text-rose-500">Failed to load scheduler data.</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">AI Marketing Automation</h1>
          <p className="text-slate-500 mt-1">Manage your 7-day content buffer and automated publishing workflow.</p>
        </div>
      </div>

      <BufferHealthBar daysCovered={bufferData.daysCovered} healthStatus={bufferData.healthStatus} />
      
      <LowBufferBanner missingDays={bufferData.missingDays} onGenerate={handleManualGenerate} />

      <WeeklyCalendar posts={bufferData.allPosts} onPublish={handlePublish} onSchedule={handleSchedule} />
    </div>
  );
}
