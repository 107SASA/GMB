'use client';

import { useCallback, useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  ROLLBACK_CONFIRM,
  validationReview,
  wordDiff,
} from '@/app/dashboard/profile-optimization/textDiff';
import {
  actionResultText,
  businessTypeText,
  changedLines,
  dayLabel,
  formatValue,
  groupDuplicates,
  kindLabel,
  usesWordDiff,
  pinText,
  shortReference,
  sourceLabel,
  statusInfo,
} from '@/app/dashboard/profile-optimization/presentation';
import { attributeBatchRequestId } from '@/app/dashboard/profile-optimization/requestId';

interface ChangeRow {
  _id: string;
  kind: string;
  status: string;
  sensitive: boolean;
  source: string;
  before: unknown;
  proposed: unknown;
  error?: string | null;
  createdAt?: string;
  verifiedAt?: string | null;
  validation?: { valid?: boolean; violations?: Array<{ message?: string }>; warnings?: Array<{ message?: string }> };
}

interface CategoryRec {
  displayName: string;
  categoryName: string | null;
  reason: string;
  executable: boolean;
  role?: string;
  competitors?: string[];
  services?: string[];
  risk?: string;
}

type Action = 'apply' | 'rollback' | 'discard';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

interface DayHours { open: string; close: string; closed: boolean; split?: boolean }

/**
 * The synced Google week → one row per day. A day with no period is closed;
 * a day with several periods (lunch break) or overnight hours shows its first
 * period and is flagged — it is only replaced if the owner edits it.
 * null (Google has no hours set) → every day blank and open.
 */
function weekFromGoogle(periods: Array<{ openDay: string; closeDay: string; openTime: string; closeTime: string }> | null | undefined): Record<string, DayHours> {
  const week: Record<string, DayHours> = {};
  for (const day of DAYS) {
    if (!Array.isArray(periods)) { week[day] = { open: '', close: '', closed: false }; continue; }
    const own = periods.filter((p) => p.openDay === day);
    week[day] = own.length
      ? { open: own[0].openTime, close: own[0].closeTime, closed: false, split: own.length > 1 || own[0].closeDay !== day }
      : { open: '', close: '', closed: true };
  }
  return week;
}

function sameDay(a: DayHours | undefined, b: DayHours | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.closed === b.closed && (a.closed || (a.open === b.open && a.close === b.close));
}


const btnPrimary = 'px-3.5 py-1.5 rounded-lg bg-primary text-on-primary text-sm font-bold disabled:opacity-50';
const btnOutline = 'px-3.5 py-1.5 rounded-lg border border-outline text-sm font-bold disabled:opacity-50';
const input = 'border border-outline-variant rounded-lg px-3 py-2 text-sm bg-transparent';

/** One collapsible section — keeps the page short; the hint says what's inside. */
function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-outline-variant bg-surface-container-lowest">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-on-surface">{title}</span>
        <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          {hint}
          <MaterialIcon name="expand_more" size={18} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-outline-variant px-4 py-3">{children}</div>
    </details>
  );
}

export default function ProfileOptimizationPage() {
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [recs, setRecs] = useState<any>(null);
  const [googleReviewPending, setGoogleReviewPending] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [hours, setHours] = useState<Record<string, DayHours>>({});
  // What Google has now, per day — only days that differ from it are proposed.
  const [googleHours, setGoogleHours] = useState<Record<string, DayHours>>({});
  const [specialDate, setSpecialDate] = useState('');
  const [specialClosed, setSpecialClosed] = useState(true);
  const [specialOpen, setSpecialOpen] = useState('09:00');
  const [specialClose, setSpecialClose] = useState('17:00');
  const [areaQuery, setAreaQuery] = useState('');
  const [areaHits, setAreaHits] = useState<Array<{ placeId: string; placeName: string; address: string | null }>>([]);
  const [pickedAreas, setPickedAreas] = useState<Array<{ placeId: string; placeName: string }>>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [bulkBool, setBulkBool] = useState<Record<string, boolean | undefined>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, opt] = await Promise.all([
        fetch('/api/gbp/changes').then((r) => r.json()),
        fetch('/api/gbp/optimize').then((r) => r.json()),
      ]);
      setChanges(list.changes || []);
      setGoogleReviewPending(typeof list.googleReviewPending === 'boolean' ? list.googleReviewPending : null);
      setRecs(opt.success ? opt : null);
      if (opt.success && opt.connected !== false) {
        const week = weekFromGoogle(opt.hours?.currentRegularHours);
        setGoogleHours(week);
        setHours(week);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** One request at a time: buttons stay disabled until the list reloads. */
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch {
      setMessage('Something went wrong. Nothing was changed on Google. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const attributeNames: Record<string, string> = Object.fromEntries(
    (recs?.attributes?.suggestions || []).map((a: { name: string; displayName?: string }) => [a.name, a.displayName || a.name]),
  );

  const proposeSelectedAttributes = () => run(async () => {
    const suggestions = recs?.attributes?.suggestions || [];
    const items = suggestions.flatMap((attribute: { name: string; valueType: string }) => {
      if (attribute.valueType === 'BOOL') {
        return typeof bulkBool[attribute.name] === 'boolean' ? [{ name: attribute.name, value: bulkBool[attribute.name] }] : [];
      }
      const value = (attrValues[attribute.name] || '').trim();
      return value ? [{ name: attribute.name, value }] : [];
    });
    if (!items.length) {
      setMessage('Choose Yes or No (or enter a value) for at least one attribute first. Nothing was saved.');
      return;
    }
    const clientRequestId = await attributeBatchRequestId(items);
    const res = await fetch('/api/gbp/changes/attributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, items }),
    });
    const json = await res.json();
    const results = Array.isArray(json.results) ? json.results : [];
    const stored = results.filter((row: { stored?: boolean }) => row.stored);
    const failed = results.filter((row: { stored?: boolean }) => !row.stored);
    const reusedCount = stored.filter((row: { reused?: boolean }) => row.reused).length;
    const reusedText = reusedCount ? ` ${reusedCount} of them ${reusedCount === 1 ? 'was' : 'were'} already waiting, so no duplicate was added.` : '';
    const failureText = failed
      .map((row: { name?: string; error?: string; violations?: Array<{ message?: string }> }) => `${attributeNames[row.name || ''] || 'attribute'}: ${row.error || row.violations?.[0]?.message || 'not accepted'}`)
      .join('; ');
    setMessage(json.error && !results.length
      ? json.error
      : failed.length
        ? `${stored.length} of ${results.length} attribute proposals were saved.${reusedText} Not saved — ${failureText}. Nothing was sent to Google.`
        : `${stored.length} attribute proposal${stored.length === 1 ? ' is' : 's are'} ready to apply below.${reusedText} Nothing was sent to Google yet.`);
    setBulkBool({});
    await load();
  });

  const propose = (body: object) => run(async () => {
    const res = await fetch('/api/gbp/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setMessage(json.error || (json.reused && json.change?.status !== 'BLOCKED'
      ? 'This exact change is already in your proposals, so no duplicate was added. Nothing was sent to Google.'
      : json.change?.status === 'PROPOSED'
      ? 'Saved under “Ready to apply” below. Check what changes, then press “Apply to Google”. Nothing was sent yet.'
      : `This proposal did not pass our checks and was saved as “Not applied”.${json.change?.error ? ` ${json.change.error}` : ''}`));
    await load();
  });

  const act = (id: string, action: 'execute' | 'rollback' | 'discard', body?: object) => run(async () => {
    const res = await fetch(`/api/gbp/changes/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json();
    setMessage(actionResultText(action, json));
    setConfirm(null);
    await load();
  });

  const proposeHours = () => {
    const changed = DAYS.filter((d) => !sameDay(hours[d], googleHours[d]));
    const missing = changed.filter((d) => !hours[d]?.closed && !(hours[d]?.open && hours[d]?.close));
    if (missing.length) {
      setMessage(`Enter both an opening and a closing time for ${missing.map(dayLabel).join(', ')}, or tick Closed. Nothing was saved.`);
      return;
    }
    if (!changed.length && !specialDate) {
      setMessage('Nothing has changed yet. Edit a day or add a special date first. Nothing was saved.');
      return;
    }
    const open = changed.filter((d) => !hours[d].closed);
    propose({
      kind: 'hours',
      source: 'owner',
      proposed: {
        regularHours: { periods: open.map((d) => ({ openDay: d, closeDay: d, openTime: hours[d].open, closeTime: hours[d].close })) },
        closedDays: changed.filter((d) => hours[d].closed),
        specialHours: specialDate
          ? { specialHourPeriods: [{ startDate: specialDate, closed: specialClosed, openTime: specialClosed ? null : specialOpen, closeTime: specialClosed ? null : specialClose }] }
          : { specialHourPeriods: [] },
      },
    });
  };

  /** One step for the owner: approve (if still waiting) and send to Google. */
  const applyNow = (change: ChangeRow) => run(async () => {
    const post = (path: string, body: object = {}) =>
      fetch(`/api/gbp/changes/${change._id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
    if (change.status === 'PROPOSED') {
      const approved = await post('approve', { confirmSensitive: true });
      if (!approved.success) {
        setMessage(actionResultText('approve', approved));
        setConfirm(null);
        await load();
        return;
      }
    }
    setMessage(actionResultText('execute', await post('execute')));
    setConfirm(null);
    await load();
  });

  const resolveAreas = () => run(async () => {
    const queries = areaQuery.split('\n').map((q) => q.trim()).filter(Boolean);
    const res = await fetch('/api/gbp/service-area/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    const json = await res.json();
    const places = (json.results || []).flatMap((r: any) => r.places || []);
    setAreaHits(places);
    setMessage(json.error || (places.length ? null : 'No matching places were found. Try a city or PIN code.'));
  });

  if (loading && !changes.length && !recs) {
    return <div className="p-8 flex justify-center"><MaterialIcon name="progress_activity" size={32} className="animate-spin text-primary" /></div>;
  }

  const description = recs?.description;
  const categories = recs?.categories;
  const suggestions: Array<{ name: string; displayName?: string; valueType: string }> = recs?.attributes?.suggestions || [];
  const selectedCount = suggestions.filter((a) => (a.valueType === 'BOOL' ? typeof bulkBool[a.name] === 'boolean' : !!(attrValues[a.name] || '').trim())).length;
  const reminders = Object.entries((recs?.hours?.reminders || []).reduce((groups: Record<string, string[]>, reminder: { date: string; name: string; covered: boolean }) => {
    if (reminder.covered) return groups;
    groups[reminder.date] = [...(groups[reminder.date] || []), reminder.name];
    return groups;
  }, {})) as Array<[string, string[]]>;
  const grouped = groupDuplicates(changes);

  const renderCard = ({ change, duplicates }: { change: ChangeRow; duplicates: ChangeRow[] }) => {
    const review = validationReview(change.validation);
    // Recently applied while Google still has edits under review: accepted,
    // but not necessarily on the public listing yet.
    const recent = change.verifiedAt ? Date.now() - new Date(change.verifiedAt).getTime() < 14 * 86_400_000 : false;
    const inReview = change.status === 'VERIFIED' && recent && googleReviewPending === true;
    const status = inReview
      ? { ...statusInfo(change.status), label: 'Google is reviewing', explain: 'Accepted — Google is reviewing it. It can take a few hours to show.' }
      : statusInfo(change.status);
    const before = formatValue(change.kind, change.before, attributeNames);
    const after = formatValue(change.kind, change.proposed, attributeNames);
    const prose = usesWordDiff(change.kind);
    const diff = prose ? wordDiff(before, after) : [];
    const rows = prose ? [] : changedLines(before, after);
    const changed = prose ? diff.some((part) => part.type !== 'equal') : rows.length > 0;
    const confirming = confirm?.id === change._id ? confirm.action : null;
    const pending = change.status === 'PROPOSED' || change.status === 'APPROVED';
    const canApply = pending && changed && (!change.validation || review.passed);
    return (
      <article key={change._id} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-on-surface">{kindLabel(change.kind)}</p>
            <p className="text-xs text-on-surface-variant">
              {sourceLabel(change.source)}
              {change.createdAt ? ` · ${new Date(change.createdAt).toLocaleDateString()}` : ''}
              {' · '}Ref {shortReference(change._id)}
            </p>
          </div>
          <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-surface-container text-on-surface">{status.label}</span>
        </div>
        {duplicates.length > 0 && (
          <p className="text-xs text-on-surface-variant">Proposed {duplicates.length + 1} times — only the newest is shown.</p>
        )}

        {!changed ? (
          <p className="text-sm text-on-surface-variant">No change — this is already on your Google profile.</p>
        ) : prose ? (
          <div className="text-sm">
            <p className="text-xs font-semibold text-on-surface-variant mb-1">New text <span className="font-normal">(green is added, red is removed)</span></p>
            <p className="whitespace-pre-wrap break-words">
              {diff.map((part, index) => part.type === 'equal'
                ? <span key={index}>{part.value}</span>
                : part.type === 'insert'
                  ? <ins key={index} className="bg-primary-fixed text-primary no-underline">{part.value}</ins>
                  : <del key={index} className="text-error">{part.value}</del>)}
            </p>
          </div>
        ) : (
          <div className="text-sm">
            <p className="text-xs font-semibold text-on-surface-variant mb-1">What changes</p>
            <ul className="space-y-1">
              {rows.map((row, index) => (
                <li key={index} className="break-words">
                  {row.label && <span className="font-medium">{row.label}: </span>}
                  <span className="text-on-surface-variant line-through">{row.from ?? 'Not set'}</span>
                  <span className="mx-1.5 text-on-surface-variant">→</span>
                  <span className="font-semibold text-primary">{row.to ?? 'Removed'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {review.violations.map((text, index) => <p key={`violation-${index}`} className="text-xs text-error">{text}</p>)}
        {review.warnings.map((text, index) => <p key={`warning-${index}`} className="text-xs text-on-surface-variant">Note: {text}</p>)}
        {!pending && status.explain && <p className="text-xs text-on-surface-variant">{status.explain}</p>}
        {change.error && !pending && change.error !== review.violations.join(' ') && <p className="text-xs text-error">{change.error}</p>}

        {pending && (
          confirming === 'apply' ? (
            <div className="space-y-2 rounded-lg border border-outline-variant p-3">
              <p className="text-sm text-on-surface">
                Send this to your Google profile? You can roll it back later.
              </p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className={btnPrimary} onClick={() => applyNow(change)}>Yes, apply to Google</button>
                <button disabled={busy} className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : confirming === 'discard' ? (
            <div className="space-y-2 rounded-lg border border-outline-variant p-3">
              <p className="text-sm text-on-surface">Discard this change? Nothing is sent to Google.</p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className={btnOutline} onClick={() => act(change._id, 'discard')}>Yes, discard</button>
                <button disabled={busy} className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canApply && <button disabled={busy} className={btnPrimary} onClick={() => setConfirm({ id: change._id, action: 'apply' })}>Apply to Google…</button>}
              <button disabled={busy} className={btnOutline} onClick={() => setConfirm({ id: change._id, action: 'discard' })}>Discard</button>
            </div>
          )
        )}

        {change.status === 'VERIFIED' && (
          confirming === 'rollback' ? (
            <div className="space-y-2 rounded-lg border border-outline-variant p-3">
              <p className="text-sm text-on-surface">{ROLLBACK_CONFIRM}</p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className={btnOutline} onClick={() => act(change._id, 'rollback')}>Yes, roll back</button>
                <button disabled={busy} className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button disabled={busy} className={btnOutline} onClick={() => setConfirm({ id: change._id, action: 'rollback' })}>Roll back…</button>
          )
        )}

        {change.status === 'UNRESOLVED' && (
          <div className="space-y-1">
            <p className="text-xs text-on-surface-variant">Checking only reads your Google profile. Nothing is sent again.</p>
            <button disabled={busy} className={btnOutline} onClick={() => act(change._id, 'execute')}>Check Google again</button>
          </div>
        )}
      </article>
    );
  };

  const ready = grouped.filter((g) => ['waiting', 'approved'].includes(statusInfo(g.change.status).group));
  const history = grouped.filter((g) => !ready.includes(g));
  const addable: CategoryRec[] = (categories?.additional || []).filter((c: CategoryRec) => c.executable && c.categoryName);
  const notAddable = (categories?.additional || []).length - addable.length;
  const linkKeys = (['appointment', 'menu', 'order'] as const).filter((key) => recs?.links?.attributes?.[key]?.name);
  const changedDays = DAYS.filter((d) => !sameDay(hours[d], googleHours[d])).length;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-6 md:p-8 space-y-4">
      <div className="space-y-2">
        <h1 className="font-heading text-xl font-bold text-on-surface">Profile optimization</h1>
        <p className="text-sm text-on-surface-variant">Improve your Google profile. Nothing changes on Google until you press “Apply to Google”.</p>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-xs text-on-surface-variant">
          <MaterialIcon name="schedule" size={14} /> Google can take a few hours to show changes on your listing.
        </p>
      </div>
      <div role="status" aria-live="polite">
        {message && <p className="text-sm text-on-surface rounded-lg bg-surface-container px-3 py-2">{message}</p>}
      </div>

      {recs && recs.connected === false && (
        <p className="text-sm rounded-lg border border-outline-variant bg-surface-container px-3 py-2">
          Your Google profile isn’t connected or hasn’t synced yet.{' '}
          <a href="/api/auth/google" className="font-semibold text-primary underline">Connect Google</a> and check back in a few minutes.
        </p>
      )}

      {ready.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading font-bold text-on-surface">Ready to apply ({ready.length})</h2>
          {ready.map(renderCard)}
        </section>
      )}

      {recs && recs.connected !== false && (
        <div className="space-y-2">
          <h2 className="font-heading font-bold text-on-surface pt-2">Improve your profile</h2>

          {description?.text && (
            <Panel title="Business description" hint="1 suggestion">
              <p className="text-sm whitespace-pre-wrap break-words">{description.text}</p>
              {description.validation?.valid ? (
                <button disabled={busy} className={btnPrimary} onClick={() => propose({ kind: 'description', proposed: description.text, source: 'recommendation', context: { tokens: description.tokens || [], competitorNames: description.competitorNames || [] } })}>Use this description</button>
              ) : (
                <p className="text-xs text-error">This draft didn’t pass our checks.</p>
              )}
            </Panel>
          )}

          {Boolean(categories?.primary || categories?.additional?.length) && (
            <Panel title="Categories" hint={addable.length ? `${addable.length} to add` : 'Nothing to add'}>
              {categories?.primary && (
                <div className="space-y-1 text-sm">
                  <p>Main category: <strong>{categories.primary.displayName}</strong></p>
                  {categories.primary.risk === 'high' && <p className="text-xs text-on-surface-variant">Changing the main category can change where you appear in search.</p>}
                  {categories.primary.executable && categories.primary.categoryName && (
                    <button disabled={busy} className={btnOutline} onClick={() => propose({ kind: 'primary_category', proposed: { primaryCategory: { name: categories.primary.categoryName } }, source: 'recommendation' })}>Use as main category</button>
                  )}
                </div>
              )}
              {addable.length > 0 && (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {addable.map((c) => (
                      <li key={c.displayName} className="rounded-full border border-outline-variant px-3 py-1 text-xs">
                        {c.displayName}{c.competitors?.length ? <span className="text-on-surface-variant"> · used by competitors</span> : null}
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={busy}
                    className={btnOutline}
                    onClick={() => propose({ kind: 'categories', source: 'recommendation', proposed: { additionalCategories: addable.map((c) => ({ name: c.categoryName })) } })}
                  >Add {addable.length} categor{addable.length === 1 ? 'y' : 'ies'}</button>
                </>
              )}
              {notAddable > 0 && <p className="text-xs text-on-surface-variant">{notAddable} other categor{notAddable === 1 ? 'y' : 'ies'} used by competitors can’t be added through Google right now.</p>}
            </Panel>
          )}

          <Panel title="Attributes" hint={suggestions.length ? `${suggestions.length} not set` : 'All set'}>
            {suggestions.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{recs.attributes?.available === false ? 'Not available for your category right now.' : 'Nothing missing.'}</p>
            ) : (
              <>
                <p className="text-xs text-on-surface-variant">Answer the ones that apply. Skip the rest.</p>
                <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {suggestions.map((a) => (
                    <li key={a.name} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-sm min-w-0">{a.displayName || attributeNames[a.name]}</span>
                      {a.valueType === 'BOOL' ? (
                        <div className="flex shrink-0 gap-1" role="group" aria-label={a.displayName}>
                          {([true, false] as const).map((value) => (
                            <button
                              key={String(value)}
                              aria-pressed={bulkBool[a.name] === value}
                              className={`px-2.5 py-0.5 rounded-full border text-xs ${bulkBool[a.name] === value ? 'border-primary bg-primary-fixed text-primary font-bold' : 'border-outline-variant'}`}
                              onClick={() => setBulkBool({ ...bulkBool, [a.name]: bulkBool[a.name] === value ? undefined : value })}
                            >{value ? 'Yes' : 'No'}</button>
                          ))}
                        </div>
                      ) : (
                        <input
                          className={`${input} w-40`}
                          placeholder={a.valueType === 'URL' ? 'https://' : 'Value'}
                          value={attrValues[a.name] || ''}
                          onChange={(e) => setAttrValues({ ...attrValues, [a.name]: e.target.value })}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                <button disabled={busy || selectedCount === 0} className={btnPrimary} onClick={proposeSelectedAttributes}>
                  {selectedCount ? `Save ${selectedCount} answer${selectedCount === 1 ? '' : 's'}` : 'Pick at least one answer'}
                </button>
              </>
            )}
          </Panel>

          {linkKeys.length > 0 && (
            <Panel title="Booking & order links" hint={`${linkKeys.length} available`}>
              {linkKeys.map((key) => {
                const link = recs.links.attributes[key];
                return (
                  <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-sm sm:w-28 capitalize">{key} link</span>
                    <input className={`${input} w-full sm:flex-1`} placeholder="https://" value={attrValues[link.name] || ''} onChange={(e) => setAttrValues({ ...attrValues, [link.name]: e.target.value })} />
                    <button disabled={busy || !(attrValues[link.name] || '').trim()} className={btnOutline} onClick={() => propose({ kind: 'attribute', proposed: { name: link.name, value: attrValues[link.name] || '' }, source: 'owner' })}>Save</button>
                  </div>
                );
              })}
            </Panel>
          )}

          {((recs.services?.items || []).length > 0 || recs.services?.blocked) && (
            <Panel title="Services" hint={recs.services?.items?.length ? `${recs.services.items.length} to add` : ''}>
              {(recs.services?.items || []).length > 0 && (
                <>
                  <p className="text-sm">{recs.services.items.map((s: any) => s.name).join(', ')}</p>
                  <button disabled={busy} className={btnOutline} onClick={() => propose({ kind: 'services', proposed: { additions: recs.services.items.map((s: any) => ({ name: s.name, description: s.description })) }, source: 'recommendation' })}>Add these services</button>
                </>
              )}
              {recs.services?.blocked && <p className="text-sm">{recs.services.reason}</p>}
            </Panel>
          )}

          <Panel title="Opening hours" hint={changedDays ? `${changedDays} changed` : reminders.length ? `${reminders.length} holiday${reminders.length === 1 ? '' : 's'} to set` : ''}>
            <p className="text-xs text-on-surface-variant">Your hours on Google now. Change a day or tick Closed — days you don’t change stay as they are.</p>
            <div className="space-y-1.5">
              {DAYS.map((day) => {
                const row = hours[day] || { open: '', close: '', closed: false };
                const set = (next: Partial<DayHours>) => setHours({ ...hours, [day]: { ...row, ...next, split: false } });
                return (
                  <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 font-medium">{dayLabel(day)}</span>
                    <label className="flex w-20 shrink-0 items-center gap-1.5 text-xs">
                      <input type="checkbox" checked={row.closed} onChange={(e) => set({ closed: e.target.checked })} /> Closed
                    </label>
                    {!row.closed && (
                      <>
                        <input type="time" aria-label={`${dayLabel(day)} opens`} className={`${input} min-w-0 py-1`} value={row.open} onChange={(e) => set({ open: e.target.value })} />
                        <span className="text-xs text-on-surface-variant">to</span>
                        <input type="time" aria-label={`${dayLabel(day)} closes`} className={`${input} min-w-0 py-1`} value={row.close} onChange={(e) => set({ close: e.target.value })} />
                        {row.open && row.close && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-primary underline"
                            onClick={() => setHours(Object.fromEntries(DAYS.map((d) => [d, hours[d]?.closed ? hours[d] : { open: row.open, close: row.close, closed: false }])))}
                          >Copy to all</button>
                        )}
                      </>
                    )}
                    {!sameDay(row, googleHours[day]) && <span className="text-xs font-semibold text-primary">Changed</span>}
                    {row.split && <span className="text-xs text-on-surface-variant">(has a break or overnight hours on Google)</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs font-medium">Special date</span>
              <input type="date" className={`${input} py-1`} value={specialDate} onChange={(e) => setSpecialDate(e.target.value)} />
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={specialClosed} onChange={(e) => setSpecialClosed(e.target.checked)} /> Closed</label>
              {specialDate && !specialClosed && (
                <>
                  <input type="time" aria-label="Special date opens" className={`${input} py-1`} value={specialOpen} onChange={(e) => setSpecialOpen(e.target.value)} />
                  <input type="time" aria-label="Special date closes" className={`${input} py-1`} value={specialClose} onChange={(e) => setSpecialClose(e.target.value)} />
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button disabled={busy} className={btnPrimary} onClick={proposeHours}>Save hours</button>
              {changedDays > 0 && <button type="button" disabled={busy} className="text-xs font-semibold text-on-surface-variant underline" onClick={() => setHours(googleHours)}>Undo changes</button>}
            </div>
            {recs?.hours?.status === 'READY' && reminders.length > 0 && (
              <div className="space-y-1.5 border-t border-outline-variant pt-3">
                <p className="text-xs font-semibold">Upcoming holidays with no hours on Google</p>
                {reminders.map(([date, names]) => (
                  <div key={date} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{date} — {names.join(', ')}</span>
                    <button
                      disabled={busy}
                      className={btnOutline}
                      onClick={() => propose({
                        kind: 'hours',
                        source: 'recommendation',
                        proposed: { regularHours: { periods: [] }, specialHours: { specialHourPeriods: [...(recs?.hours?.currentSpecialHours || []), { startDate: date, closed: true }] } },
                      })}
                    >Mark closed</button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Service area" hint={businessTypeText(recs?.serviceArea?.businessType)}>
            <p className="text-xs text-on-surface-variant">For businesses that visit customers. One city or PIN code per line.</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <textarea rows={2} className={`${input} w-full`} value={areaQuery} onChange={(e) => setAreaQuery(e.target.value)} placeholder="Nashik" />
              <button disabled={busy || !areaQuery.trim()} className={btnOutline} onClick={resolveAreas}>Find</button>
            </div>
            {areaHits.map((p) => (
              <label key={p.placeId} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={pickedAreas.some((x) => x.placeId === p.placeId)} onChange={(e) => setPickedAreas(e.target.checked ? [...pickedAreas, p] : pickedAreas.filter((x) => x.placeId !== p.placeId))} />
                <span className="break-words">{p.placeName}{p.address ? ` — ${p.address}` : ''}</span>
              </label>
            ))}
            {pickedAreas.length > 0 && (
              <button disabled={busy} className={btnPrimary} onClick={() => propose({ kind: 'service_area', source: 'owner', proposed: { places: { placeInfos: pickedAreas } } })}>Add {pickedAreas.length} area{pickedAreas.length === 1 ? '' : 's'}</button>
            )}
          </Panel>

          <p className="flex items-center gap-1.5 px-1 pt-1 text-xs text-on-surface-variant">
            <MaterialIcon name="location_on" size={14} /> {pinText(recs.pin?.status)}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <details className="space-y-3 pt-2" open={history.some((g) => g.change.status === 'UNRESOLVED')}>
          <summary className="cursor-pointer text-sm font-semibold text-on-surface py-2">History ({history.length})</summary>
          <div className="space-y-3">{history.map(renderCard)}</div>
        </details>
      )}
    </div>
  );
}
