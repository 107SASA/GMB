'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  UploadCloud, Users, Send, TrendingUp, MessageSquare, Search, X,
  Loader2, Star, Pause, Play, Trash2, Plus, AlertTriangle, Mail,
  Sparkles, ChevronLeft, ChevronRight, Pencil, Tag, Clock, Wand2, UserPlus, Import
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
  tags?: string[];
  reviewStatus: 'Pending' | 'Requested' | 'Completed' | 'Failed';
  optedOut: boolean;
}

interface CampaignStats { total: number; sent: number; clicked: number; reviewed: number; }
interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  targetTags: string[];
  initialMessage: string;
  reminder1Enabled: boolean;
  reminder1AfterDays: number;
  reminder1Message: string;
  reminder2Enabled: boolean;
  reminder2AfterDays: number;
  reminder2Message: string;
  stopOnReview: boolean;
  sendOnlyBizHours: boolean;
  bizHoursStart: number;
  bizHoursEnd: number;
  stats: CampaignStats;
}

interface CampaignForm {
  name: string;
  targetTags: string[];
  initialMessage: string;
  reminder1Enabled: boolean;
  reminder1AfterDays: number;
  reminder1Message: string;
  reminder2Enabled: boolean;
  reminder2AfterDays: number;
  reminder2Message: string;
  stopOnReview: boolean;
  sendOnlyBizHours: boolean;
  bizHoursStart: number;
  bizHoursEnd: number;
}

const EMPTY_FORM: CampaignForm = {
  name: '',
  targetTags: [],
  initialMessage: '',
  reminder1Enabled: true,
  reminder1AfterDays: 2,
  reminder1Message: '',
  reminder2Enabled: true,
  reminder2AfterDays: 5,
  reminder2Message: '',
  stopOnReview: true,
  sendOnlyBizHours: true,
  bizHoursStart: 9,
  bizHoursEnd: 20,
};

interface CustomerStats {
  total: number;
  pending: number;
  requested: number;
  completed: number;
  optedOut: number;
}

interface CrmLead {
  _id: string;
  name: string;
  phone?: string;
  lifeCycleStage: 'initial' | 'active' | 'closed' | 'converted';
}

const LEAD_STAGE_BADGE: Record<string, string> = {
  initial: 'bg-slate-100 text-slate-600',
  active: 'bg-blue-50 text-blue-600',
  closed: 'bg-rose-50 text-rose-600',
  converted: 'bg-emerald-50 text-emerald-600',
};

interface Suggestion { rating: number; text: string; }

type AiDraftType = 'initial' | 'reminder1' | 'reminder2';
const DRAFT_FIELD: Record<AiDraftType, keyof CampaignForm> = {
  initial: 'initialMessage',
  reminder1: 'reminder1Message',
  reminder2: 'reminder2Message',
};

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
};

const PLACEHOLDER_HELP = 'Placeholders: {{name}} = customer, {{service}} = their service, {{business}} = your business, {{link}} = review link (added automatically if missing)';

export default function CampaignsDashboard() {
  const { activeBusiness, loading: bizLoading } = useBusiness();

  const [activeTab, setActiveTab] = useState<'customers' | 'campaigns'>('customers');

  // --- Customer tab state ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<CustomerStats>({ total: 0, pending: 0, requested: 0, completed: 0, optedOut: 0 });
  const [custLoading, setCustLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [suggestingId, setSuggestingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ customerId: string; customerName: string; items: Suggestion[] } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // --- Groups (customer tags) ---
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [editTagsFor, setEditTagsFor] = useState<Customer | null>(null);
  const [tagsInput, setTagsInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  // --- Add single customer / CRM import ---
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', phone: '', service: '', serviceDate: '', tags: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [importingLeads, setImportingLeads] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showCrmPicker, setShowCrmPicker] = useState(false);
  const [crmLeads, setCrmLeads] = useState<CrmLead[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmSearch, setCrmSearch] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // --- Campaign tab state ---
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campLoading, setCampLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [aiDrafting, setAiDrafting] = useState<AiDraftType | null>(null);
  const [launchConfirm, setLaunchConfirm] = useState<{ id: string; name: string; targetTags: string[] } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<number | null>(null);

  const fetchCustomers = useCallback(async () => {
    setCustLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (tagFilter !== 'all') params.set('tag', tagFilter);
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
  }, [page, search, statusFilter, tagFilter]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/customers/tags');
      const json = await res.json();
      if (json.success) setAvailableTags(json.tags);
    } catch (e) {
      console.error(e);
    }
  }, []);

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
    if (!bizLoading && activeBusiness) {
      fetchCustomers();
      fetchTags();
    }
  }, [fetchCustomers, fetchTags, bizLoading, activeBusiness]);

  useEffect(() => {
    if (!bizLoading && activeBusiness && activeTab === 'campaigns') fetchCampaigns();
  }, [activeTab, fetchCampaigns, bizLoading, activeBusiness]);

  useEffect(() => { setPage(1); }, [search, statusFilter, tagFilter]);

  const handleSendRequest = async (customerId: string) => {
    setSendingId(customerId);
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId })
      });
      if (res.ok) {
        const wasPending = customers.find(c => c._id === customerId)?.reviewStatus === 'Pending';
        setCustomers(prev => prev.map(c => c._id === customerId ? { ...c, reviewStatus: 'Requested' as const } : c));
        setStats(prev => ({
          ...prev,
          pending: wasPending ? prev.pending - 1 : prev.pending,
          requested: prev.requested + 1
        }));
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

  const handleAddCustomer = async () => {
    if (!addForm.name.trim() || !addForm.phone.trim()) return;
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name,
          phone: addForm.phone,
          service: addForm.service || undefined,
          serviceDate: addForm.serviceDate || undefined,
          tags: addForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        })
      });
      const json = await res.json();
      if (json.success) {
        setShowAddCustomer(false);
        setAddForm({ name: '', phone: '', service: '', serviceDate: '', tags: '' });
        fetchCustomers();
        fetchTags();
      } else {
        setAddError(json.message || 'Could not add customer');
      }
    } catch {
      setAddError('Could not add customer — please try again');
    } finally {
      setAddSaving(false);
    }
  };

  // Opens the CRM lead picker. Converted leads (the ones who actually became
  // customers) come pre-selected; the owner can tick any other lead too.
  const openCrmPicker = async () => {
    setShowCrmPicker(true);
    setCrmSearch('');
    setCrmLoading(true);
    try {
      const res = await fetch('/api/crm/leads');
      const json = await res.json();
      if (json.success) {
        const withPhone = (json.leads as CrmLead[]).filter(l => l.phone);
        setCrmLeads(withPhone);
        setSelectedLeadIds(new Set(withPhone.filter(l => l.lifeCycleStage === 'converted').map(l => l._id)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCrmLoading(false);
    }
  };

  const toggleLead = (id: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleImportLeads = async () => {
    if (selectedLeadIds.size === 0) return;
    setImportingLeads(true);
    setImportMsg(null);
    try {
      const res = await fetch('/api/customers/import-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: Array.from(selectedLeadIds) })
      });
      const json = await res.json();
      if (json.success) {
        setImportMsg(`Imported ${json.imported} lead${json.imported !== 1 ? 's' : ''} from CRM (${json.skipped} skipped — invalid phone or already added).`);
        setShowCrmPicker(false);
        fetchCustomers();
        fetchTags();
      } else {
        setImportMsg(json.message || 'Import failed');
      }
    } catch {
      setImportMsg('Import failed — please try again');
    } finally {
      setImportingLeads(false);
    }
  };

  // --- Group (tags) editing ---
  const openTagsEditor = (customer: Customer) => {
    setEditTagsFor(customer);
    setTagsInput((customer.tags ?? []).join(', '));
  };

  const handleSaveTags = async () => {
    if (!editTagsFor) return;
    setSavingTags(true);
    try {
      const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
      const res = await fetch(`/api/customers/${editTagsFor._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
      });
      const json = await res.json();
      if (json.success) {
        setCustomers(prev => prev.map(c => c._id === editTagsFor._id ? { ...c, tags } : c));
        setEditTagsFor(null);
        fetchTags();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingTags(false);
    }
  };

  // --- Campaign editor ---
  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowEditor(true);
  };

  const openEdit = (camp: Campaign) => {
    setEditingId(camp.id);
    setForm({
      name: camp.name,
      targetTags: camp.targetTags ?? [],
      initialMessage: camp.initialMessage ?? '',
      reminder1Enabled: camp.reminder1Enabled,
      reminder1AfterDays: camp.reminder1AfterDays,
      reminder1Message: camp.reminder1Message ?? '',
      reminder2Enabled: camp.reminder2Enabled,
      reminder2AfterDays: camp.reminder2AfterDays,
      reminder2Message: camp.reminder2Message ?? '',
      stopOnReview: camp.stopOnReview,
      sendOnlyBizHours: camp.sendOnlyBizHours,
      bizHoursStart: camp.bizHoursStart,
      bizHoursEnd: camp.bizHoursEnd,
    });
    setShowEditor(true);
  };

  const handleSaveCampaign = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(editingId ? `/api/campaigns/${editingId}` : '/api/campaigns', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const json = await res.json();
      if (json.success) {
        setShowEditor(false);
        setForm(EMPTY_FORM);
        setEditingId(null);
        fetchCampaigns();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleAIDraft = async (type: AiDraftType) => {
    setAiDrafting(type);
    try {
      const res = await fetch('/api/campaigns/generate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const json = await res.json();
      if (json.success) {
        setForm(p => ({ ...p, [DRAFT_FIELD[type]]: json.draft }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAiDrafting(null);
    }
  };

  const toggleTargetTag = (tag: string) => {
    setForm(p => ({
      ...p,
      targetTags: p.targetTags.includes(tag)
        ? p.targetTags.filter(t => t !== tag)
        : [...p.targetTags, tag]
    }));
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

  const handleDelete = async (id: string) => {
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    fetchCampaigns();
  };

  const scheduleSummary = (camp: Campaign) => {
    const parts: string[] = ['Day 0: request'];
    let day = 0;
    if (camp.reminder1Enabled) {
      day += camp.reminder1AfterDays;
      parts.push(`Day ${day}: reminder 1`);
    }
    if (camp.reminder2Enabled) {
      day += camp.reminder2AfterDays;
      parts.push(`Day ${day}: final reminder`);
    }
    return parts.join(' → ');
  };

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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openCrmPicker}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl px-4 py-2.5 shadow-sm transition-all border border-slate-200"
            >
              <Import className="w-4 h-4" /> From CRM
            </button>
            <button
              onClick={() => { setShowAddCustomer(true); setAddError(null); }}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold rounded-xl px-4 py-2.5 shadow-sm transition-all border border-slate-200"
            >
              <UserPlus className="w-4 h-4" /> Add Customer
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
            >
              <UploadCloud className="w-4 h-4" /> Import CSV
            </button>
          </div>
        ) : (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" /> New Campaign
          </button>
        )}
      </div>

      {/* ===== CUSTOMERS TAB ===== */}
      {activeTab === 'customers' && (
        <>
          {importMsg && (
            <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-medium rounded-xl px-4 py-3">
              <span>{importMsg}</span>
              <button onClick={() => setImportMsg(null)} className="text-indigo-400 hover:text-indigo-600 ml-3">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
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
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="all">All Groups</option>
              {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
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
                    <th className="px-6 py-4">Groups</th>
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
                          <td className="px-6 py-4 font-medium">
                            {c.service || '—'}
                            {c.serviceDate && (
                              <p className="text-xs text-slate-400 mt-0.5">{new Date(c.serviceDate).toLocaleDateString()}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(c.tags ?? []).map(t => (
                                <span key={t} className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600">
                                  {t}
                                </span>
                              ))}
                              <button
                                onClick={() => openTagsEditor(c)}
                                title="Edit groups"
                                className="p-1 text-slate-300 hover:text-indigo-500 transition-colors"
                              >
                                <Tag className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
                              {!c.optedOut && (c.reviewStatus === 'Pending' || c.reviewStatus === 'Failed') && c.phone && (
                                <button
                                  onClick={() => handleSendRequest(c._id)}
                                  disabled={sendingId === c._id}
                                  title={c.reviewStatus === 'Failed' ? 'Retry WhatsApp review request' : 'Send WhatsApp review request'}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {sendingId === c._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                                  {sendingId === c._id ? 'Sending…' : c.reviewStatus === 'Failed' ? 'Retry' : 'Request'}
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
              <p className="text-sm text-slate-500 mb-4">Create a campaign to start sending automated WhatsApp review requests to your customers.</p>
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" /> New Campaign
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {campaigns.map(camp => (
                <div key={camp.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-bold text-slate-900">{camp.name}</h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 uppercase">WhatsApp</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CAMPAIGN_STATUS_BADGE[camp.status]}`}>{camp.status}</span>
                        {camp.targetTags?.length > 0 ? (
                          camp.targetTags.map(t => (
                            <span key={t} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">All customers</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {scheduleSummary(camp)}
                        {camp.sendOnlyBizHours && ` · sends ${camp.bizHoursStart}:00–${camp.bizHoursEnd}:00 only`}
                        {camp.stopOnReview && ' · stops on review'}
                      </p>
                      <div className="flex gap-4 text-xs text-slate-500">
                        <span>Total: <strong className="text-slate-700">{camp.stats.total}</strong></span>
                        <span>Sent: <strong className="text-slate-700">{camp.stats.sent}</strong></span>
                        <span>Clicked: <strong className="text-slate-700">{camp.stats.clicked}</strong></span>
                        <span>Reviewed: <strong className="text-slate-700">{camp.stats.reviewed}</strong></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEdit(camp)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl transition-colors border border-slate-200"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      {camp.status === 'DRAFT' && (
                        <button
                          onClick={() => { setLaunchConfirm({ id: camp.id, name: camp.name, targetTags: camp.targetTags }); setLaunchResult(null); }}
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
                          onClick={() => { setLaunchConfirm({ id: camp.id, name: camp.name, targetTags: camp.targetTags }); setLaunchResult(null); }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition-colors border border-indigo-200"
                        >
                          <Play className="w-3.5 h-3.5" /> Resume
                        </button>
                      )}
                      {(camp.status === 'DRAFT' || camp.status === 'COMPLETED') && (
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
          onSuccess={() => { setShowUpload(false); fetchCustomers(); fetchTags(); }}
        />
      )}

      {/* CRM Lead Picker Modal */}
      {showCrmPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Import from CRM</h2>
                <p className="text-xs text-slate-400 mt-0.5">Converted leads are pre-selected — tick any other lead you want to add.</p>
              </div>
              <button onClick={() => setShowCrmPicker(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 pt-4 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search leads…"
                  value={crmSearch}
                  onChange={e => setCrmSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {crmLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                </div>
              ) : crmLeads.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">No CRM leads with a phone number found.</p>
              ) : (
                <div className="space-y-1.5">
                  {crmLeads
                    .filter(l => !crmSearch || l.name.toLowerCase().includes(crmSearch.toLowerCase()) || (l.phone ?? '').includes(crmSearch))
                    .map(lead => (
                      <label
                        key={lead._id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${selectedLeadIds.has(lead._id) ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-100 hover:bg-slate-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.has(lead._id)}
                          onChange={() => toggleLead(lead._id)}
                          className="w-4 h-4 rounded accent-indigo-600"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900 truncate">{lead.name}</p>
                          <p className="text-xs text-slate-400">{lead.phone ? maskPhone(lead.phone) : '—'}</p>
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${LEAD_STAGE_BADGE[lead.lifeCycleStage] || LEAD_STAGE_BADGE.initial}`}>
                          {lead.lifeCycleStage}
                        </span>
                      </label>
                    ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowCrmPicker(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleImportLeads}
                disabled={importingLeads || selectedLeadIds.size === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
              >
                {importingLeads ? <Loader2 className="w-4 h-4 animate-spin" /> : <Import className="w-4 h-4" />}
                Import Selected ({selectedLeadIds.size})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Add Customer</h2>
              <button onClick={() => setShowAddCustomer(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Name *</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">WhatsApp Number *</label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+91 98765 43210 or 9876543210"
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">Service</label>
                  <input
                    type="text"
                    value={addForm.service}
                    onChange={e => setAddForm(p => ({ ...p, service: e.target.value }))}
                    placeholder="e.g. Haircut"
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">Service Date</label>
                  <input
                    type="date"
                    value={addForm.serviceDate}
                    onChange={e => setAddForm(p => ({ ...p, serviceDate: e.target.value }))}
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Groups (comma separated)</label>
                <input
                  type="text"
                  value={addForm.tags}
                  onChange={e => setAddForm(p => ({ ...p, tags: e.target.value }))}
                  placeholder="e.g. VIP, July-Customers"
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {addError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2.5">{addError}</p>
              )}
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowAddCustomer(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleAddCustomer}
                disabled={addSaving || !addForm.name.trim() || !addForm.phone.trim()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
              >
                {addSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Add Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Groups Modal */}
      {editTagsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900">Groups for {editTagsFor.name}</h2>
              <button onClick={() => setEditTagsFor(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <label className="block text-sm font-bold text-slate-700">Groups (comma separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="e.g. VIP, Dental, July-Customers"
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {availableTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map(t => (
                    <button
                      key={t}
                      onClick={() => {
                        const current = tagsInput.split(',').map(s => s.trim()).filter(Boolean);
                        if (!current.includes(t)) setTagsInput([...current, t].join(', '));
                      }}
                      className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400">Campaigns can target one or more groups. A customer can be in several groups.</p>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setEditTagsFor(null)} className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleSaveTags}
                disabled={savingTags}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
              >
                {savingTags && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Groups
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Editor Modal (create + edit) */}
      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-slate-100 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit Campaign' : 'New Campaign'}</h2>
              <button onClick={() => setShowEditor(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto">
              {/* Name */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Campaign Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Q3 Review Drive"
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Target groups */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Send To</label>
                {availableTags.length === 0 ? (
                  <p className="text-xs text-slate-400 bg-slate-50 rounded-xl p-3">
                    No groups yet — all customers will be targeted. Assign groups to customers from the Customers tab (tag icon).
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setForm(p => ({ ...p, targetTags: [] }))}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${form.targetTags.length === 0 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
                      >
                        All customers
                      </button>
                      {availableTags.map(t => (
                        <button
                          key={t}
                          onClick={() => toggleTargetTag(t)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${form.targetTags.includes(t) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5">Pick one or more groups, or "All customers".</p>
                  </>
                )}
              </div>

              {/* Initial message */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-bold text-slate-700">First WhatsApp Message</label>
                  <button
                    onClick={() => handleAIDraft('initial')}
                    disabled={aiDrafting !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-50 hover:bg-violet-100 text-violet-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {aiDrafting === 'initial' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    Generate with AI
                  </button>
                </div>
                <textarea
                  value={form.initialMessage}
                  onChange={e => setForm(p => ({ ...p, initialMessage: e.target.value }))}
                  rows={4}
                  placeholder={'Leave empty to let AI write a fresh message for each customer, or write your own, e.g.:\nHi {{name}}, thanks for choosing {{business}} for your {{service}}! We\'d love your feedback: {{link}}\nReply STOP to opt-out.'}
                  className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">{PLACEHOLDER_HELP}</p>
              </div>

              {/* Reminder 1 */}
              <div className={`rounded-xl border p-4 space-y-3 ${form.reminder1Enabled ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.reminder1Enabled}
                      onChange={e => setForm(p => ({ ...p, reminder1Enabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-indigo-600"
                    />
                    <span className="text-sm font-bold text-slate-700">Reminder 1</span>
                  </label>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span>after</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={form.reminder1AfterDays}
                      onChange={e => setForm(p => ({ ...p, reminder1AfterDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) }))}
                      disabled={!form.reminder1Enabled}
                      className="w-16 px-2 py-1.5 text-sm text-center border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <span>day(s)</span>
                  </div>
                </div>
                {form.reminder1Enabled && (
                  <>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleAIDraft('reminder1')}
                        disabled={aiDrafting !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-50 hover:bg-violet-100 text-violet-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {aiDrafting === 'reminder1' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        Generate with AI
                      </button>
                    </div>
                    <textarea
                      value={form.reminder1Message}
                      onChange={e => setForm(p => ({ ...p, reminder1Message: e.target.value }))}
                      rows={3}
                      placeholder={'Leave empty for the default:\nHi {{name}}, just a quick reminder! We\'d really appreciate a review of your recent {{service}}: {{link}}'}
                      className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono bg-white"
                    />
                  </>
                )}
              </div>

              {/* Reminder 2 */}
              <div className={`rounded-xl border p-4 space-y-3 ${form.reminder2Enabled ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.reminder2Enabled}
                      onChange={e => setForm(p => ({ ...p, reminder2Enabled: e.target.checked }))}
                      className="w-4 h-4 rounded accent-indigo-600"
                    />
                    <span className="text-sm font-bold text-slate-700">Final Reminder</span>
                  </label>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span>after another</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={form.reminder2AfterDays}
                      onChange={e => setForm(p => ({ ...p, reminder2AfterDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) }))}
                      disabled={!form.reminder2Enabled}
                      className="w-16 px-2 py-1.5 text-sm text-center border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <span>day(s)</span>
                  </div>
                </div>
                {form.reminder2Enabled && (
                  <>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleAIDraft('reminder2')}
                        disabled={aiDrafting !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-50 hover:bg-violet-100 text-violet-600 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {aiDrafting === 'reminder2' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                        Generate with AI
                      </button>
                    </div>
                    <textarea
                      value={form.reminder2Message}
                      onChange={e => setForm(p => ({ ...p, reminder2Message: e.target.value }))}
                      rows={3}
                      placeholder={'Leave empty for the default:\nHi {{name}}, last bother from us! A review would mean the world to our team at {{business}}: {{link}}'}
                      className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono bg-white"
                    />
                  </>
                )}
              </div>

              {/* Behavior settings */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.stopOnReview}
                    onChange={e => setForm(p => ({ ...p, stopOnReview: e.target.checked }))}
                    className="w-4 h-4 rounded accent-indigo-600"
                  />
                  <span className="text-sm text-slate-700">Stop reminders once the customer leaves a review</span>
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.sendOnlyBizHours}
                      onChange={e => setForm(p => ({ ...p, sendOnlyBizHours: e.target.checked }))}
                      className="w-4 h-4 rounded accent-indigo-600"
                    />
                    <span className="text-sm text-slate-700">Send only during business hours</span>
                  </label>
                  {form.sendOnlyBizHours && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={form.bizHoursStart}
                        onChange={e => setForm(p => ({ ...p, bizHoursStart: Math.max(0, Math.min(23, Number(e.target.value) || 0)) }))}
                        className="w-16 px-2 py-1.5 text-sm text-center border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span>:00 to</span>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={form.bizHoursEnd}
                        onChange={e => setForm(p => ({ ...p, bizHoursEnd: Math.max(1, Math.min(24, Number(e.target.value) || 24)) }))}
                        className="w-16 px-2 py-1.5 text-sm text-center border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span>:00</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowEditor(false)} className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleSaveCampaign}
                disabled={saving || !form.name.trim()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {editingId ? 'Save Changes' : 'Create Campaign'}
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
                  <strong>{launchResult}</strong> WhatsApp review request{launchResult !== 1 ? 's' : ''} queued for delivery.
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
                  {launchConfirm.targetTags?.length > 0
                    ? <>WhatsApp review requests will go to customers in <strong>{launchConfirm.targetTags.join(', ')}</strong> who have a phone number and haven't opted out.</>
                    : <>WhatsApp review requests will go to all customers with a phone number who haven't opted out.</>}
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
    </div>
  );
}
