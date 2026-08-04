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
    Free:       'bg-surface text-on-surface-variant border-outline-variant',
    Pro:        'bg-primary-fixed text-primary border-primary-fixed-dim',
    Enterprise: 'bg-primary-fixed text-primary border-primary-fixed-dim',
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
    plan === 'Enterprise' ? 'bg-primary' :
    plan === 'Pro'        ? 'bg-primary' : 'bg-outline';
  return (
    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0', color)}>
      {initials || '?'}
    </div>
  );
}

function BillingBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active:   'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed',
    Trialing: 'bg-primary-fixed text-primary border-primary-fixed-dim',
    PastDue:  'bg-primary-fixed text-primary border-primary-fixed-dim',
    Canceled: 'bg-error-container text-on-error-container border-error-container',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[status] ?? 'bg-surface text-on-surface-variant border-outline-variant')}>
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
    <tr className="bg-primary-fixed/40">
      <td colSpan={7} className="px-6 py-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs font-bold text-outline uppercase mb-1">Email</p>
            <p className="text-on-surface font-medium">{customer.email}</p>
          </div>
          {customer.phone && (
            <div>
              <p className="text-xs font-bold text-outline uppercase mb-1">Phone</p>
              <p className="text-on-surface font-medium">{customer.phone}</p>
            </div>
          )}
          {customer.business && (
            <>
              <div>
                <p className="text-xs font-bold text-outline uppercase mb-1">Business</p>
                <p className="text-on-surface font-medium">{customer.business.name}</p>
                <p className="text-on-surface-variant text-xs">{customer.business.category}</p>
              </div>
              {(customer.business.address || customer.business.city) && (
                <div>
                  <p className="text-xs font-bold text-outline uppercase mb-1">Address</p>
                  <p className="text-on-surface font-medium">
                    {[customer.business.address, customer.business.city].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
            </>
          )}
          {customer.subscription && (
            <div>
              <p className="text-xs font-bold text-outline uppercase mb-1">Billing</p>
              <BillingBadge status={customer.subscription.billingStatus} />
              {customer.subscription.trialActive && (
                <span className="ml-2 text-xs text-primary font-semibold">Trial active</span>
              )}
            </div>
          )}
          <div>
            <p className="text-xs font-bold text-outline uppercase mb-1">Onboarding</p>
            <span className={cn('text-xs font-bold', customer.onboardingCompleted ? 'text-secondary' : 'text-primary-fixed-dim')}>
              {customer.onboardingCompleted ? 'Completed' : 'Incomplete'}
            </span>
          </div>
          {customer.business?._id && (
            <div className="ml-auto flex items-end">
              <button
                onClick={() => onImpersonate(customer.business!._id)}
                disabled={impersonating}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary text-xs font-bold rounded-xl hover:bg-primary-container transition-all disabled:opacity-60 shadow-sm"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-container-lowest rounded-xl card-shadow w-full max-w-lg">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-fixed rounded-xl flex items-center justify-center">
              <SlidersHorizontal className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-on-surface">{row.fullName}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <PlanBadge plan={row.plan} />
                {row.business && (
                  <span className="text-xs text-outline">{row.business.name}</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface-variant transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">

          <div className="flex items-start gap-2 px-3 py-2.5 bg-primary-fixed border border-primary-fixed-dim rounded-xl text-xs text-primary">
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
                  <label className="text-sm font-semibold text-on-surface">{label}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-outline">
                      Plan default: <strong className="text-on-surface-variant">{planDefault} {unit}</strong>
                    </span>
                    {isOverridden && (
                      <button
                        onClick={() => setDraft(d => ({ ...d, [key]: null }))}
                        className="text-xs text-error hover:text-on-error-container font-semibold flex items-center gap-0.5"
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
                        ? 'border-primary-fixed-dim bg-primary-fixed/60 focus:ring-primary text-primary font-semibold'
                        : 'border-outline-variant bg-surface-container-lowest focus:ring-primary focus:border-primary text-on-surface-variant'
                    )}
                  />
                  {isOverridden && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary bg-primary-fixed px-1.5 py-0.5 rounded-md">
                      CUSTOM
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Admin notes */}
          <div>
            <label className="block text-sm font-semibold text-on-surface mb-1.5">Admin Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason for override, customer request, etc."
              className="w-full px-4 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        {saveError && (
          <div className="mx-6 mb-0 mt-0 px-3 py-2.5 bg-error-container border border-error-container rounded-xl text-xs text-on-error-container font-medium">
            {saveError}
          </div>
        )}
        <div className="flex items-center gap-3 p-6 border-t border-outline-variant">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-on-surface-variant bg-surface-container rounded-xl hover:bg-surface-container-high transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset All to Defaults
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-bold rounded-xl hover:bg-primary-container transition-colors disabled:opacity-60 shadow-sm"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-container-lowest rounded-xl card-shadow w-full max-w-md">
        <div className="flex items-start justify-between p-6 border-b border-outline-variant">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-fixed rounded-xl flex items-center justify-center">
              <Settings2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-on-surface">Edit {config.plan} Plan Defaults</h2>
              <p className="text-xs text-outline mt-0.5">These apply to all {config.plan} users without individual overrides</p>
            </div>
          </div>
          <button onClick={onClose} className="text-outline hover:text-on-surface-variant transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {LIMIT_FIELDS.map(({ key, label, unit }) => (
            <div key={key}>
              <label className="block text-sm font-semibold text-on-surface mb-1.5">{label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={draft[key]}
                  onChange={e => setDraft(d => ({ ...d, [key]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="flex-1 px-4 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary-fixed-dim"
                />
                <span className="text-xs text-outline font-medium w-10 shrink-0">{unit}</span>
              </div>
            </div>
          ))}
        </div>

        {planSaveError && (
          <div className="mx-6 px-3 py-2.5 bg-error-container border border-error-container rounded-xl text-xs text-on-error-container font-medium">
            {planSaveError}
          </div>
        )}
        <div className="flex items-center gap-3 p-6 border-t border-outline-variant">
          {config.isCustom && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-on-error-container bg-error-container border border-error-container rounded-xl hover:bg-error-container transition-colors disabled:opacity-60"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {resetting ? 'Resetting…' : 'Reset to Hardcoded'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-bold rounded-xl hover:bg-primary-container transition-colors disabled:opacity-60 shadow-sm"
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface-container-lowest border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary shadow-sm"
          />
        </div>
        <div className="relative">
          <select
            value={plan}
            onChange={e => { setPlan(e.target.value); setPage(1); fetch_({ plan: e.target.value, page: 1 }); }}
            className="pl-4 pr-9 py-2.5 text-sm bg-surface-container-lowest border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary shadow-sm appearance-none font-medium text-on-surface"
          >
            <option value="all">All Plans</option>
            {Object.keys(PLAN_DEFAULTS).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
        </div>
        <button
          onClick={() => fetch_()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Plan defaults reference cards — editable */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {displayConfigs.map(cfg => (
          <div key={cfg.plan} className={cn('bg-surface-container-lowest rounded-xl border shadow-sm p-4', cfg.isCustom ? 'border-primary-fixed-dim' : 'border-outline-variant')}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PlanBadge plan={cfg.plan} />
                {cfg.isCustom ? (
                  <span className="text-[10px] font-bold text-primary bg-primary-fixed border border-primary-fixed-dim px-1.5 py-0.5 rounded-md">CUSTOM</span>
                ) : (
                  <span className="text-xs text-outline font-medium">defaults</span>
                )}
              </div>
              <button
                onClick={() => setEditPlan(cfg)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-primary bg-primary-fixed border border-primary-fixed-dim rounded-lg hover:bg-primary-fixed transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              {LIMIT_FIELDS.map(({ key, label, unit }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-on-surface-variant truncate pr-2">{label}</span>
                  <span className={cn('font-bold shrink-0', cfg.isCustom ? 'text-primary' : 'text-on-surface')}>{cfg[key]} {unit}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-error-container border border-error-container rounded-xl text-on-error-container text-sm">{error}</div>
      )}

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden mb-5">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="px-5 py-3 text-left text-label-sm text-on-surface-variant">User / Business</th>
                  <th className="px-5 py-3 text-left text-label-sm text-on-surface-variant">Plan</th>
                  {LIMIT_FIELDS.map(f => (
                    <th key={f.key} className="px-4 py-3 text-center text-label-sm text-on-surface-variant whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={LIMIT_FIELDS.length + 3} className="px-6 py-12 text-center text-outline text-sm">
                      No users found
                    </td>
                  </tr>
                )}
                {rows.map(row => {
                  const planDefs = getPlanDefaults(row.plan);
                  const isSaved  = savedId === row.userId;

                  return (
                    <tr key={row.userId} className="hover:bg-surface/60 transition-colors">
                      {/* User */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={row.fullName} plan={row.plan} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-on-surface truncate">{row.fullName}</div>
                            {row.business
                              ? <div className="text-xs text-outline truncate">{row.business.name}</div>
                              : <div className="text-xs text-outline">No business</div>
                            }
                          </div>
                        </div>
                      </td>

                      {/* Plan */}
                      <td className="px-5 py-4">
                        {row.hasOverride ? (
                          <div className="flex flex-col gap-1">
                            <PlanBadge plan={row.plan} />
                            <span className="text-[10px] font-bold text-primary bg-primary-fixed border border-primary-fixed-dim px-1.5 py-0.5 rounded-md w-fit">
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
                                isOverridden ? 'text-primary' : 'text-on-surface'
                              )}>
                                {effective}
                              </span>
                              {isOverridden ? (
                                <span className="text-[10px] text-primary-fixed-dim font-medium">
                                  plan: {planDefault}
                                </span>
                              ) : (
                                <span className="text-[10px] text-outline">default</span>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* Edit */}
                      <td className="px-4 py-4">
                        {isSaved ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-secondary">
                            <Check className="w-4 h-4" /> Saved
                          </span>
                        ) : (
                          <button
                            onClick={() => setEditRow(row)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary bg-primary-fixed border border-primary-fixed-dim rounded-xl hover:bg-primary-fixed transition-colors"
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
          <p className="text-sm text-on-surface-variant">
            Showing <span className="font-semibold text-on-surface">{start}–{end}</span> of{' '}
            <span className="font-semibold text-on-surface">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setPage(p => p - 1); fetch_({ page: page - 1 }); }}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-xl hover:bg-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm font-medium text-on-surface-variant px-2">{page} / {totalPages}</span>
            <button
              onClick={() => { setPage(p => p + 1); fetch_({ page: page + 1 }); }}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-xl hover:bg-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
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
        <div className="w-10 h-10 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-medium text-on-surface-variant">Loading customers...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-error font-medium mb-3">{error}</p>
        <button onClick={() => fetchData()} className="text-sm text-primary hover:underline font-medium">Retry</button>
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
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Users',   value: stats.totalUsers,                            color: 'bg-on-surface-variant' },
          { label: 'New This Week', value: stats.newThisWeek,                           color: 'bg-primary' },
          { label: 'Paid Users',    value: stats.proUsers + stats.enterpriseUsers,      color: 'bg-primary' },
        ].map(s => (
          <div key={s.label} className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', s.color)}>
              <Users className="w-4 h-4 text-white" />
            </div>
            <div className="text-2xl font-bold text-on-surface">{s.value.toLocaleString()}</div>
            <div className="text-sm text-on-surface-variant font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-surface-container-lowest border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary shadow-sm"
          />
        </div>
        <div className="relative">
          <select
            value={plan}
            onChange={e => handlePlan(e.target.value)}
            className="pl-4 pr-9 py-2.5 text-sm bg-surface-container-lowest border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary shadow-sm appearance-none font-medium text-on-surface"
          >
            <option value="all">All Plans</option>
            <option value="Free">Free</option>
            <option value="Pro">Pro</option>
            {/* Legacy tier — no longer sold (planDefaults.ts resolves it to Pro
                limits), but real customers can still be on it, so it needs to
                stay filterable rather than becoming invisible to search. */}
            <option value="Enterprise">Enterprise (legacy)</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline pointer-events-none" />
        </div>
        <button
          onClick={() => fetchData({ refresh: true })}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant">
              <th className="px-6 py-3 text-left text-label-sm text-on-surface-variant">User</th>
              <th className="px-6 py-3 text-left text-label-sm text-on-surface-variant">Business</th>
              <th className="px-6 py-3 text-left text-label-sm text-on-surface-variant">Plan</th>
              <th className="px-6 py-3 text-left text-label-sm text-on-surface-variant">Joined</th>
              <th className="px-6 py-3 text-left text-label-sm text-on-surface-variant">Status</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-outline text-sm">
                  No customers found
                </td>
              </tr>
            )}
            {users.map(customer => {
              const isExpanded = expandedId === customer._id;
              return (
                <React.Fragment key={customer._id}>
                  <tr
                    className="hover:bg-surface/60 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : customer._id)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={customer.fullName} plan={customer.subscriptionPlan} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-on-surface truncate">{customer.fullName}</div>
                          <div className="text-xs text-outline truncate">{customer.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {customer.business ? (
                        <div>
                          <div className="text-sm font-semibold text-on-surface truncate max-w-[180px]">{customer.business.name}</div>
                          <div className="text-xs text-outline">{customer.business.category}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-outline font-medium">No business</span>
                      )}
                    </td>
                    <td className="px-6 py-4"><PlanBadge plan={customer.subscriptionPlan} /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-sm text-on-surface-variant">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(customer.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border',
                        customer.isActive ? 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed' : 'bg-surface text-on-surface-variant border-outline-variant'
                      )}>
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-outline ml-auto" />
                        : <ChevronRight className="w-4 h-4 text-outline ml-auto" />}
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
          <p className="text-sm text-on-surface-variant">
            Showing <span className="font-semibold text-on-surface">{start}–{end}</span> of{' '}
            <span className="font-semibold text-on-surface">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-xl hover:bg-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm font-medium text-on-surface-variant px-2">{page} / {totalPages}</span>
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-on-surface-variant bg-surface-container-lowest border border-outline-variant rounded-xl hover:bg-surface transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
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
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
        <h2 className="text-base font-bold text-on-surface">GrowwMatics AI Demo Requests</h2>
        <Link href="/admin/demo-bookings" className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">
          View All <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-outline">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-outline">No demo requests yet</div>
      ) : (
        <div className="divide-y divide-outline-variant">
          {bookings.map((b: any) => (
            <div key={b._id} className="px-6 py-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-xl bg-primary-fixed flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 text-primary-fixed-dim" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-on-surface truncate">{b.name}</div>
                <div className="text-xs text-outline truncate">{b.email} · {b.company}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-semibold text-on-surface">
                  {new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
                <span className={cn('text-xs font-bold px-2 py-0.5 rounded-md border',
                  b.status === 'Pending'   ? 'bg-primary-fixed text-primary border-primary-fixed-dim' :
                  b.status === 'Confirmed' ? 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed' :
                  'bg-surface text-on-surface-variant border-outline-variant'
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
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center card-shadow">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Customers</h1>
          <p className="text-sm text-on-surface-variant font-medium">Users, subscriptions, and per-company usage limits</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-surface-container rounded-xl p-1 mb-7 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all',
                activeTab === tab.key
                  ? 'bg-surface-container-lowest text-primary shadow-sm border border-outline-variant'
                  : 'text-on-surface-variant hover:text-on-surface'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.key === 'usage-limits' && (
                <span className="ml-1 text-[10px] font-bold bg-primary-fixed text-primary px-1.5 py-0.5 rounded-md">NEW</span>
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
