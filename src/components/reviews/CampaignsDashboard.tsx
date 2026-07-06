'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  UploadCloud, Users, Send, TrendingUp, MessageSquare, Search, X,
  Loader2, Star, Pause, Play, Trash2, Plus, AlertTriangle, Mail,
  Sparkles, ChevronLeft, ChevronRight
} from 'lucide-react';
import CustomerUploadModal from '@/components/campaigns/CustomerUploadModal';
import { useBusiness } from '@/context/BusinessContext';

interface Customer {
  _id: string;
  name: string;
  phone?: string;
  email?: string;
  service?: string;
  serviceDate?: string;
  reviewStatus: 'Pending' | 'Requested' | 'Completed' | 'Failed';
  optedOut: boolean;
}

interface CampaignStats { total: number; sent: number; clicked: number; reviewed: number; }
interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  day2Reminder: boolean;
  day5Reminder: boolean;
  stopOnReview: boolean;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  stats: CampaignStats;
}

interface CustomerStats {
  total: number;
  pending: number;
  requested: number;
  completed: number;
  optedOut: number;
}

interface Suggestion { rating: number; text: string; }

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + 'X'.repeat(Math.max(0, phone.length - 6)) + phone.slice(-3);
}

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-slate-100 text-slate-600',
  Requested: 'bg-blue-50 text-blue-600',
  Completed: 'bg-emerald-50 text-emerald-600',
  Failed: 'bg-rose-50 text-rose-600',
};
const CAMPAIGN_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-emerald-50 text-emerald-600',
  PAUSED: 'bg-amber-50 text-amber-600',
  COMPLETED: 'bg-blue-50 text-blue-600',
  CANCELLED: 'bg-rose-50 text-rose-600',
};

export default function CampaignsDashboard() {
  const { activeBusiness, loading: bizLoading } = useBusiness();

  const [activeTab, setActiveTab] = useState<'customers' | 'campaigns'>('customers');

  // --- Customer tab state ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<CustomerStats>({ total: 0, pending: 0, requested: 0, completed: 0, optedOut: 0 });
  const [custLoading, setCustLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ customerId: string; customerName: string; items: Suggestion[] } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // --- Campaign tab state ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campLoading, setCampLoading] = useState(true);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [newCamp, setNewCamp] = useState({ name: '', channel: 'WHATSAPP', day2: true, day5: true, stopOnReview: true });
  const [creating, setCreating] = useState(false);
  const [launchConfirm, setLaunchConfirm] = useState<{ id: string; name: string } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<number | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<{ id: string; name: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [campStatusFilter, setCampStatusFilter] = useState<'all' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'>('all');

  const fetchCustomers = useCallback(async () => {
    setCustLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/customers?${params}`);
      const json = await res.json();
      if (json.success) {
        setCustomers(json.customers);
        setTotalPages(json.totalPages ?? 1);
        if (json.stats) setStats(json.stats);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCustLoading(false);
    }
  }, [page, search, statusFilter]);

  const fetchCampaigns = useCallback(async () => {
    setCampLoading(true);
    try {
      const res = await fetch('/api/campaigns');
      const json = await res.json();
      if (json.success) setCampaigns(json.campaigns);
    } catch (e) {
      console.error(e);
    } finally {
      setCampLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bizLoading && activeBusiness) fetchCustomers();
  }, [fetchCustomers, bizLoading, activeBusiness]);

  useEffect(() => {
    if (!bizLoading && activeBusiness && activeTab === 'campaigns') fetchCampaigns();
  }, [activeTab, fetchCampaigns, bizLoading, activeBusiness]);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const handleSendRequest = async (customerId: string) => {
    setSendingId(customerId);
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, channel: 'whatsapp' })
      });
      if (res.ok) {
        setCustomers(prev => prev.map(c => c._id === customerId ? { ...c, reviewStatus: 'Requested' as const } : c));
        setStats(prev => ({ ...prev, pending: prev.pending - 1, requested: prev.requested + 1 }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSendingId(null);
    }
  };

  const handleAISuggest = async (customer: Customer) => {
    if (!activeBusiness) return;
    setSuggestingId(customer._id);
    setSuggestions(null);
    try {
      const res = await fetch('/api/reviews/generate-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: activeBusiness.name,
          customerName: customer.name,
          service: customer.service,
          rating: 5
        })
      });
      const json = await res.json();
      if (json.success) {
        setSuggestions({ customerId: customer._id, customerName: customer.name, items: json.suggestions });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSuggestingId(null);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleCreateCampaign = async () => {
    if (!newCamp.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCamp.name,
          channel: newCamp.channel,
          day2Reminder: newCamp.day2,
          day5Reminder: newCamp.day5,
          stopOnReview: newCamp.stopOnReview
        })
      });
      const json = await res.json();
      if (json.success) {
        setShowNewCampaign(false);
        setNewCamp({ name: '', channel: 'WHATSAPP', day2: true, day5: true, stopOnReview: true });
        fetchCampaigns();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const handleLaunch = async () => {
    if (!launchConfirm) return;
    setLaunching(true);
    setLaunchResult(null);
    try {
      const res = await fetch(`/api/campaigns/${launchConfirm.id}/launch`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setLaunchResult(json.requestsQueued);
        fetchCampaigns();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLaunching(false);
    }
  };

  const handlePause = async (id: string) => {
    await fetch(`/api/campaigns/${id}/pause`, { method: 'PATCH' });
    fetchCampaigns();
  };

  const handleCancel = async () => {
    if (!cancelConfirm) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/campaigns/${cancelConfirm.id}/cancel`, { method: 'PATCH' });
      if (res.ok) {
        setCancelConfirm(null);
        fetchCampaigns();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCancelling(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    fetchCampaigns();
  };

  const filteredCampaigns = campStatusFilter === 'all'
    ? campaigns
    : campaigns.filter(c => c.status === campStatusFilter);

  const formatDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  return (
    <div className="space-y-6">
      {/* Sub-tab header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          {(['customers', 'campaigns'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 text-sm font-bold rounded-lg transition-all capitalize ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>
        {activeTab === 'customers' ? (
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            <UploadCloud className="w-4 h-4" /> Import Customers
          </button>
        ) : (
          <button
            onClick={() => setShowNewCampaign(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> New Campaign
          </button>
        )}
      </div>

      {/* ===== CUSTOMERS TAB ===== */}
      {activeTab === 'customers' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Customers', value: stats.total, icon: Users, color: 'text-indigo-600' },
              { label: 'Pending Reviews', value: stats.pending, icon: MessageSquare, color: 'text-amber-500' },
              { label: 'Requests Sent', value: stats.requested, icon: Send, color: 'text-blue-500' },
              { label: 'Opted Out', value: stats.optedOut, icon: TrendingUp, color: 'text-rose-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className={`flex items-center gap-2 mb-1 ${color}`}>
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-bold">{label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, phone, or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Requested">Requested</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-100 text-xs uppercase font-bold text-slate-400">
                  <tr>
                    <th className="px-6 py-4">Customer</th>
                    <th className="px-6 py-4">Service</th>
                    <th className="px-6 py-4">Service Date</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {custLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center">
                        <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-3">
                            <Users className="w-6 h-6" />
                          </div>
                          <p className="font-bold text-slate-900 mb-1">No customers yet</p>
                          <p className="text-sm text-slate-500">Import your past customers via CSV to start requesting reviews.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    customers.map(c => (
                      <Fragment key={c._id}>
                        <tr className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-900">{c.name}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{c.phone ? maskPhone(c.phone) : c.email || '—'}</p>
                          </td>
                          <td className="px-6 py-4 font-medium">{c.service || '—'}</td>
                          <td className="px-6 py-4 text-slate-500">
                            {c.serviceDate ? new Date(c.serviceDate).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1.5">
                              <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_BADGE[c.reviewStatus] || STATUS_BADGE.Pending}`}>
                                {c.reviewStatus}
                              </span>
                              {c.optedOut && (
                                <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600">
                                  Opted Out
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              {!c.optedOut && c.reviewStatus === 'Pending' && (
                                <button
                                  onClick={() => handleSendRequest(c._id)}
                                  disabled={sendingId === c._id}
                                  title="Send Review Request"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {sendingId === c._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                                  {sendingId === c._id ? 'Sending…' : 'Request'}
                                </button>
                              )}
                              <button
                                onClick={() => handleAISuggest(c)}
                                disabled={suggestingId === c._id}
                                title="AI Suggest review text"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                              >
                                {suggestingId === c._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                AI Suggest
                              </button>
                            </div>
                          </td>
                        </tr>
                        {suggestions?.customerId === c._id && (
                          <tr>
                            <td colSpan={5} className="px-6 pb-4">
                              <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-sm font-bold text-violet-800 flex items-center gap-1.5">
                                    <Sparkles className="w-4 h-4" />
                                    Review suggestions for {suggestions.customerName} — share these to inspire their review
                                  </p>
                                  <button onClick={() => setSuggestions(null)} className="text-violet-400 hover:text-violet-600">
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="grid sm:grid-cols-3 gap-3">
                                  {suggestions.items.map((s, i) => (
                                    <div key={i} className="bg-white rounded-lg p-3 border border-violet-100">
                                      <div className="flex items-center gap-0.5 mb-2">
                                        {Array.from({ length: s.rating }).map((_, j) => (
                                          <Star key={j} className="w-3 h-3 fill-amber-400 text-amber-400" />
                                        ))}
                                      </div>
                                      <p className="text-xs text-slate-700 leading-relaxed mb-2">{s.text}</p>
                                      <button
                                        onClick={() => handleCopy(s.text, i)}
                                        className="text-xs font-bold text-violet-600 hover:text-violet-800"
                                      >
                                        {copiedIdx === i ? '✓ Copied' : 'Copy'}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-600">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* ===== CAMPAIGNS TAB ===== */}
      {activeTab === 'campaigns' && (
        <>
          {!campLoading && campaigns.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(['all', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setCampStatusFilter(f)}
                  className={`px-3.5 py-1.5 text-xs font-bold rounded-full border transition-colors ${
                    campStatusFilter === f
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          )}
          {campLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-3">
                <MessageSquare className="w-6 h-6" />
              </div>
              <p className="font-bold text-slate-900 mb-1">No campaigns yet</p>
              <p className="text-sm text-slate-500 mb-4">Create a campaign to start sending automated review requests to your customers.</p>
              <button
                onClick={() => setShowNewCampaign(true)}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" /> New Campaign
              </button>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
              <p className="font-bold text-slate-900 mb-1">No {campStatusFilter.toLowerCase()} campaigns</p>
              <p className="text-sm text-slate-500">Try a different filter to see other campaigns.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredCampaigns.map(camp => (
                <div key={camp.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-slate-900">{camp.name}</h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase">{camp.channel}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAMPAIGN_STATUS_BADGE[camp.status]}`}>{camp.status}</span>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-slate-500 mb-2">
                          <span>Total: <strong className="text-slate-700">{camp.stats.total}</strong></span>
                          <span>Sent: <strong className="text-slate-700">{camp.stats.sent}</strong></span>
                          <span>Clicked: <strong className="text-slate-700">{camp.stats.clicked}</strong></span>
                          <span>Reviewed: <strong className="text-slate-700">{camp.stats.reviewed}</strong></span>
                          {camp.status !== 'DRAFT' && (
                            <>
                              <span>Started: <strong className="text-slate-700">{formatDate(camp.startDate)}</strong></span>
                              {(camp.status === 'COMPLETED' || camp.status === 'CANCELLED') && (
                                <span>Ended: <strong className="text-slate-700">{formatDate(camp.endDate)}</strong></span>
                              )}
                            </>
                          )}
                        </div>
                        {camp.status !== 'DRAFT' && (
                          <div className="flex items-center gap-2 max-w-xs">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full"
                                style={{ width: `${Math.min(100, Math.max(0, camp.progress ?? 0))}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-bold text-slate-400">{camp.progress ?? 0}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {camp.status === 'DRAFT' && (
                        <button
                          onClick={() => { setLaunchConfirm({ id: camp.id, name: camp.name }); setLaunchResult(null); }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" /> Launch
                        </button>
                      )}
                      {camp.status === 'ACTIVE' && (
                        <button
                          onClick={() => handlePause(camp.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold rounded-xl transition-colors border border-amber-200"
                        >
                          <Pause className="w-3.5 h-3.5" /> Pause
                        </button>
                      )}
                      {camp.status === 'PAUSED' && (
                        <button
                          onClick={() => { setLaunchConfirm({ id: camp.id, name: camp.name }); setLaunchResult(null); }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition-colors border border-indigo-200"
                        >
                          <Play className="w-3.5 h-3.5" /> Resume
                        </button>
                      )}
                      {(camp.status === 'ACTIVE' || camp.status === 'PAUSED') && (
                        <button
                          onClick={() => setCancelConfirm({ id: camp.id, name: camp.name })}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold rounded-xl transition-colors border border-rose-200"
                        >
                          <X className="w-3.5 h-3.5" /> Cancel
                        </button>
                      )}
                      {camp.status === 'DRAFT' && (
                        <button
                          onClick={() => handleDelete(camp.id)}
                          className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors border border-slate-200"
                          title="Delete campaign"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Customer Upload Modal */}
      {showUpload && (
        <CustomerUploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); fetchCustomers(); }}
        />
      )}

      {/* New Campaign Modal */}
      {showNewCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">New Campaign</h2>
              <button onClick={() => setShowNewCampaign(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Campaign Name</label>
                <input
                  type="text"
                  value={newCamp.name}
                  onChange={e => setNewCamp(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Q3 Review Drive"
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Channel</label>
                <select
                  value={newCamp.channel}
                  onChange={e => setNewCamp(p => ({ ...p, channel: e.target.value }))}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                </select>
              </div>
              <div className="space-y-2">
                {[
                  { key: 'day2', label: 'Day 2 Reminder' },
                  { key: 'day5', label: 'Day 5 Reminder' },
                  { key: 'stopOnReview', label: 'Stop on Review' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCamp[key as keyof typeof newCamp] as boolean}
                      onChange={e => setNewCamp(p => ({ ...p, [key]: e.target.checked }))}
                      className="w-4 h-4 rounded accent-indigo-600"
                    />
                    <span className="text-sm text-slate-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowNewCampaign(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleCreateCampaign}
                disabled={creating || !newCamp.name.trim()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Campaign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Launch Confirmation Modal */}
      {launchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            {launchResult !== null ? (
              <>
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Play className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Campaign Launched!</h3>
                <p className="text-sm text-slate-500 mb-5">
                  <strong>{launchResult}</strong> review request{launchResult !== 1 ? 's' : ''} queued for delivery.
                </p>
                <button
                  onClick={() => { setLaunchConfirm(null); setLaunchResult(null); }}
                  className="w-full px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Launch "{launchConfirm.name}"?</h3>
                <p className="text-sm text-slate-500 mb-5">
                  This will send review requests to all eligible customers who haven't opted out and haven't received a request from this campaign yet.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setLaunchConfirm(null)}
                    className="flex-1 px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleLaunch}
                    disabled={launching}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
                  >
                    {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {launching ? 'Launching…' : 'Launch'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Cancel "{cancelConfirm.name}"?</h3>
            <p className="text-sm text-slate-500 mb-5">
              This will stop the campaign immediately. Cancelled campaigns cannot be resumed, but this campaign will remain visible in your history.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelConfirm(null)}
                className="flex-1 px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Keep Campaign
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl disabled:opacity-50"
              >
                {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                {cancelling ? 'Cancelling…' : 'Cancel Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
