'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { toast } from 'sonner';
import {
  UploadCloud, Users, Send, TrendingUp, MessageSquare, Search, X,
  Loader2, Star, Trash2, Mail, Sparkles, ChevronLeft, ChevronRight, Tag, UserPlus, Import
} from 'lucide-react';
import CustomerUploadModal from '@/components/campaigns/CustomerUploadModal';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
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

interface CustomerStats {
  total: number;
  pending: number;
  requested: number;
  completed: number;
  optedOut: number;
}

interface RequestMetrics {
  reviewRequests: number;
  delivered: number;
  read: number;
  clicked: number;
  failed: number;
}

interface RequestSummary {
  statusLabel: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  clickedAt: string | null;
  lastRequestAt: string | null;
  followUpLabel: string;
}

const EMPTY_METRICS: RequestMetrics = { reviewRequests: 0, delivered: 0, read: 0, clicked: 0, failed: 0 };

function formatWhen(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function rowStatus(customer: Customer, summary?: RequestSummary): string {
  if (summary?.statusLabel) return summary.statusLabel;
  if (customer.reviewStatus === 'Failed') return 'Unable to deliver';
  if (customer.reviewStatus === 'Requested' || customer.reviewStatus === 'Completed') return 'Sent';
  return 'Pending';
}

function statusBadgeClass(label: string): string {
  if (label === 'Unable to deliver') return STATUS_BADGE.Failed;
  if (label === 'Clicked' || label === 'Read' || label === 'Delivered') return STATUS_BADGE.Completed;
  if (label === 'Sent') return STATUS_BADGE.Requested;
  return STATUS_BADGE.Pending;
}

interface CrmLead {
  _id: string;
  name: string;
  phone?: string;
  lifeCycleStage: 'initial' | 'active' | 'closed' | 'converted';
}

const LEAD_STAGE_BADGE: Record<string, string> = {
  initial: 'bg-surface-container text-on-surface-variant',
  active: 'bg-primary-fixed text-primary',
  closed: 'bg-error-container text-on-error-container',
  converted: 'bg-secondary-container/40 text-secondary',
};

interface Suggestion { rating: number; text: string; }

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + 'X'.repeat(Math.max(0, phone.length - 6)) + phone.slice(-3);
}

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-surface-container text-on-surface-variant',
  Requested: 'bg-primary-fixed text-primary',
  Completed: 'bg-secondary-container/40 text-secondary',
  Failed: 'bg-error-container text-on-error-container',
};

export default function CampaignsDashboard() {
  const { activeBusiness, loading: bizLoading } = useBusiness();

  // --- Customer list ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<CustomerStats>({ total: 0, pending: 0, requested: 0, completed: 0, optedOut: 0 });
  const [custLoading, setCustLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
  const [existingSend, setExistingSend] = useState<{ customerId: string; allowed: boolean; message: string } | null>(null);
  const [requestMetrics, setRequestMetrics] = useState<RequestMetrics>(EMPTY_METRICS);
  const [latestByCustomer, setLatestByCustomer] = useState<Record<string, RequestSummary>>({});
  const [importingLeads, setImportingLeads] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showCrmPicker, setShowCrmPicker] = useState(false);
  const [crmLeads, setCrmLeads] = useState<CrmLead[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmSearch, setCrmSearch] = useState('');
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

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

  const fetchRequestMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/review-requests');
      const json = await res.json();
      if (json.success) {
        setRequestMetrics(json.metrics);
        setLatestByCustomer(json.latestByCustomer || {});
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/customers/tags');
      const json = await res.json();
      if (json.success) setAvailableTags(json.tags);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (!bizLoading && activeBusiness) {
      fetchCustomers();
      fetchTags();
      fetchRequestMetrics();
    }
  }, [fetchCustomers, fetchTags, fetchRequestMetrics, bizLoading, activeBusiness]);

  useEffect(() => { setPage(1); }, [search, statusFilter, tagFilter]);

  const handleSendRequest = async (customerId: string) => {
    setSendingId(customerId);
    try {
      const res = await fetch('/api/campaigns/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const wasPending = customers.find(c => c._id === customerId)?.reviewStatus === 'Pending';
        setCustomers(prev => prev.map(c => c._id === customerId ? { ...c, reviewStatus: 'Requested' as const } : c));
        setStats(prev => ({
          ...prev,
          pending: wasPending ? prev.pending - 1 : prev.pending,
          requested: prev.requested + 1
        }));
        fetchRequestMetrics();
      } else {
        toast.error(typeof json.error === 'string' ? json.error : 'Could not send the review request');
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not send the review request');
    } finally {
      setSendingId(null);
    }
  };

  const handleDeleteCustomer = async (customer: Customer) => {
    if (!confirm(`Delete ${customer.name}? This removes them and their review-request history — you'll be able to add them again and send a fresh request (e.g. to re-test the same phone number).`)) return;
    setDeletingId(customer._id);
    try {
      const res = await fetch(`/api/customers/${customer._id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchCustomers();
      } else {
        toast.error(json.message || 'Could not delete customer');
      }
    } catch {
      toast.error('Could not delete customer — please try again');
    } finally {
      setDeletingId(null);
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
    setExistingSend(null);
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
        setExistingSend(null);
        fetchCustomers();
        fetchTags();
      } else if (json.code === 'CUSTOMER_EXISTS') {
        setAddError('Customer already exists');
        setExistingSend(json.customerId ? {
          customerId: json.customerId,
          allowed: !!json.eligibility?.allowed,
          message: json.eligibility?.allowed ? '' : (json.eligibility?.message || ''),
        } : null);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openCrmPicker}
              className="flex items-center gap-2 bg-surface-container-lowest hover:bg-surface text-on-surface text-sm font-bold rounded-xl px-4 py-2.5 shadow-sm transition-all border border-outline-variant"
            >
              <Import className="w-4 h-4" /> From CRM
            </button>
            <button
              onClick={() => { setShowAddCustomer(true); setAddError(null); setExistingSend(null); }}
              className="flex items-center gap-2 bg-surface-container-lowest hover:bg-surface text-on-surface text-sm font-bold rounded-xl px-4 py-2.5 shadow-sm transition-all border border-outline-variant"
            >
              <UserPlus className="w-4 h-4" /> Add Customer
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 bg-primary hover:bg-primary-container text-white text-sm font-bold rounded-xl px-5 py-2.5 shadow-sm transition-all"
            >
              <UploadCloud className="w-4 h-4" /> Import CSV
            </button>
          </div>
      </div>

        <>
          {importMsg && (
            <div className="flex items-center justify-between bg-primary-fixed border border-primary-fixed-dim text-primary text-sm font-medium rounded-xl px-4 py-3">
              <span>{importMsg}</span>
              <button onClick={() => setImportMsg(null)} className="text-primary-fixed-dim hover:text-primary ml-3">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Review Requests', value: requestMetrics.reviewRequests },
              { label: 'Delivered', value: requestMetrics.delivered },
              { label: 'Read', value: requestMetrics.read },
              { label: 'Clicked', value: requestMetrics.clicked },
              { label: 'Failed', value: requestMetrics.failed },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
                <span className="text-xs font-bold text-on-surface-variant">{label}</span>
                <p className="text-2xl font-bold text-on-surface mt-1">{value.toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Customers', value: stats.total, icon: Users, color: 'text-primary' },
              { label: 'Pending Reviews', value: stats.pending, icon: MessageSquare, color: 'text-error' },
              { label: 'Requests Sent', value: stats.requested, icon: Send, color: 'text-primary' },
              { label: 'Opted Out', value: stats.optedOut, icon: TrendingUp, color: 'text-error' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
                <div className={`flex items-center gap-2 mb-1 ${color}`}>
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-bold">{label}</span>
                </div>
                <p className="text-2xl font-bold text-on-surface">{value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
              <input
                type="text"
                placeholder="Search by name, phone, or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest"
              />
            </div>
            <select
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest"
            >
              <option value="all">All Groups</option>
              {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface-container-lowest"
            >
              <option value="all">All Statuses</option>
              <option value="Pending">Pending</option>
              <option value="Requested">Requested</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-on-surface-variant">
                <thead className="bg-surface-container-low border-b border-outline-variant text-xs uppercase font-bold text-outline">
                  <tr>
                    <th className="px-4 py-4">Customer</th>
                    <th className="px-4 py-4">Service</th>
                    <th className="px-4 py-4">Groups</th>
                    <th className="px-4 py-4">Request status</th>
                    <th className="px-4 py-4">Sent</th>
                    <th className="px-4 py-4">Delivered</th>
                    <th className="px-4 py-4">Read</th>
                    <th className="px-4 py-4">Clicked</th>
                    <th className="px-4 py-4">Last request</th>
                    <th className="px-4 py-4">Follow-up</th>
                    <th className="px-4 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {custLoading ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-10 text-center">
                        <Loader2 className="w-5 h-5 animate-spin text-outline mx-auto" />
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center">
                          <div className="w-12 h-12 bg-primary-fixed text-primary rounded-full flex items-center justify-center mb-3">
                            <Users className="w-6 h-6" />
                          </div>
                          <p className="font-bold text-on-surface mb-1">No customers yet</p>
                          <p className="text-sm text-on-surface-variant">Import your past customers via CSV to start requesting reviews.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    customers.map(c => (
                      <Fragment key={c._id}>
                        <tr className="hover:bg-surface/50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-on-surface">{c.name}</p>
                            <p className="text-xs text-outline mt-0.5">{c.phone ? maskPhone(c.phone) : c.email || '—'}</p>
                          </td>
                          <td className="px-6 py-4 font-medium">
                            {c.service || '—'}
                            {c.serviceDate && (
                              <p className="text-xs text-outline mt-0.5">{new Date(c.serviceDate).toLocaleDateString()}</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {(c.tags ?? []).map(t => (
                                <span key={t} className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-fixed text-primary">
                                  {t}
                                </span>
                              ))}
                              <button
                                onClick={() => openTagsEditor(c)}
                                title="Edit groups"
                                className="p-1 text-outline hover:text-primary transition-colors"
                              >
                                <Tag className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-1.5">
                              <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass(rowStatus(c, latestByCustomer[c._id]))}`}>
                                {rowStatus(c, latestByCustomer[c._id])}
                              </span>
                              {c.optedOut && (
                                <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold bg-error-container text-on-error-container">
                                  Opted Out
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">{formatWhen(latestByCustomer[c._id]?.sentAt)}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{formatWhen(latestByCustomer[c._id]?.deliveredAt)}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{formatWhen(latestByCustomer[c._id]?.readAt)}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{formatWhen(latestByCustomer[c._id]?.clickedAt)}</td>
                          <td className="px-4 py-4 whitespace-nowrap">{formatWhen(latestByCustomer[c._id]?.lastRequestAt)}</td>
                          <td className="px-4 py-4">{latestByCustomer[c._id]?.followUpLabel || '—'}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              {!c.optedOut && (c.reviewStatus === 'Pending' || c.reviewStatus === 'Failed') && c.phone && (
                                <button
                                  onClick={() => handleSendRequest(c._id)}
                                  disabled={sendingId === c._id}
                                  title={c.reviewStatus === 'Failed' ? 'Retry WhatsApp review request' : 'Send WhatsApp review request'}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-fixed hover:bg-primary-fixed text-primary text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {sendingId === c._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                                  {sendingId === c._id ? 'Sending…' : c.reviewStatus === 'Failed' ? 'Retry' : 'Request'}
                                </button>
                              )}
                              <button
                                onClick={() => handleAISuggest(c)}
                                disabled={suggestingId === c._id}
                                title="AI Suggest review text"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-fixed hover:bg-primary-fixed text-primary text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                              >
                                {suggestingId === c._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                AI Suggest
                              </button>
                              <button
                                onClick={() => handleDeleteCustomer(c)}
                                disabled={deletingId === c._id}
                                title="Delete customer (lets you re-add and retry review requests for the same number)"
                                className="p-1.5 text-outline hover:text-error hover:bg-error-container rounded-lg transition-colors disabled:opacity-50"
                              >
                                {deletingId === c._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {suggestions?.customerId === c._id && (
                          <tr>
                            <td colSpan={11} className="px-6 pb-4">
                              <div className="bg-primary-fixed border border-primary-fixed-dim rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-sm font-bold text-primary flex items-center gap-1.5">
                                    <Sparkles className="w-4 h-4" />
                                    Review suggestions for {suggestions.customerName} — share these to inspire their review
                                  </p>
                                  <button onClick={() => setSuggestions(null)} className="text-primary-fixed-dim hover:text-primary">
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                                <div className="grid sm:grid-cols-3 gap-3">
                                  {suggestions.items.map((s, i) => (
                                    <div key={i} className="bg-surface-container-lowest rounded-lg p-3 border border-primary-fixed-dim">
                                      <div className="flex items-center gap-0.5 mb-2">
                                        {Array.from({ length: s.rating }).map((_, j) => (
                                          <Star key={j} className="w-3 h-3 fill-error text-error" />
                                        ))}
                                      </div>
                                      <p className="text-xs text-on-surface leading-relaxed mb-2">{s.text}</p>
                                      <button
                                        onClick={() => handleCopy(s.text, i)}
                                        className="text-xs font-bold text-primary hover:text-primary-container"
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
                className="p-2 rounded-lg border border-outline-variant hover:bg-surface-container disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-on-surface-variant">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-lg border border-outline-variant hover:bg-surface-container disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>

      {/* Customer Upload Modal */}
      {showUpload && (
        <CustomerUploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); fetchCustomers(); fetchTags(); }}
        />
      )}

      {/* CRM Lead Picker Modal */}
      {showCrmPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-outline-variant shrink-0">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Import from CRM</h2>
                <p className="text-xs text-outline mt-0.5">Converted leads are pre-selected — tick any other lead you want to add.</p>
              </div>
              <button onClick={() => setShowCrmPicker(false)} className="text-outline hover:text-on-surface-variant">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 pt-4 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
                <input
                  type="text"
                  placeholder="Search leads…"
                  value={crmSearch}
                  onChange={e => setCrmSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {crmLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-outline" />
                </div>
              ) : crmLeads.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-8">No CRM leads with a phone number found.</p>
              ) : (
                <div className="space-y-1.5">
                  {crmLeads
                    .filter(l => !crmSearch || l.name.toLowerCase().includes(crmSearch.toLowerCase()) || (l.phone ?? '').includes(crmSearch))
                    .map(lead => (
                      <label
                        key={lead._id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${selectedLeadIds.has(lead._id) ? 'border-primary-fixed-dim bg-primary-fixed/50' : 'border-outline-variant hover:bg-surface'}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.has(lead._id)}
                          onChange={() => toggleLead(lead._id)}
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-on-surface truncate">{lead.name}</p>
                          <p className="text-xs text-outline">{lead.phone ? maskPhone(lead.phone) : '—'}</p>
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${LEAD_STAGE_BADGE[lead.lifeCycleStage] || LEAD_STAGE_BADGE.initial}`}>
                          {lead.lifeCycleStage}
                        </span>
                      </label>
                    ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-outline-variant flex justify-end gap-3 shrink-0">
              <button onClick={() => setShowCrmPicker(false)} className="px-5 py-2.5 text-sm font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleImportLeads}
                disabled={importingLeads || selectedLeadIds.size === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-outline-variant">
              <h2 className="text-lg font-bold text-on-surface">Add Customer</h2>
              <button onClick={() => setShowAddCustomer(false)} className="text-outline hover:text-on-surface-variant">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-on-surface mb-1.5">Name *</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-on-surface mb-1.5">WhatsApp Number *</label>
                <PhoneNumberInput
                  value={addForm.phone}
                  onChange={v => setAddForm(p => ({ ...p, phone: v }))}
                  className="rounded-xl [&_input]:py-2.5 [&_select]:py-2.5"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-on-surface mb-1.5">Service</label>
                  <input
                    type="text"
                    value={addForm.service}
                    onChange={e => setAddForm(p => ({ ...p, service: e.target.value }))}
                    placeholder="e.g. Haircut"
                    className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-on-surface mb-1.5">Service Date</label>
                  <input
                    type="date"
                    value={addForm.serviceDate}
                    onChange={e => setAddForm(p => ({ ...p, serviceDate: e.target.value }))}
                    className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-on-surface mb-1.5">Groups (comma separated)</label>
                <input
                  type="text"
                  value={addForm.tags}
                  onChange={e => setAddForm(p => ({ ...p, tags: e.target.value }))}
                  placeholder="e.g. VIP, July-Customers"
                  className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              {addError && (
                <div className="text-sm text-on-error-container bg-error-container border border-error rounded-xl px-4 py-2.5 space-y-2">
                  <p>{addError}</p>
                  {existingSend && !existingSend.allowed && existingSend.message && <p>{existingSend.message}</p>}
                  {existingSend?.allowed && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddCustomer(false);
                        setExistingSend(null);
                        void handleSendRequest(existingSend.customerId);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg"
                    >
                      <Send className="w-3.5 h-3.5" /> Send Review Request
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-outline-variant flex justify-end gap-3">
              <button onClick={() => setShowAddCustomer(false)} className="px-5 py-2.5 text-sm font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleAddCustomer}
                disabled={addSaving || !addForm.name.trim() || !addForm.phone.trim()}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 backdrop-blur-sm p-4">
          <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md">
            <div className="flex justify-between items-center p-6 border-b border-outline-variant">
              <h2 className="text-lg font-bold text-on-surface">Groups for {editTagsFor.name}</h2>
              <button onClick={() => setEditTagsFor(null)} className="text-outline hover:text-on-surface-variant">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <label className="block text-sm font-bold text-on-surface">Groups (comma separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="e.g. VIP, Repeat, July-Customers"
                className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
                      className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-primary-fixed text-primary hover:bg-primary-fixed"
                    >
                      + {t}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-outline">A customer can belong to more than one group.</p>
            </div>
            <div className="p-6 border-t border-outline-variant flex justify-end gap-3">
              <button onClick={() => setEditTagsFor(null)} className="px-5 py-2.5 text-sm font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleSaveTags}
                disabled={savingTags}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
              >
                {savingTags && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Groups
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
