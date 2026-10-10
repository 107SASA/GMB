'use client';

import { useCallback, useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  APPLY_REQUIRES_BOTH_FLAGS,
  APPROVAL_DOES_NOT_PUBLISH,
  SENSITIVE_CONFIRM,
  VALIDATION_LIMIT,
  VALIDATION_PASSED,
  proposalText,
  validationReview,
  wordDiff,
} from '@/app/dashboard/profile-optimization/textDiff';

interface ChangeRow {
  _id: string;
  businessId?: string;
  locationId?: string;
  clientRequestId?: string | null;
  kind: string;
  status: string;
  sensitive: boolean;
  source: string;
  before: unknown;
  proposed: unknown;
  error?: string | null;
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

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function show(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export default function ProfileOptimizationPage() {
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [recs, setRecs] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [hours, setHours] = useState<Record<string, { open: string; close: string }>>({});
  const [specialDate, setSpecialDate] = useState('');
  const [specialClosed, setSpecialClosed] = useState(true);
  const [areaQuery, setAreaQuery] = useState('');
  const [areaHits, setAreaHits] = useState<Array<{ placeId: string; placeName: string; address: string | null }>>([]);
  const [pickedAreas, setPickedAreas] = useState<Array<{ placeId: string; placeName: string }>>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [bulkOn, setBulkOn] = useState<Record<string, boolean>>({});
  const [bulkBool, setBulkBool] = useState<Record<string, boolean>>({});

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

  const proposeSelectedAttributes = async () => {
    const suggestions = recs?.attributes?.suggestions || [];
    const skipped: string[] = [];
    const items = suggestions.flatMap((attribute: { name: string; displayName?: string; valueType: string }) => {
      if (!bulkOn[attribute.name]) return [];
      const label = attribute.displayName || attribute.name;
      if (attribute.valueType === 'BOOL') {
        if (typeof bulkBool[attribute.name] !== 'boolean') {
          skipped.push(label);
          return [];
        }
        return [{ name: attribute.name, value: bulkBool[attribute.name] }];
      }
      const value = attrValues[attribute.name] || '';
      if (!value) {
        skipped.push(label);
        return [];
      }
      return [{ name: attribute.name, value }];
    });
    if (!items.length) {
      setMessage(skipped.length
        ? `Choose a value before proposing: ${skipped.join(', ')}. Nothing was stored.`
        : 'Select at least one attribute. Nothing was stored.');
      return;
    }
    setMessage(null);
    const payload = items
      .map((item: { name: string; value: unknown }) => `${item.name}:${JSON.stringify(item.value)}`)
      .sort()
      .join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const hex = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const clientRequestId = `attr-${hex.slice(0, 32)}`;
    const res = await fetch('/api/gbp/changes/attributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRequestId, items }),
    });
    const json = await res.json();
    const results = Array.isArray(json.results) ? json.results : [];
    const stored = results.filter((row: { stored?: boolean }) => row.stored);
    const failed = results.filter((row: { stored?: boolean }) => !row.stored);
    const failureText = failed.map((row: { name?: string; error?: string; violations?: Array<{ message?: string }> }) => `${row.name || 'attribute'}: ${row.error || row.violations?.[0]?.message || 'rejected'}`).join('; ');
    const skippedText = skipped.length ? ` Not sent because no value was chosen: ${skipped.join(', ')}.` : '';
    setMessage(failed.length
      ? `${stored.length} of ${results.length} attribute proposals were stored. Rejected: ${failureText}.${skippedText} Nothing was published.`
      : json.error || `${stored.length} attribute proposals were stored. Review each one before approval.${skippedText} Nothing was published.`);
    await load();
  };

  const propose = async (body: object) => {
    setMessage(null);
    const res = await fetch('/api/gbp/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setMessage(json.error || (json.change?.status === 'PROPOSED' ? 'Proposal created. Review it below before approval.' : json.change?.error || 'The proposal was blocked.'));
    await load();
  };

  const act = async (id: string, action: 'approve' | 'execute' | 'rollback', body?: object) => {
    setMessage(null);
    const res = await fetch(`/api/gbp/changes/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json();
    setMessage(json.error || (json.success ? `${action} completed.` : 'Could not update the change.'));
    setConfirmId(null);
    await load();
  };

  const resolveAreas = async () => {
    const queries = areaQuery.split('\n').map((q) => q.trim()).filter(Boolean);
    const res = await fetch('/api/gbp/service-area/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    const json = await res.json();
    const places = (json.results || []).flatMap((r: any) => r.places || []);
    setAreaHits(places);
    setMessage(json.note || json.error || null);
  };

  if (loading) {
    return <div className="p-8 flex justify-center"><MaterialIcon name="progress_activity" size={32} className="animate-spin text-primary" /></div>;
  }

  const description = recs?.description;
  const categories = recs?.categories;

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-on-surface">Profile optimization</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          {APPROVAL_DOES_NOT_PUBLISH} {APPLY_REQUIRES_BOTH_FLAGS} A bulk attribute selection stores one proposal per attribute and does not publish them. {VALIDATION_LIMIT}
        </p>
      </div>
      {message && <p className="text-sm text-on-surface">{message}</p>}

      {recs && (
        <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-4">
          <h2 className="font-heading font-bold">Recommendations</h2>
          <p className="text-sm text-on-surface-variant">{recs.products?.reason}</p>
          {description?.text && (
            <div className="space-y-1">
              <p className="text-xs text-on-surface-variant">Description draft · {description.validation?.valid ? VALIDATION_PASSED : 'Validation failed.'} {VALIDATION_LIMIT}</p>
              <p className="text-sm whitespace-pre-wrap">{description.text}</p>
              {description.validation?.valid && (
                <button className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold" onClick={() => propose({ kind: 'description', proposed: description.text, source: 'recommendation', context: { tokens: description.tokens || [], competitorNames: description.competitorNames || [] } })}>Propose this description</button>
              )}
            </div>
          )}
          {categories?.primary && (
            <div className="text-sm space-y-1">
              <p>Primary category: {categories.primary.displayName}. {categories.primary.reason} Risk: {categories.primary.risk}. It is not applied automatically.</p>
              {categories.primary.executable && categories.primary.categoryName && (
                <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={() => propose({ kind: 'primary_category', proposed: { primaryCategory: { name: categories.primary.categoryName } }, source: 'recommendation' })}>Propose primary category</button>
              )}
            </div>
          )}
          {(categories?.additional || []).map((c: CategoryRec) => (
            <div key={c.displayName} className="text-sm space-y-1">
              <p>Additional: {c.displayName}. {c.executable ? 'Resolved to a Google category.' : 'Not resolved, so it cannot be written.'} {c.reason}</p>
              {c.competitors?.length ? <p className="text-xs text-on-surface-variant">Competitors: {c.competitors.join(', ')}</p> : null}
            </div>
          ))}
          {categories?.additional?.some((c: CategoryRec) => c.executable && c.categoryName) && (
            <button
              className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold"
              onClick={() => propose({
                kind: 'categories',
                source: 'recommendation',
                proposed: {
                  additionalCategories: categories.additional.filter((c: CategoryRec) => c.executable && c.categoryName).map((c: CategoryRec) => ({ name: c.categoryName })),
                },
              })}
            >Propose resolved additional categories</button>
          )}
          <p className="text-sm">Attributes: {recs.attributes?.reason}</p>
          {(recs.attributes?.suggestions || []).map((a: any) => (
            <div key={a.name} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={!!bulkOn[a.name]} onChange={(e) => setBulkOn({ ...bulkOn, [a.name]: e.target.checked })} />
                <span>{a.displayName}</span>
              </label>
              {a.valueType === 'BOOL' ? (
                <>
                  <button className={`px-2 py-1 rounded border text-xs ${bulkBool[a.name] === true ? 'border-primary' : ''}`} onClick={() => setBulkBool({ ...bulkBool, [a.name]: true })}>Yes for selection</button>
                  <button className={`px-2 py-1 rounded border text-xs ${bulkBool[a.name] === false ? 'border-primary' : ''}`} onClick={() => setBulkBool({ ...bulkBool, [a.name]: false })}>No for selection</button>
                  <button className="px-2 py-1 rounded border text-xs" onClick={() => propose({ kind: 'attribute', proposed: { name: a.name, value: true }, source: 'owner' })}>Yes</button>
                  <button className="px-2 py-1 rounded border text-xs" onClick={() => propose({ kind: 'attribute', proposed: { name: a.name, value: false }, source: 'owner' })}>No</button>
                </>
              ) : (
                <>
                  <input className="border border-outline-variant rounded px-2 py-1 text-xs" placeholder={a.valueType === 'URL' ? 'https://' : 'Value'} value={attrValues[a.name] || ''} onChange={(e) => setAttrValues({ ...attrValues, [a.name]: e.target.value })} />
                  <button className="px-2 py-1 rounded border text-xs" onClick={() => propose({ kind: 'attribute', proposed: { name: a.name, value: attrValues[a.name] || '' }, source: 'owner' })}>Propose this one</button>
                </>
              )}
            </div>
          ))}
          {(recs.attributes?.suggestions || []).length > 0 && (
            <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={proposeSelectedAttributes}>Propose selected attributes</button>
          )}
          {(['appointment', 'menu', 'order'] as const).map((key) => {
            const link = recs.links?.attributes?.[key];
            if (!link?.name) return null;
            return (
              <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-28 capitalize">{key} link</span>
                <input className="border border-outline-variant rounded px-2 py-1 text-xs" placeholder="https://" value={attrValues[link.name] || ''} onChange={(e) => setAttrValues({ ...attrValues, [link.name]: e.target.value })} />
                <button className="px-2 py-1 rounded border text-xs" onClick={() => propose({ kind: 'attribute', proposed: { name: link.name, value: attrValues[link.name] || '' }, source: 'owner' })}>Propose {key} link</button>
              </div>
            );
          })}
          <p className="text-sm">Pin: {recs.pin?.status}. {recs.pin?.note}</p>
          {(recs.services?.items || []).length > 0 && (
            <div className="space-y-1">
              <p className="text-sm">Services ready to propose: {recs.services.items.map((s: any) => s.name).join(', ')}</p>
              <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={() => propose({ kind: 'services', proposed: { additions: recs.services.items.map((s: any) => ({ name: s.name, description: s.description })) }, source: 'recommendation' })}>Propose this service set</button>
            </div>
          )}
          {recs.services?.blocked && <p className="text-sm">{recs.services.reason}</p>}
        </section>
      )}

      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-3">
        <h2 className="font-heading font-bold">Hours</h2>
        <p className="text-xs text-on-surface-variant">A day you leave blank stays as it is on Google. Special hours are added only for the date you enter.</p>
        {DAYS.map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-28">{day}</span>
            <input type="time" className="border border-outline-variant rounded px-2 py-1" value={hours[day]?.open || ''} onChange={(e) => setHours({ ...hours, [day]: { open: e.target.value, close: hours[day]?.close || '' } })} />
            <input type="time" className="border border-outline-variant rounded px-2 py-1" value={hours[day]?.close || ''} onChange={(e) => setHours({ ...hours, [day]: { open: hours[day]?.open || '', close: e.target.value } })} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" className="border border-outline-variant rounded px-2 py-1" value={specialDate} onChange={(e) => setSpecialDate(e.target.value)} />
          <label className="flex items-center gap-1"><input type="checkbox" checked={specialClosed} onChange={(e) => setSpecialClosed(e.target.checked)} /> Closed</label>
        </div>
        <button
          className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold"
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
        <p className="text-sm">Holiday reminders: {recs?.hours?.note}</p>
        {Object.entries((recs?.hours?.reminders || []).reduce((groups: Record<string, string[]>, reminder: { date: string; name: string; covered: boolean }) => {
          if (reminder.covered) return groups;
          groups[reminder.date] = [...(groups[reminder.date] || []), reminder.name];
          return groups;
        }, {})).map(([date, names]) => (
          <div key={date} className="flex flex-wrap items-center gap-2 text-sm">
            <span>{date}: {(names as string[]).join(', ')}. This is a reminder, not a published hours change.</span>
            <button
              className="px-2 py-1 rounded border text-xs"
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
            >Propose closed on {date}</button>
          </div>
        ))}
      </section>

      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6 space-y-3">
        <h2 className="font-heading font-bold">Service area</h2>
        <p className="text-xs text-on-surface-variant">Only a service-area business can be updated. Enter one city or PIN per line. Unresolved lines are not written.</p>
        <p className="text-sm">Current type: {recs?.serviceArea?.businessType || 'unknown'}</p>
        <textarea rows={3} className="w-full border border-outline-variant rounded-lg px-3 py-2 text-sm" value={areaQuery} onChange={(e) => setAreaQuery(e.target.value)} placeholder="Nashik" />
        <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={resolveAreas}>Resolve places</button>
        {areaHits.map((p) => (
          <label key={p.placeId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pickedAreas.some((x) => x.placeId === p.placeId)} onChange={(e) => setPickedAreas(e.target.checked ? [...pickedAreas, p] : pickedAreas.filter((x) => x.placeId !== p.placeId))} />
            {p.placeName}{p.address ? ` — ${p.address}` : ''}
          </label>
        ))}
        {pickedAreas.length > 0 && (
          <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={() => propose({ kind: 'service_area', source: 'owner', proposed: { places: { placeInfos: pickedAreas } } })}>Propose {pickedAreas.length} area{pickedAreas.length === 1 ? '' : 's'}</button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold">Proposed changes</h2>
        {changes.length === 0 && <p className="text-sm text-on-surface-variant">No proposals yet.</p>}
        {changes.map((change) => {
          const review = validationReview(change.validation);
          const diff = wordDiff(proposalText(change.before), proposalText(change.proposed));
          const changed = diff.some((part) => part.type !== 'equal');
          return (
          <article key={change._id} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 space-y-3">
            <div className="flex justify-between gap-3">
              <p className="font-semibold text-sm">{change.kind} · {change.status}{change.sensitive ? ' · explicit approval' : ''}</p>
              <p className="text-xs text-on-surface-variant">{change.source}</p>
            </div>
            <dl className="grid sm:grid-cols-2 gap-2 text-xs text-on-surface-variant">
              <div><dt className="font-semibold text-on-surface">Proposal</dt><dd className="break-all">{change._id}</dd></div>
              <div><dt className="font-semibold text-on-surface">Idempotency key</dt><dd className="break-all">{change.clientRequestId || 'Not set'}</dd></div>
              <div><dt className="font-semibold text-on-surface">Business</dt><dd className="break-all">{change.businessId || 'Not recorded'}</dd></div>
              <div><dt className="font-semibold text-on-surface">Google location</dt><dd className="break-all">{change.locationId || 'Not recorded'}</dd></div>
            </dl>
            <div>
              <p className="text-xs font-semibold text-on-surface">Differences</p>
              <p className="text-xs text-on-surface-variant">Removed text is struck through. Added text is highlighted.</p>
              {!changed && <p className="text-xs text-on-surface-variant">No text was added or removed.</p>}
              <p className="whitespace-pre-wrap text-sm mt-1">
                {diff.map((part, index) => part.type === 'equal'
                  ? <span key={index}>{part.value}</span>
                  : part.type === 'insert'
                    ? <ins key={index} className="bg-primary-fixed text-primary no-underline">{part.value}</ins>
                    : <del key={index} className="text-error">{part.value}</del>)}
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-on-surface-variant">Current</p><pre className="whitespace-pre-wrap text-xs">{show(change.before)}</pre></div>
              <div><p className="text-xs text-on-surface-variant">Proposed</p><pre className="whitespace-pre-wrap text-xs">{show(change.proposed)}</pre></div>
            </div>
            {change.validation && review.passed ? <p className="text-xs text-on-surface">{VALIDATION_PASSED} {VALIDATION_LIMIT}</p> : null}
            {change.validation && !review.passed ? <p className="text-xs text-error">Validation did not pass. {VALIDATION_LIMIT}</p> : null}
            {!change.validation ? <p className="text-xs text-on-surface-variant">Validation was not recorded. {VALIDATION_LIMIT}</p> : null}
            {review.violations.map((message, index) => <p key={`violation-${index}`} className="text-xs text-error">{message}</p>)}
            {review.warnings.map((message, index) => <p key={`warning-${index}`} className="text-xs text-on-surface-variant">Warning: {message}</p>)}
            {change.error && <p className="text-xs text-error">{change.error}</p>}
            <div className="space-y-2">
              <p className="text-xs text-on-surface-variant">{APPROVAL_DOES_NOT_PUBLISH}</p>
              <p className="text-xs text-on-surface-variant">{APPLY_REQUIRES_BOTH_FLAGS}</p>
              {change.sensitive && <p className="text-xs font-semibold text-on-surface">{SENSITIVE_CONFIRM}</p>}
              <div className="flex flex-wrap gap-2">
                {change.status === 'PROPOSED' && (
                  change.sensitive ? (
                    confirmId === change._id ? (
                      <button className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold" onClick={() => act(change._id, 'approve', { confirmSensitive: true })}>Confirm this {change.kind} change</button>
                    ) : (
                      <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={() => setConfirmId(change._id)}>Review sensitive change</button>
                    )
                  ) : (
                    <button className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold" onClick={() => act(change._id, 'approve')}>Approve</button>
                  )
                )}
                {change.status === 'APPROVED' && (
                  <button className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold" onClick={() => act(change._id, 'execute')}>Apply to Google</button>
                )}
                {change.status === 'VERIFIED' && (
                  <button className="px-3 py-1.5 rounded-lg border border-outline text-xs font-bold" onClick={() => act(change._id, 'rollback')}>Roll back</button>
                )}
              </div>
            </div>
          </article>
          );
        })}
      </section>
    </div>
  );
}
