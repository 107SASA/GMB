'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft, UserCheck, Phone, MessageCircle, RefreshCw, Lightbulb, PhoneCall, Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { telHref, waHref } from '@/lib/phoneLinks';
import { ActivityBadge, agoLabel, CALL_OUTCOME_LABELS, type ActivityStatus } from '@/components/admin/customers/ActivityBadge';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror GET /api/admin/customers/[userId]/activity)
// ─────────────────────────────────────────────────────────────────────────────
interface Summary {
  status: ActivityStatus;
  reasons: string[];
  lastActivityAt: string | null;
  daysQuiet: number | null;
  lastSeenAt: string | null;
  lastSeenClient: string | null;
  lastLoginAt: string | null;
  reviewRequests30d: number;
  lastReviewRequestAt: string | null;
  campaigns30d: number;
  ownerReplies30d: number;
  profileEdits30d: number;
  postsPending: number;
  oldestPendingDays: number | null;
  postsPublished30d: number;
  newReviews30d: number;
  googleConnected: boolean;
  adminActions30d: number;
}
interface TimelineItem { at: string; kind: 'owner' | 'result' | 'admin' | 'call' | 'alert'; icon: string; title: string; detail?: string }
interface CallRow { _id: string; at: string; outcome: string; note?: string; followUpAt?: string | null; adminName?: string }
interface Data {
  customer: { _id: string; fullName: string; email: string; phone?: string; createdAt: string; onboardingCompleted: boolean };
  business: {
    _id: string; name: string; category?: string; address?: string; googleConnected: boolean;
    subscriptionStatus: string | null; workspacePlan: string | null; trialEndsAt: string | null;
  } | null;
  otherBusinesses: { _id: string; name: string; workspacePlan: string | null }[];
  subscription: { planType: string; billingStatus: string; trialActive: boolean; currentPeriodEnd: string | null } | null;
  summary: Summary;
  talkingPoints: string[];
  rules: { slippingDays: number; inactiveDays: number; pendingPostDays: number; noRequestsGraceDays: number };
  timeline: TimelineItem[];
  calls: CallRow[];
}

type Tab = 'overview' | 'activity' | 'billing';

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function CustomerDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [entering, setEntering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/customers/${userId}/activity`);
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error || 'Failed to load customer');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const loginAs = async () => {
    if (!data?.business) return;
    setEntering(true);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: data.business._id }),
      });
      const json = await res.json();
      if (json.success) window.location.href = '/dashboard';
      else { toast.error(json.error || 'Could not open dashboard'); setEntering(false); }
    } catch {
      toast.error('Network error');
      setEntering(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-error font-medium">{error || 'Customer not found'}</p>
        <Link href="/admin/customers" className="text-sm text-primary hover:underline font-medium">Back to customers</Link>
      </div>
    );
  }

  const { customer, business, summary } = data;
  const tel = telHref(customer.phone);
  const wa = waHref(customer.phone);

  return (
    <div className="max-w-6xl">
      <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant hover:text-primary mb-4">
        <ArrowLeft className="w-4 h-4" /> Customers
      </Link>

      {/* Header */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5 mb-6 flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="font-heading text-2xl font-bold text-on-surface">{business?.name || customer.fullName}</h1>
            <ActivityBadge status={summary.status} />
            {business?.workspacePlan && (
              <span className="px-2 py-0.5 text-xs font-bold rounded-md border bg-primary-fixed text-primary border-primary-fixed-dim">{business.workspacePlan}</span>
            )}
          </div>
          <p className="text-sm text-on-surface-variant">
            {customer.fullName} · {customer.email}{customer.phone ? ` · ${customer.phone}` : ''}
          </p>
          <p className="text-xs text-outline mt-1">
            Joined {fmtDate(customer.createdAt)}
            {business?.category ? ` · ${business.category}` : ''}
            {business?.address ? ` · ${business.address}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tel && (
            <a href={tel} className="flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-xl text-sm font-bold text-on-surface hover:bg-surface">
              <Phone className="w-4 h-4" /> Call
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-xl text-sm font-bold text-on-surface hover:bg-surface">
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          )}
          {business && (
            <button
              onClick={loginAs}
              disabled={entering}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary-container disabled:opacity-60"
            >
              <UserCheck className="w-4 h-4" /> {entering ? 'Opening…' : 'Login as customer'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-container rounded-xl p-1 mb-6 w-fit">
        {([
          ['overview', 'Overview'],
          ['activity', `Activity (${data.timeline.length})`],
          ['billing', 'Billing'],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-bold transition-all',
              tab === k ? 'bg-surface-container-lowest text-primary shadow-sm border border-outline-variant' : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {label}
          </button>
        ))}
        <button onClick={load} title="Refresh" className="px-3 text-on-surface-variant hover:text-primary">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {tab === 'overview' && <OverviewTab data={data} userId={userId} onCallSaved={load} />}
      {tab === 'activity' && <ActivityTab items={data.timeline} />}
      {tab === 'billing' && <BillingTab data={data} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({ data, userId, onCallSaved }: { data: Data; userId: string; onCallSaved: () => void }) {
  const s = data.summary;
  const tiles: { label: string; value: string; hint?: string; warn?: boolean }[] = [
    {
      label: 'Last seen',
      value: agoLabel(s.lastActivityAt),
      hint: s.lastSeenAt ? `Used the ${s.lastSeenClient === 'mobile' ? 'app' : 'dashboard'} ${agoLabel(s.lastSeenAt)}` : s.lastLoginAt ? `Last login ${agoLabel(s.lastLoginAt)}` : undefined,
      warn: s.daysQuiet === null || s.daysQuiet >= data.rules.slippingDays,
    },
    {
      label: 'Review requests (30d)',
      value: String(s.reviewRequests30d),
      hint: s.lastReviewRequestAt ? `Last ${agoLabel(s.lastReviewRequestAt)}` : 'Never sent',
      warn: s.reviewRequests30d === 0,
    },
    { label: 'Replies approved (30d)', value: String(s.ownerReplies30d) },
    {
      label: 'Posts waiting approval',
      value: String(s.postsPending),
      hint: s.oldestPendingDays !== null ? `Oldest ${s.oldestPendingDays} days` : undefined,
      warn: s.oldestPendingDays !== null && s.oldestPendingDays > data.rules.pendingPostDays,
    },
    { label: 'Google connected', value: s.googleConnected ? 'Yes' : 'No', warn: !s.googleConnected },
    { label: 'New reviews (30d)', value: String(s.newReviews30d), hint: `${s.postsPublished30d} posts published` },
  ];

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-6 min-w-0">
        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className={cn('rounded-xl border p-4 bg-surface-container-lowest', t.warn ? 'border-red-300 dark:border-red-900' : 'border-outline-variant')}>
              <div className="text-xs font-bold uppercase tracking-wide text-outline mb-1">{t.label}</div>
              <div className={cn('text-xl font-bold', t.warn ? 'text-red-700 dark:text-red-300' : 'text-on-surface')}>{t.value}</div>
              {t.hint && <div className="text-xs text-on-surface-variant mt-0.5">{t.hint}</div>}
            </div>
          ))}
        </div>

        {/* Why this status */}
        {s.reasons.length > 0 && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
            <div className="flex items-center gap-2 mb-2">
              <ActivityBadge status={s.status} />
              <span className="text-sm font-bold text-on-surface">Why</span>
            </div>
            <ul className="text-sm text-on-surface-variant list-disc pl-5 space-y-1">
              {s.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        )}

        {/* Talking points */}
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-on-surface">Talking points for the call</h2>
          </div>
          <ul className="space-y-2">
            {data.talkingPoints.map((p) => (
              <li key={p} className="text-sm text-on-surface flex gap-2">
                <span className="text-primary font-bold">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        {s.adminActions30d > 0 && (
          <p className="text-xs text-outline">
            {s.adminActions30d} change{s.adminActions30d === 1 ? ' was' : 's were'} made by an admin in this account in the last 30 days. Those don&apos;t count as the customer&apos;s activity.
          </p>
        )}
      </div>

      {/* Call log */}
      <CallLog userId={userId} calls={data.calls} onSaved={onCallSaved} />
    </div>
  );
}

function CallLog({ userId, calls, onSaved }: { userId: string; calls: CallRow[]; onSaved: () => void }) {
  const [outcome, setOutcome] = useState('reached');
  const [note, setNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${userId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, note, followUpAt: followUpAt || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('Call logged');
        setNote('');
        setFollowUpAt('');
        onSaved();
      } else {
        toast.error(json.error || 'Could not save');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4 h-fit">
      <div className="flex items-center gap-2 mb-3">
        <PhoneCall className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold text-on-surface">Call log</h2>
      </div>

      <div className="space-y-2 mb-4">
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-surface border border-outline-variant rounded-lg text-on-surface"
        >
          {Object.entries(CALL_OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What did they say? e.g. Will send review requests this week"
          className="w-full px-3 py-2 text-sm bg-surface border border-outline-variant rounded-lg text-on-surface resize-y"
        />
        <label className="block text-xs font-semibold text-on-surface-variant">
          Follow up on
          <input
            type="date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm bg-surface border border-outline-variant rounded-lg text-on-surface"
          />
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="w-full px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold hover:bg-primary-container disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Log call'}
        </button>
      </div>

      {calls.length === 0 ? (
        <p className="text-xs text-outline">No calls logged yet.</p>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {calls.map((c) => (
            <li key={c._id} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-on-surface">{CALL_OUTCOME_LABELS[c.outcome] ?? c.outcome}</span>
                <span className="text-xs text-outline">{fmtDateTime(c.at)}</span>
              </div>
              {c.note && <p className="text-sm text-on-surface-variant mt-0.5">{c.note}</p>}
              <p className="text-xs text-outline mt-0.5">
                {c.adminName || 'Admin'}{c.followUpAt ? ` · follow up ${fmtDate(c.followUpAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity timeline
// ─────────────────────────────────────────────────────────────────────────────
const KIND_STYLE: Record<TimelineItem['kind'], { label: string; dot: string }> = {
  owner:  { label: 'Customer', dot: 'bg-emerald-500' },
  result: { label: 'Result',   dot: 'bg-sky-500' },
  admin:  { label: 'Admin',    dot: 'bg-violet-500' },
  call:   { label: 'Call',     dot: 'bg-amber-500' },
  alert:  { label: 'Waiting',  dot: 'bg-red-500' },
};

function ActivityTab({ items }: { items: TimelineItem[] }) {
  const [filter, setFilter] = useState<'all' | TimelineItem['kind']>('all');
  const shown = filter === 'all' ? items : items.filter((i) => i.kind === filter);

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="flex flex-wrap gap-2 p-4 border-b border-outline-variant">
        {(['all', 'owner', 'result', 'admin', 'call', 'alert'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-bold border',
              filter === k ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface'
            )}
          >
            {k === 'all' ? 'All' : KIND_STYLE[k].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-outline self-center">Last 60 days</span>
      </div>
      {shown.length === 0 ? (
        <p className="p-8 text-center text-sm text-outline">Nothing in the last 60 days.</p>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {shown.map((i, idx) => (
            <li key={`${i.at}-${idx}`} className="flex gap-3 px-4 py-3">
              <div className="relative shrink-0 mt-0.5">
                <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant">
                  <MaterialIcon name={i.icon} size={18} />
                </div>
                <span className={cn('absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface-container-lowest', KIND_STYLE[i.kind].dot)} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">{i.title}</p>
                {i.detail && <p className="text-xs text-on-surface-variant truncate">{i.detail}</p>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-outline whitespace-nowrap">{fmtDateTime(i.at)}</div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-outline">{KIND_STYLE[i.kind].label}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing (read-only basics; changes live in Billing Controls)
// ─────────────────────────────────────────────────────────────────────────────
function BillingTab({ data }: { data: Data }) {
  const { business, subscription, otherBusinesses } = data;
  const rows: [string, string][] = [
    ['Workspace plan', business?.workspacePlan || 'No plan'],
    ['Workspace status', business?.subscriptionStatus || '—'],
    ['Trial ends', fmtDate(business?.trialEndsAt)],
    ['Subscription', subscription ? `${subscription.planType} · ${subscription.billingStatus}` : '—'],
    ['Current period ends', fmtDate(subscription?.currentPeriodEnd)],
  ];
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
        <dl className="divide-y divide-outline-variant">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5 text-sm">
              <dt className="text-on-surface-variant">{k}</dt>
              <dd className="font-semibold text-on-surface text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <Link href="/admin/billing" className="inline-block mt-3 text-sm font-semibold text-primary hover:underline">
          Open Billing Controls →
        </Link>
      </div>
      {otherBusinesses.length > 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-on-surface">Other workspaces</h2>
          </div>
          <ul className="divide-y divide-outline-variant">
            {otherBusinesses.map((b) => (
              <li key={b._id} className="flex justify-between py-2 text-sm">
                <span className="text-on-surface">{b.name}</span>
                <span className="text-outline">{b.workspacePlan || 'No plan'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
