'use client';

import { useState } from 'react';
import { BellRing, Gift, ShieldAlert, Info } from 'lucide-react';
import { MODULE_LABELS } from '@/components/billing/useRazorpayCheckout';
import { ConfirmDialog } from './ConfirmDialog';

export interface PolicyResponse {
  policy: { offerEnabled: boolean; trialMonths: number; eligibleCycle: string; version: number };
  failure: {
    firstCharge: { mode: 'immediate' | 'grace'; graceDays: number };
    renewal: { mode: 'immediate' | 'grace'; graceDays: number };
    restrictedModules: string[];
    restoreAccessOnRecovery: boolean;
  };
  reminders: {
    enabled: boolean;
    steps: Array<{ offsetDays: number }>;
    maxReminders: number;
    sendingHours: { start: number; end: number };
    timezone: string;
    retry: { maxAttempts: number; backoffMinutes: number };
    template: { contentSid: string; approved: boolean };
    finalTemplate: { contentSid: string; approved: boolean } | null;
  };
  alwaysAccessible: string[];
  restrictableModules: string[];
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
  stats: {
    activeTrials: number;
    trialsUsed: number;
    claimsNeedingReview: number;
    paymentFailuresInGrace: number;
    paymentFailuresRestricted: number;
    recoveriesOnHold: number;
  };
}

type Save = (section: 'trial' | 'failure' | 'reminders', value: unknown) => Promise<string | null>;

const card = 'rounded-xl border border-outline-variant bg-surface-container-lowest p-5 card-shadow';
const input = 'w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
const label = 'mb-1 block text-xs font-semibold text-on-surface-variant';

function Stat({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-outline">{name}</div>
      <div className="text-lg font-bold text-on-surface">{value}</div>
    </div>
  );
}

function Header({ icon: Icon, title, subtitle, badge }: { icon: React.ElementType; title: string; subtitle: string; badge: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-fixed">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-bold text-on-surface">{title}</h2>
          <p className="text-xs text-outline">{subtitle}</p>
        </div>
      </div>
      {badge}
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${on ? 'border-secondary-fixed bg-secondary-container/40 text-on-secondary-container' : 'border-outline-variant bg-surface text-on-surface-variant'}`}>
      {on ? 'ON' : 'OFF'}
    </span>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-3 text-xs font-medium text-error">{error}</p> : null;
}

// ── A. Trial offer ──────────────────────────────────────────────────────────
export function TrialOfferCard({ data, yearlyPriceInr, save }: { data: PolicyResponse; yearlyPriceInr: number | null; save: Save }) {
  const [months, setMonths] = useState(data.policy.trialMonths);
  const [confirm, setConfirm] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = data.policy.offerEnabled;

  const apply = async (offerEnabled: boolean) => {
    setBusy(true);
    setError(await save('trial', { offerEnabled, trialMonths: months }));
    setBusy(false);
    setConfirm(null);
  };

  return (
    <section className={card} aria-labelledby="trial-offer">
      <Header icon={Gift} title="Free trial offer" subtitle="Yearly plan only · one trial per verified phone, one workspace" badge={<OnOff on={on} />} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat name="Trial length" value={`${data.policy.trialMonths} mo`} />
        <Stat name="Eligible plan" value={yearlyPriceInr != null ? `Yearly ₹${yearlyPriceInr.toLocaleString('en-IN')}` : 'Yearly'} />
        <Stat name="Active trials" value={data.stats.activeTrials} />
        <Stat name="Trials started" value={data.stats.trialsUsed} />
      </div>
      <p className="mb-4 text-xs text-outline">
        Policy v{data.version}
        {data.updatedBy ? ` · last changed by ${data.updatedBy}` : ''}
        {data.updatedAt ? ` on ${new Date(data.updatedAt).toLocaleString('en-IN')}` : ''}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36">
          <label className={label} htmlFor="trial-months">Trial length (months)</label>
          <input id="trial-months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(Number(e.target.value))} className={input} />
        </div>
        <button type="button" onClick={() => setConfirm(!on)} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${on ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-container'}`}>
          {on ? 'Turn offer OFF' : 'Turn offer ON'}
        </button>
        {months !== data.policy.trialMonths && (
          <button type="button" onClick={() => apply(on)} disabled={busy} className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface">
            Save length
          </button>
        )}
      </div>
      <ErrorLine error={error} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? 'Turn the free trial ON?' : 'Turn the free trial OFF?'}
        confirmLabel={confirm ? 'Turn ON' : 'Turn OFF'}
        danger={!confirm}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => apply(!!confirm)}
      >
        {confirm ? (
          <>
            <p>Eligible customers who start the yearly plan from now on get a {months}-month free trial, then pay automatically.</p>
            <p className="font-semibold text-error">Only do this after the Razorpay test-mode checklist has passed.</p>
          </>
        ) : (
          <p>This affects <strong>new checkouts only</strong>. Customers already in a trial keep it until their end date and are charged as scheduled; paid customers are not affected.</p>
        )}
      </ConfirmDialog>
    </section>
  );
}

// ── B. Failed payments / grace ──────────────────────────────────────────────
function RuleEditor({ id, title, value, onChange }: { id: string; title: string; value: { mode: 'immediate' | 'grace'; graceDays: number }; onChange: (v: { mode: 'immediate' | 'grace'; graceDays: number }) => void }) {
  return (
    <fieldset className="rounded-lg border border-outline-variant p-3">
      <legend className="px-1 text-xs font-bold text-on-surface">{title}</legend>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={id} checked={value.mode === 'immediate'} onChange={() => onChange({ mode: 'immediate', graceDays: 0 })} /> Restrict immediately
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={id} checked={value.mode === 'grace'} onChange={() => onChange({ mode: 'grace', graceDays: value.graceDays || 3 })} /> Grace period
        </label>
        {value.mode === 'grace' && (
          <label className="flex items-center gap-1.5">
            <input type="number" min={1} max={30} value={value.graceDays} onChange={(e) => onChange({ mode: 'grace', graceDays: Number(e.target.value) })} className="w-20 rounded-lg border border-outline-variant bg-surface px-2 py-1 text-sm" /> days
          </label>
        )}
      </div>
    </fieldset>
  );
}

export function FailurePolicyCard({ data, save }: { data: PolicyResponse; save: Save }) {
  const [draft, setDraft] = useState(data.failure);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(data.failure);
  const toggleModule = (m: string) =>
    setDraft((d) => ({ ...d, restrictedModules: d.restrictedModules.includes(m) ? d.restrictedModules.filter((x) => x !== m) : [...d.restrictedModules, m] }));

  return (
    <section className={card} aria-labelledby="failure-policy">
      <Header icon={ShieldAlert} title="Failed payments" subtitle="What a customer can use after a charge fails" badge={null} />
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat name="In grace" value={data.stats.paymentFailuresInGrace} />
        <Stat name="Restricted" value={data.stats.paymentFailuresRestricted} />
        <Stat name="Held for review" value={data.stats.recoveriesOnHold} />
      </div>
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-outline-variant bg-surface p-3 text-xs text-on-surface-variant">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>A grace period only <strong>permits access</strong> while the customer fixes payment — it is not a payment. The subscription stays past due until Razorpay confirms a charge. Changes apply to <strong>new failures only</strong>; each open failure keeps the rules frozen when it happened.</span>
      </div>
      <div className="space-y-3">
        <RuleEditor id="first-charge" title="First charge after the free trial" value={draft.firstCharge} onChange={(v) => setDraft((d) => ({ ...d, firstCharge: v }))} />
        <RuleEditor id="renewal" title="Renewal for a paying customer" value={draft.renewal} onChange={(v) => setDraft((d) => ({ ...d, renewal: v }))} />
        <fieldset className="rounded-lg border border-outline-variant p-3">
          <legend className="px-1 text-xs font-bold text-on-surface">Restricted after the grace period</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {data.restrictableModules.map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.restrictedModules.includes(m)} onChange={() => toggleModule(m)} /> {MODULE_LABELS[m] ?? m}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-outline">Always available, whatever is chosen: {data.alwaysAccessible.map((a) => a.replace(/_/g, ' ')).join(', ')} and the free Google ranking audit.</p>
        </fieldset>
        <fieldset className="rounded-lg border border-outline-variant p-3">
          <legend className="px-1 text-xs font-bold text-on-surface">After a verified recovery payment</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="restore" checked={draft.restoreAccessOnRecovery} onChange={() => setDraft((d) => ({ ...d, restoreAccessOnRecovery: true }))} /> Restore access automatically
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="restore" checked={!draft.restoreAccessOnRecovery} onChange={() => setDraft((d) => ({ ...d, restoreAccessOnRecovery: false }))} /> Hold for a super admin to release
            </label>
          </div>
        </fieldset>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={!changed} onClick={() => setConfirm(true)} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-container disabled:opacity-50">Save failed-payment policy</button>
        {changed && <button type="button" onClick={() => setDraft(data.failure)} className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant">Discard</button>}
      </div>
      <ErrorLine error={error} />
      <ConfirmDialog
        open={confirm}
        title="Save the failed-payment policy?"
        confirmLabel="Save"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          setError(await save('failure', draft));
          setBusy(false);
          setConfirm(false);
        }}
      >
        <p>Applies to payment failures from now on. Open failures keep their grace end and restrictions.</p>
      </ConfirmDialog>
    </section>
  );
}

// ── C. WhatsApp reminders ───────────────────────────────────────────────────
export function RemindersCard({ data, save }: { data: PolicyResponse; save: Save }) {
  const [draft, setDraft] = useState(data.reminders);
  const [days, setDays] = useState(data.reminders.steps.map((s) => s.offsetDays).join(', '));
  const [confirm, setConfirm] = useState<null | 'save' | 'enable' | 'disable'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = (enabled: boolean) => ({
    ...draft,
    enabled,
    steps: days.split(/[,\s]+/).filter(Boolean).map((d) => ({ offsetDays: Number(d) })),
  });
  const run = async (enabled: boolean) => {
    setBusy(true);
    setError(await save('reminders', build(enabled)));
    setBusy(false);
    setConfirm(null);
  };
  const templateOk = draft.template.approved && /^HX[0-9a-fA-F]{32}$/.test(draft.template.contentSid);

  return (
    <section className={card} aria-labelledby="reminders">
      <Header icon={BellRing} title="WhatsApp payment reminders" subtitle="Sent after a failed payment until it is fixed" badge={<OnOff on={data.reminders.enabled} />} />
      <div className="mb-3 rounded-lg border border-error-container bg-error-container/40 p-3 text-xs text-on-error-container">
        Real WhatsApp delivery has <strong>not been verified</strong> yet. Keep reminders OFF until a test with an approved template and one internal number has passed.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="rem-days">Reminder days after the failure (Day 0 = the failure)</label>
          <input id="rem-days" value={days} onChange={(e) => setDays(e.target.value)} className={input} placeholder="0, 1, 2, 7" />
        </div>
        <div>
          <label className={label} htmlFor="rem-max">Maximum reminders</label>
          <input id="rem-max" type="number" min={1} max={10} value={draft.maxReminders} onChange={(e) => setDraft({ ...draft, maxReminders: Number(e.target.value) })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="rem-tz">Timezone</label>
          <input id="rem-tz" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} className={input} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label} htmlFor="rem-start">Send from (hour)</label>
            <input id="rem-start" type="number" min={0} max={23} value={draft.sendingHours.start} onChange={(e) => setDraft({ ...draft, sendingHours: { ...draft.sendingHours, start: Number(e.target.value) } })} className={input} />
          </div>
          <div className="flex-1">
            <label className={label} htmlFor="rem-end">Until (hour)</label>
            <input id="rem-end" type="number" min={1} max={24} value={draft.sendingHours.end} onChange={(e) => setDraft({ ...draft, sendingHours: { ...draft.sendingHours, end: Number(e.target.value) } })} className={input} />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label} htmlFor="rem-attempts">Retry attempts (rate limits only)</label>
            <input id="rem-attempts" type="number" min={1} max={5} value={draft.retry.maxAttempts} onChange={(e) => setDraft({ ...draft, retry: { ...draft.retry, maxAttempts: Number(e.target.value) } })} className={input} />
          </div>
          <div className="flex-1">
            <label className={label} htmlFor="rem-backoff">Backoff (minutes)</label>
            <input id="rem-backoff" type="number" min={5} max={1440} value={draft.retry.backoffMinutes} onChange={(e) => setDraft({ ...draft, retry: { ...draft.retry, backoffMinutes: Number(e.target.value) } })} className={input} />
          </div>
        </div>
        <div>
          <label className={label} htmlFor="rem-sid">Approved template SID ({'{{1}}'} first name, {'{{2}}'} business)</label>
          <input id="rem-sid" value={draft.template.contentSid} onChange={(e) => setDraft({ ...draft, template: { ...draft.template, contentSid: e.target.value.trim() } })} className={input} placeholder="HX…" />
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-on-surface-variant">
            <input type="checkbox" checked={draft.template.approved} onChange={(e) => setDraft({ ...draft, template: { ...draft.template, approved: e.target.checked } })} />
            Meta has approved this template (UTILITY)
          </label>
        </div>
      </div>
      <p className="mt-3 text-xs text-outline">Schedule changes apply to new failures. Ambiguous sends are never retried automatically — they appear in Needs review.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setConfirm('save')} className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface">Save settings</button>
        {data.reminders.enabled ? (
          <button type="button" onClick={() => setConfirm('disable')} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">Turn reminders OFF</button>
        ) : (
          <button type="button" disabled={!templateOk} title={templateOk ? undefined : 'Needs an approved template SID'} onClick={() => setConfirm('enable')} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-container disabled:opacity-50">Turn reminders ON</button>
        )}
      </div>
      <ErrorLine error={error} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'enable' ? 'Turn WhatsApp reminders ON?' : confirm === 'disable' ? 'Turn WhatsApp reminders OFF?' : 'Save reminder settings?'}
        confirmLabel={confirm === 'enable' ? 'Turn ON' : confirm === 'disable' ? 'Turn OFF' : 'Save'}
        danger={confirm === 'disable'}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(confirm === 'enable' ? true : confirm === 'disable' ? false : data.reminders.enabled)}
      >
        {confirm === 'enable' && (
          <>
            <p>Customers with a failed payment will get WhatsApp reminders on the schedule above, to their verified phone, within the sending hours.</p>
            <p className="font-semibold text-error">Only do this after the WhatsApp test (approved template, one internal number, delivery callback) has passed.</p>
          </>
        )}
        {confirm === 'disable' && <p>Open reminder schedules stop now and are not resumed if you turn reminders back on.</p>}
        {confirm === 'save' && <p>Saved settings apply to new payment failures.</p>}
      </ConfirmDialog>
    </section>
  );
}
