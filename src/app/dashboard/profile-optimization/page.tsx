'use client';

import { useCallback, useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  APPLY_CONFIRM,
  APPLY_REQUIRES_BOTH_FLAGS,
  APPROVAL_DOES_NOT_PUBLISH,
  ROLLBACK_CONFIRM,
  SENSITIVE_CONFIRM,
  VALIDATION_LIMIT,
  VALIDATION_PASSED,
  validationReview,
  wordDiff,
} from '@/app/dashboard/profile-optimization/textDiff';
import {
  PRODUCTS_TEXT,
  actionResultText,
  businessTypeText,
  dayLabel,
  formatValue,
  groupDuplicates,
  kindLabel,
  lineChanges,
  usesWordDiff,
  pinText,
  shortReference,
  sourceLabel,
  statusInfo,
  type StatusGroup,
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

type Action = 'approve' | 'execute' | 'rollback';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

const GROUPS: Array<{ key: StatusGroup; title: string; hint: string }> = [
  { key: 'waiting', title: 'Waiting for your approval', hint: 'Nothing here has been sent to Google.' },
  { key: 'approved', title: 'Approved — ready to apply', hint: 'Approved, but not on Google until you apply them.' },
  { key: 'live', title: 'Applied to Google', hint: '' },
  { key: 'closed', title: 'Not applied', hint: 'Stopped, rejected by Google, rolled back, or waiting for a check. These are not sent to Google again.' },
];

const btnPrimary = 'px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-bold disabled:opacity-50';
const btnOutline = 'px-4 py-2 rounded-lg border border-outline text-sm font-bold disabled:opacity-50';
const input = 'border border-outline-variant rounded-lg px-3 py-2 text-sm bg-transparent';

export default function ProfileOptimizationPage() {
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [recs, setRecs] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [hours, setHours] = useState<Record<string, { open: string; close: string }>>({});
  const [specialDate, setSpecialDate] = useState('');
  const [specialClosed, setSpecialClosed] = useState(true);
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
      setRecs(opt.success ? opt : null);
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
        : `${stored.length} attribute proposal${stored.length === 1 ? ' is' : 's are'} ready for your approval below.${reusedText} Nothing was sent to Google.`);
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
      ? 'Proposal saved. Review it under “Waiting for your approval”. Nothing was sent to Google.'
      : `This proposal did not pass our checks and was saved as “Not applied”.${json.change?.error ? ` ${json.change.error}` : ''}`));
    await load();
  });

  const act = (id: string, action: Action, body?: object) => run(async () => {
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
    const status = statusInfo(change.status);
    const before = formatValue(change.kind, change.before, attributeNames);
    const after = formatValue(change.kind, change.proposed, attributeNames);
    const prose = usesWordDiff(change.kind);
    const diff = prose ? wordDiff(before, after) : [];
    const lines = lineChanges(before, after);
    const changed = prose ? diff.some((part) => part.type !== 'equal') : before !== after;
    const confirming = confirm?.id === change._id ? confirm.action : null;
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
          <p className="text-xs text-on-surface-variant">
            The same change was proposed {duplicates.length + 1} times. Only the newest one is shown; acting on it is enough.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-on-surface-variant">Now on Google</p>
            {prose ? (
              <p className="whitespace-pre-wrap break-words mt-1">{before}</p>
            ) : (
              <div className="mt-1 break-words">
                {lines.before.map((line, index) => line.changed && changed
                  ? <del key={index} className="block text-error">{line.text}</del>
                  : <span key={index} className="block">{line.text}</span>)}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-on-surface-variant">Proposed</p>
            {prose ? (
              <p className="whitespace-pre-wrap break-words mt-1">
                {changed
                  ? diff.map((part, index) => part.type === 'equal'
                    ? <span key={index}>{part.value}</span>
                    : part.type === 'insert'
                      ? <ins key={index} className="bg-primary-fixed text-primary no-underline">{part.value}</ins>
                      : <del key={index} className="text-error">{part.value}</del>)
                  : after}
              </p>
            ) : (
              <div className="mt-1 break-words">
                {lines.after.map((line, index) => line.changed && changed
                  ? <ins key={index} className="block bg-primary-fixed text-primary no-underline">{line.text}</ins>
                  : <span key={index} className="block">{line.text}</span>)}
              </div>
            )}
            {!changed
              ? <p className="text-xs text-on-surface-variant mt-1">Same as what is on Google now.</p>
              : prose
                ? <p className="text-xs text-on-surface-variant mt-1">Highlighted text is new; struck-through text is removed.</p>
                : <p className="text-xs text-on-surface-variant mt-1">Highlighted lines change; struck-through lines are replaced or removed.</p>}
          </div>
        </div>

        {change.status === 'PROPOSED' && (
          change.validation
            ? <p className={`text-xs ${review.passed ? 'text-on-surface' : 'text-error'}`}>{review.passed ? VALIDATION_PASSED : 'Our checks found a problem with this change.'}</p>
            : <p className="text-xs text-on-surface-variant">This change has not been checked.</p>
        )}
        {review.violations.map((text, index) => <p key={`violation-${index}`} className="text-xs text-error">{text}</p>)}
        {review.warnings.map((text, index) => <p key={`warning-${index}`} className="text-xs text-on-surface-variant">Note: {text}</p>)}
        {status.explain && <p className="text-xs text-on-surface-variant">{status.explain}</p>}
        {change.error && change.status !== 'PROPOSED' && change.error !== review.violations.join(' ') &&<p className="text-xs text-error">{change.error}</p>}

        {change.status === 'PROPOSED' && (
          <div className="space-y-2">
            {change.sensitive && <p className="text-xs font-semibold text-on-surface">{SENSITIVE_CONFIRM}</p>}
            {confirming === 'approve' ? (
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className={btnPrimary} onClick={() => act(change._id, 'approve', { confirmSensitive: true })}>Yes, approve this {kindLabel(change.kind).toLowerCase()} change</button>
                <button disabled={busy} className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            ) : (
              <button
                disabled={busy}
                className={btnPrimary}
                onClick={() => (change.sensitive ? setConfirm({ id: change._id, action: 'approve' }) : act(change._id, 'approve'))}
              >Approve</button>
            )}
          </div>
        )}

        {change.status === 'APPROVED' && (
          confirming === 'execute' ? (
            <div className="space-y-2 rounded-lg border border-outline-variant p-3">
              <p className="text-sm text-on-surface">{APPLY_CONFIRM}</p>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className={btnPrimary} onClick={() => act(change._id, 'execute')}>Yes, apply to Google</button>
                <button disabled={busy} className={btnOutline} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button disabled={busy} className={btnPrimary} onClick={() => setConfirm({ id: change._id, action: 'execute' })}>Apply to Google…</button>
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

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 md:p-8 space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-on-surface">Profile optimization</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Suggestions for your Google Business Profile. Every change waits for your approval. {APPROVAL_DOES_NOT_PUBLISH} {APPLY_REQUIRES_BOTH_FLAGS}
        </p>
        <p className="text-xs text-on-surface-variant mt-1">{VALIDATION_LIMIT}</p>
      </div>
      <div role="status" aria-live="polite">
        {message && <p className="text-sm text-on-surface rounded-lg bg-surface-container px-3 py-2">{message}</p>}
      </div>

      {recs && (
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 md:p-6 space-y-5">
          <h2 className="font-heading font-bold">Recommendations</h2>

          {description?.text && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Business description</h3>
              <p className="text-sm whitespace-pre-wrap break-words">{description.text}</p>
              {description.validation?.valid ? (
                <button disabled={busy} className={btnPrimary} onClick={() => propose({ kind: 'description', proposed: description.text, source: 'recommendation', context: { tokens: description.tokens || [], competitorNames: description.competitorNames || [] } })}>Propose this description</button>
              ) : (
                <p className="text-xs text-error">This draft did not pass our checks, so it can’t be proposed.</p>
              )}
            </div>
          )}

          {Boolean(categories?.primary || categories?.additional?.length) && (
            <div className="space-y-2 text-sm">
              <h3 className="font-semibold">Categories</h3>
              {categories?.primary && (
                <div className="space-y-1">
                  <p>Suggested primary category: <strong>{categories.primary.displayName}</strong>. {categories.primary.reason}</p>
                  {categories.primary.risk === 'high' && <p className="text-xs text-on-surface-variant">Changing your primary category can noticeably change where you appear in search. Review carefully.</p>}
                  {categories.primary.executable && categories.primary.categoryName && (
                    <button disabled={busy} className={btnOutline} onClick={() => propose({ kind: 'primary_category', proposed: { primaryCategory: { name: categories.primary.categoryName } }, source: 'recommendation' })}>Propose primary category</button>
                  )}
                </div>
              )}
              {(categories?.additional || []).map((c: CategoryRec) => (
                <div key={c.displayName} className="space-y-0.5">
                  <p>Additional category: <strong>{c.displayName}</strong>{c.executable ? '' : ' (not available on Google, so it can’t be added)'}. {c.reason}</p>
                  {c.competitors?.length ? <p className="text-xs text-on-surface-variant">Used by: {c.competitors.join(', ')}</p> : null}
                </div>
              ))}
              {categories?.additional?.some((c: CategoryRec) => c.executable && c.categoryName) && (
                <button
                  disabled={busy}
                  className={btnOutline}
                  onClick={() => propose({
                    kind: 'categories',
                    source: 'recommendation',
                    proposed: {
                      additionalCategories: categories.additional.filter((c: CategoryRec) => c.executable && c.categoryName).map((c: CategoryRec) => ({ name: c.categoryName })),
                    },
                  })}
                >Propose additional categories</button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Attributes</h3>
            {suggestions.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{recs.attributes?.available === false ? 'Attribute suggestions are not available for your category right now.' : 'No missing attributes found.'}</p>
            ) : (
              <>
                <p className="text-xs text-on-surface-variant">These are not set on your profile yet. Pick an answer for the ones that apply, then propose them together.</p>
                <ul className="divide-y divide-outline-variant">
                  {suggestions.map((a) => (
                    <li key={a.name} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm">{a.displayName || attributeNames[a.name]}</span>
                      {a.valueType === 'BOOL' ? (
                        <div className="flex gap-2" role="group" aria-label={a.displayName}>
                          {([true, false] as const).map((value) => (
                            <button
                              key={String(value)}
                              aria-pressed={bulkBool[a.name] === value}
                              className={`px-4 py-2 rounded-lg border text-sm ${bulkBool[a.name] === value ? 'border-primary bg-primary-fixed text-primary font-bold' : 'border-outline-variant'}`}
                              onClick={() => setBulkBool({ ...bulkBool, [a.name]: bulkBool[a.name] === value ? undefined : value })}
                            >{value ? 'Yes' : 'No'}</button>
                          ))}
                        </div>
                      ) : (
                        <input
                          className={`${input} w-full sm:w-64`}
                          placeholder={a.valueType === 'URL' ? 'https://' : 'Value'}
                          value={attrValues[a.name] || ''}
                          onChange={(e) => setAttrValues({ ...attrValues, [a.name]: e.target.value })}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                <button disabled={busy || selectedCount === 0} className={btnPrimary} onClick={proposeSelectedAttributes}>
                  Propose {selectedCount || ''} selected attribute{selectedCount === 1 ? '' : 's'}
                </button>
              </>
            )}
          </div>

          {(['appointment', 'menu', 'order'] as const).some((key) => recs.links?.attributes?.[key]?.name) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Booking and ordering links</h3>
              {(['appointment', 'menu', 'order'] as const).map((key) => {
                const link = recs.links?.attributes?.[key];
                if (!link?.name) return null;
                return (
                  <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-sm sm:w-32 capitalize">{key} link</span>
                    <input className={`${input} w-full sm:flex-1`} placeholder="https://" value={attrValues[link.name] || ''} onChange={(e) => setAttrValues({ ...attrValues, [link.name]: e.target.value })} />
                    <button disabled={busy || !(attrValues[link.name] || '').trim()} className={btnOutline} onClick={() => propose({ kind: 'attribute', proposed: { name: link.name, value: attrValues[link.name] || '' }, source: 'owner' })}>Propose</button>
                  </div>
                );
              })}
            </div>
          )}

          {(recs.services?.items || []).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Services</h3>
              <p className="text-sm">{recs.services.items.map((s: any) => s.name).join(', ')}</p>
              <button disabled={busy} className={btnOutline} onClick={() => propose({ kind: 'services', proposed: { additions: recs.services.items.map((s: any) => ({ name: s.name, description: s.description })) }, source: 'recommendation' })}>Propose these services</button>
            </div>
          )}
          {recs.services?.blocked && <p className="text-sm">{recs.services.reason}</p>}

          <div className="space-y-1 text-sm">
            <h3 className="font-semibold">Map pin</h3>
            <p>{pinText(recs.pin?.status)}</p>
          </div>
          <p className="text-xs text-on-surface-variant">{PRODUCTS_TEXT}</p>
        </section>
      )}

      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 md:p-6 space-y-3">
        <h2 className="font-heading font-bold">Opening hours</h2>
        <p className="text-xs text-on-surface-variant">Days you leave blank stay as they are on Google.</p>
        {DAYS.map((day) => (
          <div key={day} className="grid grid-cols-[6.5rem_1fr_1fr] items-center gap-2 text-sm sm:flex">
            <span className="sm:w-28">{dayLabel(day)}</span>
            <input type="time" aria-label={`${dayLabel(day)} opens`} className={`${input} min-w-0`} value={hours[day]?.open || ''} onChange={(e) => setHours({ ...hours, [day]: { open: e.target.value, close: hours[day]?.close || '' } })} />
            <input type="time" aria-label={`${dayLabel(day)} closes`} className={`${input} min-w-0`} value={hours[day]?.close || ''} onChange={(e) => setHours({ ...hours, [day]: { open: hours[day]?.open || '', close: e.target.value } })} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Special date (optional)</span>
          <input type="date" className={input} value={specialDate} onChange={(e) => setSpecialDate(e.target.value)} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={specialClosed} onChange={(e) => setSpecialClosed(e.target.checked)} /> Closed that day</label>
        </div>
        <button
          disabled={busy}
          className={btnOutline}
          onClick={() => propose({
            kind: 'hours',
            source: 'owner',
            proposed: {
              regularHours: {
                periods: DAYS.filter((d) => hours[d]?.open && hours[d]?.close).map((d) => ({ openDay: d, closeDay: d, openTime: hours[d].open, closeTime: hours[d].close })),
              },
              specialHours: specialDate ? { specialHourPeriods: [{ startDate: specialDate, closed: specialClosed, openTime: specialClosed ? null : '09:00', closeTime: specialClosed ? null : '17:00' }] } : { specialHourPeriods: [] },
            },
          })}
        >Propose these hours</button>

        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-semibold">Upcoming holidays</h3>
          {recs?.hours?.status === 'READY'
            ? (reminders.length === 0
              ? <p className="text-sm text-on-surface-variant">Your upcoming holidays already have special hours.</p>
              : <p className="text-xs text-on-surface-variant">These holidays have no special hours on Google yet. Propose “Closed” if you will be shut.</p>)
            : <p className="text-sm text-on-surface-variant">Holiday reminders are not available for your business yet.</p>}
          {reminders.map(([date, names]) => (
            <div key={date} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>{date} — {names.join(', ')}</span>
              <button
                disabled={busy}
                className={btnOutline}
                onClick={() => propose({
                  kind: 'hours',
                  source: 'recommendation',
                  proposed: {
                    regularHours: { periods: [] },
                    specialHours: {
                      specialHourPeriods: [
                        ...(recs?.hours?.currentSpecialHours || []),
                        { startDate: date, closed: true },
                      ],
                    },
                  },
                })}
              >Propose closed</button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 md:p-6 space-y-3">
        <h2 className="font-heading font-bold">Service area</h2>
        <p className="text-sm">Profile type: {businessTypeText(recs?.serviceArea?.businessType)}</p>
        <p className="text-xs text-on-surface-variant">Only businesses that serve customers at their location can set a service area. Enter one city or PIN code per line, then pick the matching places.</p>
        <textarea rows={3} className={`${input} w-full`} value={areaQuery} onChange={(e) => setAreaQuery(e.target.value)} placeholder="Nashik" />
        <button disabled={busy || !areaQuery.trim()} className={btnOutline} onClick={resolveAreas}>Find places</button>
        {areaHits.map((p) => (
          <label key={p.placeId} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={pickedAreas.some((x) => x.placeId === p.placeId)} onChange={(e) => setPickedAreas(e.target.checked ? [...pickedAreas, p] : pickedAreas.filter((x) => x.placeId !== p.placeId))} />
            <span className="break-words">{p.placeName}{p.address ? ` — ${p.address}` : ''}</span>
          </label>
        ))}
        {pickedAreas.length > 0 && (
          <button disabled={busy} className={btnOutline} onClick={() => propose({ kind: 'service_area', source: 'owner', proposed: { places: { placeInfos: pickedAreas } } })}>Propose {pickedAreas.length} area{pickedAreas.length === 1 ? '' : 's'}</button>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-heading font-bold">Your proposals</h2>
        {changes.length === 0 && <p className="text-sm text-on-surface-variant">No proposals yet.</p>}
        {GROUPS.map((group) => {
          const items = grouped.filter((g) => statusInfo(g.change.status).group === group.key);
          if (!items.length) return null;
          const body = (
            <div className="space-y-3">
              {group.hint && <p className="text-xs text-on-surface-variant">{group.hint}</p>}
              {items.map(renderCard)}
            </div>
          );
          return group.key === 'closed' ? (
            <details key={group.key} className="space-y-3" open={items.some((g) => g.change.status === 'UNRESOLVED')}>
              <summary className="cursor-pointer text-sm font-semibold text-on-surface py-2">{group.title} ({items.length})</summary>
              {body}
            </details>
          ) : (
            <div key={group.key} className="space-y-2">
              <h3 className="text-sm font-semibold text-on-surface">{group.title} ({items.length})</h3>
              {body}
            </div>
          );
        })}
      </section>
    </div>
  );
}
