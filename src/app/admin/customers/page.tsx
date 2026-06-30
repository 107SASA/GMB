'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  UserCheck,
  RefreshCw,
  Calendar,
  ArrowLeft,
  ArrowRight,
  Gauge,
  Pencil,
  RotateCcw,
  Check,
  X,
  Info,
  SlidersHorizontal,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { PLAN_DEFAULTS, getPlanDefaults } from '@/lib/planDefaults';

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────
interface CustomerBusiness {
  _id: string;
  name: string;
  category: string;
  address?: string;
  city?: string;
}

interface CustomerSubscription {
  planType: string;
  billingStatus: string;
  trialActive?: boolean;
}

interface Customer {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  createdAt: string;
  subscriptionPlan: string;
  onboardingCompleted: boolean;
  business: CustomerBusiness | null;
  subscription: CustomerSubscription | null;
  isActive: boolean;
}

interface Stats {
  totalUsers: number;
  newThisWeek: number;
  proUsers: number;
  enterpriseUsers: number;
}

interface CustomersApiResponse {
  users: Customer[];
  total: number;
  page: number;
  totalPages: number;
  stats: Stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared micro-components
// ─────────────────────────────────────────────────────────────────────────────
function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, string> = {
    Free:       'bg-slate-50 text-slate-600 border-slate-200',
    Pro:        'bg-indigo-50 text-indigo-700 border-indigo-100',
    Enterprise: 'bg-violet-50 text-violet-700 border-violet-100',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[plan] ?? map.Free)}>
      {plan}
    </span>
  );
}

function Avatar({ name, plan }: { name: string; plan: string }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const color =
    plan === 'Enterprise' ? 'bg-violet-600' :
    plan === 'Pro'        ? 'bg-indigo-600' : 'bg-slate-400';
  return (
    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0', color)}>
      {initials || '?'}
    </div>
  );
}

function BillingBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active:   'bg-emerald-50 text-emerald-700 border-emerald-100',
    Trialing: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    PastDue:  'bg-amber-50 text-amber-700 border-amber-100',
    Canceled: 'bg-rose-50 text-rose-700 border-rose-100',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[status] ?? 'bg-slate-50 text-slate-600 border-slate-200')}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers tab — expanded row
// ─────────────────────────────────────────────────────────────────────────────
function ExpandedRow({ customer, onImpersonate, impersonating }: {
  customer: Customer;
  onImpersonate: (businessId: string) => void;
  impersonating: boolean;
}) {
  return (
    <tr className="bg-violet-50/40">
      <td colSpan={7} className="px-6 py-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Email</p>
            <p className="text-slate-700 font-medium">{customer.email}</p>
          </div>
          {customer.phone && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Phone</p>
              <p className="text-slate-700 font-medium">{customer.phone}</p>
            </div>
          )}
          {customer.business && (
            <>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Business</p>
                <p className="text-slate-700 font-medium">{customer.business.name}</p>
                <p className="text-slate-500 text-xs">{customer.business.category}</p>
              </div>
              {(customer.business.address || customer.business.city) && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Address</p>
                  <p className="text-slate-700 font-medium">
                    {[customer.business.address, customer.business.city].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
            </>
          )}
          {customer.subscription && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Billing</p>
              <BillingBadge status={customer.subscription.billingStatus} />
              {customer.subscription.trialActive && (
                <span className="ml-2 text-xs text-cyan-600 font-semibold">Trial active</span>
              )}
            </div>
          )}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Onboarding</p>
            <span className={cn('text-xs font-bold', customer.onboardingCompleted ? 'text-emerald-600' : 'text-amber-500')}>
              {customer.onboardingCompleted ? 'Completed' : 'Incomplete'}
            </span>
          </div>
          {customer.business?._id && (
            <div className="ml-auto flex items-end">
              <button
                onClick={() => onImpersonate(customer.business!._id)}
                disabled={impersonating}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 transition-all disabled:opacity-60 shadow-sm"
              >
                <UserCheck className="w-4 h-4" />
                {impersonating ? 'Switching...' : 'Impersonate'}
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Limits tab — types
// ─────────────────────────────────────────────────────────────────────────────
const LIMIT_FIELDS = [
  { key: 'maxAuditsPerBusiness',      label: 'Max Audits / Business',      unit: 'audits' },
  { key: 'maxPostsPerMonth',          label: 'Max Posts / Month',           unit: 'posts' },
  { key: 'maxWhatsAppMessagesPerDay', label: 'WhatsApp Messages / Day',     unit: 'msgs' },
  { key: 'reviewRequestCooldownDays', label: 'Review Request Cooldown',     unit: 'days' },
  { key: 'maxAIGenerations',          label: 'Max AI Generations / Month',  unit: 'gens' },
] as const;

type LimitKey = typeof LIMIT_FIELDS[number]['key'];

interface LimitOverride {
  maxAuditsPerBusiness:      number | null;
  maxPostsPerMonth:          number | null;
  maxWhatsAppMessagesPerDay: number | null;
  reviewRequestCooldownDays: number | null;
  maxAIGenerations:          number | null;
  adminNotes:                string;
}

interface UsageLimitRow {
  userId:     string;
  fullName:   string;
  email:      string;
  plan:       string;
  business:   { name: string; category: string } | null;
  effective:  Record<LimitKey, number> & { overriddenFields: LimitKey[] };
  override:   LimitOverride;
  hasOverride: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit limits drawer / modal
// ─────────────────────────────────────────────────────────────────────────────
function EditLimitsModal({
  row,
  onSave,
  onClose,
}: {
  row: UsageLimitRow;
  onSave: (userId: string, updates: Partial<LimitOverride>) => Promise<void>;
  onClose: () => void;
}) {
  const planDefaults = getPlanDefaults(row.plan);

  // Local draft: null = use plan default, number = custom override
  const [draft, setDraft] = useState<Record<LimitKey, number | null>>(() => ({
    maxAuditsPerBusiness:      row.override.maxAuditsPerBusiness,
    maxPostsPerMonth:          row.override.maxPostsPerMonth,
    maxWhatsAppMessagesPerDay: row.override.maxWhatsAppMessagesPerDay,
    reviewRequestCooldownDays: row.override.reviewRequestCooldownDays,
    maxAIGenerations:          row.override.maxAIGenerations,
  }));
  const [notes, setNotes]     = useState(row.override.adminNotes);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await onSave(row.userId, { ...draft, adminNotes: notes });
      onClose();
    } catch (err: any) {
      console.error('[EditLimitsModal] save failed:', err);
      setSaveError(err?.message || 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft({
      maxAuditsPerBusiness:      null,
      maxPostsPerMonth:          null,
      maxWhatsAppMessagesPerDay: null,
      reviewRequestCooldownDays: null,
      maxAIGenerations:          null,
    });
    setNotes('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
              <SlidersHorizontal className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">{row.fullName}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <PlanBadge plan={row.plan} />
                {row.business && (
                  <span className="text-xs text-slate-400">{row.business.name}</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">

          <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Leave a field empty to use the <strong>{row.plan}</strong> plan default.
              Override only what you need to change.
            </span>
          </div>

          {LIMIT_FIELDS.map(({ key, label, unit }) => {
            const planDefault = planDefaults[key];
            const isOverridden = draft[key] !== null;

            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold text-slate-700">{label}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      Plan default: <strong className="text-slate-600">{planDefault} {unit}</strong>
                    </span>
                    {isOverridden && (
                      <button
                        onClick={() => setDraft(d => ({ ...d, [key]: null }))}
                        className="text-xs text-rose-500 hover:text-rose-700 font-semibold flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    placeholder={`Default: ${planDefault}`}
                    value={draft[key] ?? ''}
                    onChange={e => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      setDraft(d => ({ ...d, [key]: val }));
                    }}
                    className={cn(
                      'w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all',
                      isOverridden
                        ? 'border-violet-300 bg-violet-50/60 focus:ring-violet-100 text-violet-800 font-semibold'
                        : 'border-slate-200 bg-white focus:ring-violet-100 focus:border-violet-300 text-slate-500'
                    )}
                  />
                  {isOverridden && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded-md">
                      CUSTOM
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Admin notes */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Admin Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason for override, customer request, etc."
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        {saveError && (
          <div className="mx-6 mb-0 mt-0 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
            {saveError}
          </div>
        )}
        <div className="flex items-center gap-3 p-6 border-t border-slate-100">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset All to Defaults
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-60 shadow-sm"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</>
            ) : (
              <><Check className="w-4 h-4" /> Save Limits</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Plan Defaults modal
// ─────────────────────────────────────────────────────────────────────────────
interface PlanConfigRow {
  plan: string;
  maxAuditsPerBusiness:      number;
  maxPostsPerMonth:          number;
  maxWhatsAppMessagesPerDay: number;
  reviewRequestCooldownDays: number;
  maxAIGenerations:          number;
  isCustom: boolean;
}

function EditPlanModal({
  config,
  onSave,
  onReset,
  onClose,
}: {
  config: PlanConfigRow;
  onSave: (plan: string, values: Omit<PlanConfigRow, 'plan' | 'isCustom'>) => Promise<void>;
  onReset: (plan: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    maxAuditsPerBusiness:      config.maxAuditsPerBusiness,
    maxPostsPerMonth:          config.maxPostsPerMonth,
    maxWhatsAppMessagesPerDay: config.maxWhatsAppMessagesPerDay,
    reviewRequestCooldownDays: config.reviewRequestCooldownDays,
    maxAIGenerations:          config.maxAIGenerations,
  });
  const [saving, setSaving]       = useState(false);
  const [resetting, setResetting] = useState(false);
  const [planSaveError, setPlanSaveError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setPlanSaveError('');
    try { await onSave(config.plan, draft); onClose(); }
    catch (err: any) {
      console.error('[EditPlanModal] save failed:', err);
      setPlanSaveError(err?.message || 'Save failed. Please try again.');
    }
    finally { setSaving(false); }
  };

  const handleReset = async () => {
    setResetting(true);
    setPlanSaveError('');
    try { await onReset(config.plan); onClose(); }
    catch (err: any) {
      console.error('[EditPlanModal] reset failed:', err);
      setPlanSaveError(err?.message || 'Reset failed. Please try again.');
    }
    finally { setResetting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-start justify-between p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
              <Settings2 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Edit {config.plan} Plan Defaults</h2>
              <p className="text-xs text-slate-400 mt-0.5">These apply to all {config.plan} users without individual overrides</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {LIMIT_FIELDS.map(({ key, label, unit }) => (
            <div key={key}>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={draft[key]}
                  onChange={e => setDraft(d => ({ ...d, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
                <span className="text-xs text-slate-400 font-medium w-10 shrink-0">{unit}</span>
              </div>
            </div>
          ))}
        </div>

        {planSaveError && (
          <div className="mx-6 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
            {planSaveError}
          </div>
        )}
        <div className="flex items-center gap-3 p-6 border-t border-slate-100">
          {config.isCustom && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl hover:bg-rose-100 transition-colors disabled:opacity-60"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {resetting ? 'Resetting…' : 'Reset to Hardcoded'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-60 shadow-sm"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</>
            ) : (
              <><Check className="w-4 h-4" /> Save Defaults</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Limits tab
// ─────────────────────────────────────────────────────────────────────────────
function UsageLimitsTab() {
  const [rows, setRows]           = useState<UsageLimitRow[]>([]);
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState('');
  const [plan, setPlan]           = useState('all');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [editRow, setEditRow]     = useState<UsageLimitRow | null>(null);
  const [savedId, setSavedId]     = useState<string | null>(null);
  const searchTO = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Plan defaults (loaded from DB, falls back to hardcoded)
  const [planConfigs, setPlanConfigs]     = useState<PlanConfigRow[]>([]);
  const [editPlan, setEditPlan]           = useState<PlanConfigRow | null>(null);

  useEffect(() => {
    fetch('/api/admin/plan-config')
      .then(r => r.json())
      .then(json => { if (json.success) setPlanConfigs(json.data); })
      .catch(() => {});
  }, []);

  const handleSavePlanConfig = async (planName: string, values: Omit<PlanConfigRow, 'plan' | 'isCustom'>) => {
    const res  = await fetch('/api/admin/plan-config', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ plan: planName, ...values }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Save failed');
    // Refresh plan configs
    const fresh = await fetch('/api/admin/plan-config').then(r => r.json());
    if (fresh.success) setPlanConfigs(fresh.data);
  };

  const handleResetPlanConfig = async (planName: string) => {
    const res  = await fetch('/api/admin/plan-config', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ plan: planName }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Reset failed');
    const fresh = await fetch('/api/admin/plan-config').then(r => r.json());
    if (fresh.success) setPlanConfigs(fresh.data);
  };

  // Merge live plan configs with hardcoded defaults for display
  const displayConfigs = Object.keys(PLAN_DEFAULTS).map(planName => {
    const live = planConfigs.find(c => c.plan === planName);
    const hc   = PLAN_DEFAULTS[planName];
    return live ?? {
      plan:                      planName,
      maxAuditsPerBusiness:      hc.maxAuditsPerBusiness,
      maxPostsPerMonth:          hc.maxPostsPerMonth,
      maxWhatsAppMessagesPerDay: hc.maxWhatsAppMessagesPerDay,
      reviewRequestCooldownDays: hc.reviewRequestCooldownDays,
      maxAIGenerations:          hc.maxAIGenerations,
      isCustom: false,
    } as PlanConfigRow;
  });

  const fetch_ = useCallback(async (opts: { page?: number; search?: string; plan?: string } = {}) => {
    const p  = opts.page   ?? page;
    const s  = opts.search ?? search;
    const pl = opts.plan   ?? plan;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20', search: s, plan: pl });
      const res  = await fetch(`/api/admin/usage-limits?${params}`);
      const json = await res.json();
      if (json.success) {
        setRows(json.data.rows);
        setTotal(json.data.total);
        setTotalPages(json.data.totalPages);
      } else {
        setError(json.error || 'Failed to load');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [page, search, plan]);

  useEffect(() => { fetch_(); }, []); // eslint-disable-line

  const handleSearch = (val: string) => {
    setSearch(val); setPage(1);
    if (searchTO.current) clearTimeout(searchTO.current);
    searchTO.current = setTimeout(() => fetch_({ search: val, page: 1 }), 350);
  };

  const handleSave = async (userId: string, updates: Partial<LimitOverride>) => {
    const res  = await fetch(`/api/admin/customers/${userId}/usage-limits`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates),
    });
    const json = await res.json();
    console.log('[handleSave] API response:', res.status, json);
    if (!res.ok || !json.success) throw new Error(json.error || `Save failed (${res.status})`);

    // Refresh the row in place
    await fetch_();
    setSavedId(userId);
    setTimeout(() => setSavedId(null), 2000);
  };

  const start = (page - 1) * 20 + 1;
  const end   = Math.min(page * 20, total);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 shadow-sm"
          />
        </div>
        <div className="relative">
          <select
            value={plan}
            onChange={e => { setPlan(e.target.value); setPage(1); fetch_({ plan: e.target.value, page: 1 }); }}
            className="pl-4 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 shadow-sm appearance-none font-medium text-slate-700"
          >
            <option value="all">All Plans</option>
            {Object.keys(PLAN_DEFAULTS).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <button
          onClick={() => fetch_()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Plan defaults reference cards — editable */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {displayConfigs.map(cfg => (
          <div key={cfg.plan} className={cn('bg-white rounded-xl border shadow-sm p-4', cfg.isCustom ? 'border-indigo-200' : 'border-slate-200')}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PlanBadge plan={cfg.plan} />
                {cfg.isCustom ? (
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md">CUSTOM</span>
                ) : (
                  <span className="text-xs text-slate-400 font-medium">defaults</span>
                )}
              </div>
              <button
                onClick={() => setEditPlan(cfg)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              {LIMIT_FIELDS.map(({ key, label, unit }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-slate-500 truncate pr-2">{label}</span>
                  <span className={cn('font-bold shrink-0', cfg.isCustom ? 'text-indigo-700' : 'text-slate-700')}>{cfg[key]} {unit}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-5">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">User / Business</th>
                  <th className="px-5 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Plan</th>
                  {LIMIT_FIELDS.map(f => (
                    <th key={f.key} className="px-4 py-3 text-center text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={LIMIT_FIELDS.length + 3} className="px-6 py-12 text-center text-slate-400 text-sm">
                      No users found
                    </td>
                  </tr>
                )}
                {rows.map(row => {
                  const planDefs = getPlanDefaults(row.plan);
                  const isSaved  = savedId === row.userId;

                  return (
                    <tr key={row.userId} className="hover:bg-slate-50/60 transition-colors">
                      {/* User */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.fullName} plan={row.plan} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">{row.fullName}</div>
                            {row.business
                              ? <div className="text-xs text-slate-400 truncate">{row.business.name}</div>
                              : <div className="text-xs text-slate-300">No business</div>
                            }
                          </div>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-5 py-4">
                        {row.hasOverride ? (
                          <div className="flex flex-col gap-1">
                            <PlanBadge plan={row.plan} />
                            <span className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-md w-fit">
                              + Custom
                            </span>
                          </div>
                        ) : (
                          <PlanBadge plan={row.plan} />
                        )}
                      </td>

                      {/* Limit columns */}
                      {LIMIT_FIELDS.map(({ key }) => {
                        const effective   = row.effective[key];
                        const isOverridden = row.effective.overriddenFields.includes(key);
                        const planDefault  = planDefs[key];

                        return (
                          <td key={key} className="px-4 py-4 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={cn(
                                'text-base font-bold',
                                isOverridden ? 'text-violet-700' : 'text-slate-700'
                              )}>
                                {effective}
                              </span>
                              {isOverridden ? (
                                <span className="text-[10px] text-violet-400 font-medium">
                                  plan: {planDefault}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-300">default</span>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* Edit */}
                      <td className="px-4 py-4">
                        {isSaved ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                            <Check className="w-4 h-4" /> Saved
                          </span>
                        ) : (
                          <button
                            onClick={() => setEditRow(row)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-violet-700 bg-violet-50 border border-violet-100 rounded-xl hover:bg-violet-100 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{start}–{end}</span> of{' '}
            <span className="font-semibold text-slate-900">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setPage(p => p - 1); fetch_({ page: page - 1 }); }}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm font-medium text-slate-500 px-2">{page} / {totalPages}</span>
            <button
              onClick={() => { setPage(p => p + 1); fetch_({ page: page + 1 }); }}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Edit per-user limits modal */}
      {editRow && (
        <EditLimitsModal
          row={editRow}
          onSave={handleSave}
          onClose={() => setEditRow(null)}
        />
      )}

      {/* Edit plan defaults modal */}
      {editPlan && (
        <EditPlanModal
          config={editPlan}
          onSave={handleSavePlanConfig}
          onReset={handleResetPlanConfig}
          onClose={() => setEditPlan(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers tab (original content)
// ─────────────────────────────────────────────────────────────────────────────
function CustomersTab() {
  const router = useRouter();
  const [data, setData]               = useState<CustomersApiResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [plan, setPlan]               = useState('all');
  const [page, setPage]               = useState(1);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (opts: {
    page?: number; search?: string; plan?: string; refresh?: boolean;
  } = {}) => {
    const p  = opts.page   ?? page;
    const s  = opts.search ?? search;
    const pl = opts.plan   ?? plan;
    if (opts.refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20', search: s, plan: pl });
      const res  = await fetch(`/api/admin/customers?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Failed to load customers');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, search, plan]);

  useEffect(() => { fetchData(); }, []); // eslint-disable-line

  const handleSearch = (val: string) => {
    setSearch(val); setPage(1);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchData({ search: val, page: 1 }), 350);
  };

  const handlePlan = (val: string) => {
    setPlan(val); setPage(1);
    fetchData({ plan: val, page: 1 });
  };

  const handlePage = (p: number) => {
    setPage(p);
    fetchData({ page: p });
  };

  const handleImpersonate = async (customerId: string, businessId: string) => {
    setImpersonatingId(customerId);
    try {
      const res  = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });
      const json = await res.json();
      if (json.success) {
        router.push('/dashboard');
      } else {
        alert(json.error || 'Impersonation failed');
      }
    } catch {
      alert('Network error during impersonation');
    } finally {
      setImpersonatingId(null);
    }
  };

  if (loading) return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-medium text-slate-500">Loading customers...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-rose-500 font-medium mb-3">{error}</p>
        <button onClick={() => fetchData()} className="text-sm text-violet-600 hover:underline font-medium">Retry</button>
      </div>
    </div>
  );

  if (!data) return null;

  const { users, total, totalPages, stats } = data;
  const start = (page - 1) * 20 + 1;
  const end   = Math.min(page * 20, total);

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Users',      value: stats.totalUsers,      color: 'bg-slate-600' },
          { label: 'New This Week',    value: stats.newThisWeek,     color: 'bg-cyan-600' },
          { label: 'Pro Users',        value: stats.proUsers,        color: 'bg-indigo-600' },
          { label: 'Enterprise Users', value: stats.enterpriseUsers, color: 'bg-violet-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', s.color)}>
              <Users className="w-4 h-4 text-white" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{s.value.toLocaleString()}</div>
            <div className="text-sm text-slate-500 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 shadow-sm"
          />
        </div>
        <div className="relative">
          <select
            value={plan}
            onChange={e => handlePlan(e.target.value)}
            className="pl-4 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 shadow-sm appearance-none font-medium text-slate-700"
          >
            <option value="all">All Plans</option>
            <option value="Free">Free</option>
            <option value="Pro">Pro</option>
            <option value="Enterprise">Enterprise</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <button
          onClick={() => fetchData({ refresh: true })}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Business</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Plan</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Joined</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">
                  No customers found
                </td>
              </tr>
            )}
            {users.map(customer => {
              const isExpanded = expandedId === customer._id;
              return (
                <React.Fragment key={customer._id}>
                  <tr
                    className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : customer._id)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={customer.fullName} plan={customer.subscriptionPlan} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{customer.fullName}</div>
                          <div className="text-xs text-slate-400 truncate">{customer.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {customer.business ? (
                        <div>
                          <div className="text-sm font-semibold text-slate-900 truncate max-w-[180px]">{customer.business.name}</div>
                          <div className="text-xs text-slate-400">{customer.business.category}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">No business</span>
                      )}
                    </td>
                    <td className="px-6 py-4"><PlanBadge plan={customer.subscriptionPlan} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-sm text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(customer.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border',
                        customer.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-500 border-slate-200'
                      )}>
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />
                        : <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />}
                    </td>
                  </tr>
                  {isExpanded && (
                    <ExpandedRow
                      key={`${customer._id}-expand`}
                      customer={customer}
                      onImpersonate={(bizId) => handleImpersonate(customer._id, bizId)}
                      impersonating={impersonatingId === customer._id}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 mb-10">
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{start}–{end}</span> of{' '}
            <span className="font-semibold text-slate-900">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm font-medium text-slate-500 px-2">{page} / {totalPages}</span>
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <RecentDemoRequests />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent Demo Requests (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function RecentDemoRequests() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/admin/demo-bookings?limit=3')
      .then(r => r.json())
      .then(json => { if (json.success && json.bookings) setBookings(json.bookings.slice(0, 3)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">GMBBoost Demo Requests</h2>
        <Link href="/admin/demo-bookings" className="text-sm font-semibold text-violet-600 hover:underline flex items-center gap-1">
          View All <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-slate-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-400">No demo requests yet</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {bookings.map((b: any) => (
            <div key={b._id} className="px-6 py-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{b.name}</div>
                <div className="text-xs text-slate-400 truncate">{b.email} · {b.company}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-semibold text-slate-700">
                  {new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
                <span className={cn('text-xs font-bold px-2 py-0.5 rounded-md border',
                  b.status === 'Pending'   ? 'bg-amber-50 text-amber-700 border-amber-100' :
                  b.status === 'Confirmed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                  'bg-slate-50 text-slate-600 border-slate-200'
                )}>
                  {b.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root page — tab shell
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'customers',    label: 'Customers',    icon: Users },
  { key: 'usage-limits', label: 'Usage Limits', icon: Gauge },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function CustomersPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('customers');

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-600/20">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 font-medium">Users, subscriptions, and per-company usage limits</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-7 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all',
                activeTab === tab.key
                  ? 'bg-white text-violet-700 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.key === 'usage-limits' && (
                <span className="ml-1 text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-md">NEW</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'customers'    && <CustomersTab />}
      {activeTab === 'usage-limits' && <UsageLimitsTab />}
    </div>
  );
}
