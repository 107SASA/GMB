'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Zap, BrainCircuit, Send } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface WhatsAppData {
  stats: {
    totalConversations: number;
    activeThreads: number;
    aiEnabledThreads: number;
    messagesToday: number;
  };
  recentThreads: Array<{
    _id: string;
    businessName: string;
    leadName: string;
    leadPhone: string;
    aiEnabled: boolean;
    unreadCount: number;
    lastMessageSnippet: string;
    lastActivityAt: string;
  }>;
  messageVolume: Array<{
    date: string;
    inbound: number;
    outbound: number;
  }>;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function WhatsAppMonitorPage() {
  const [data, setData] = useState<WhatsAppData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/whatsapp-monitor')
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data); })
      .finally(() => setLoading(false));
  }, []);

  const chartData = (data?.messageVolume ?? []).map((row) => ({
    date: row.date.slice(5), // MM-DD
    Inbound: row.inbound,
    Outbound: row.outbound,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">WhatsApp Monitor</h1>
          <p className="text-sm text-slate-500">All inbound and outbound WhatsApp conversations — live.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Conversations', value: loading ? '—' : data?.stats.totalConversations.toLocaleString(), icon: MessageSquare, color: 'text-violet-600 bg-violet-50' },
          { label: 'Active (24h)', value: loading ? '—' : data?.stats.activeThreads.toLocaleString(), icon: Zap, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'AI Enabled', value: loading ? '—' : data?.stats.aiEnabledThreads.toLocaleString(), icon: BrainCircuit, color: 'text-blue-600 bg-blue-50' },
          { label: 'Messages Today', value: loading ? '—' : data?.stats.messagesToday.toLocaleString(), icon: Send, color: 'text-amber-600 bg-amber-50' },
        ].map((card) => (
          <div key={card.label} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">{card.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      {/* 7-day Message Volume Chart */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="font-semibold text-slate-900 mb-1">Message Volume (7 days)</h2>
        <p className="text-xs text-slate-400 mb-4">Inbound vs outbound messages per day</p>
        {loading ? (
          <div className="h-52 bg-slate-100 rounded-xl animate-pulse" />
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={chartData} barCategoryGap="30%">
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Inbound" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Outbound" fill="#a78bfa" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent Threads Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Recent Threads</h2>
          <p className="text-xs text-slate-400 mt-0.5">Latest 20 conversations across all businesses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Lead</th>
                <th className="text-left px-4 py-3">AI</th>
                <th className="text-left px-4 py-3">Unread</th>
                <th className="text-left px-4 py-3">Last Message</th>
                <th className="text-left px-4 py-3">Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-slate-200 rounded w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : (data?.recentThreads ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No conversations yet</td>
                </tr>
              ) : (
                data?.recentThreads.map((thread) => (
                  <tr key={thread._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{thread.businessName}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-700 font-medium">{thread.leadName}</div>
                      {thread.leadPhone && (
                        <div className="text-xs text-slate-400">{thread.leadPhone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        thread.aiEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {thread.aiEnabled ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {thread.unreadCount > 0 ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold">
                          {thread.unreadCount}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                      {thread.lastMessageSnippet || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                      {timeAgo(thread.lastActivityAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
