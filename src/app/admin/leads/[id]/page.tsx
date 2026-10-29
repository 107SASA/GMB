'use client';

/**
 * SuperAdmin — Lead detail.
 *
 * Everything the owner needs to answer "what is the AI doing with this lead,
 * and where is it in the funnel?" — profile, lead-intelligence, ownership,
 * the SalesConversation transcript, DemoBookings, pending scheduled actions,
 * and a chronological LeadEvent timeline (the existing event system — no new
 * one).
 *
 * Data: GET /api/admin/conversion/leads/:id
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, ArrowLeft, Bot, User, CheckCircle2, AlertTriangle } from 'lucide-react';
import { OwnershipBadge, ScoreBar, RelTime } from '@/components/admin/conversion/primitives';
import { LeadCrmPanel } from '@/components/admin/crm/LeadCrmPanel';
import { LeadActivityPanel } from '@/components/admin/crm/LeadActivityPanel';

interface Detail {
  lead: any;
  timeline: { type: string; payload: any; actor: string; actorName?: string | null; conversationType: string | null; at: string }[];
  conversation: any;
  conversations?: { type: string; label: string; status: string; followUpsSent?: number; messages: { role: string; text: string; at: string; by?: 'lead' | 'ai' | 'team' }[] }[];
  timelineTruncated?: boolean;
  demos: any[];
  pendingActions: { actionType: string; dueAt: string; createdBy: string; payload: any }[];
}

const EVENT_LABEL: Record<string, string> = {
  LEAD_CREATED: 'Lead created',
  MESSAGE_RECEIVED: 'Inbound message',
  MESSAGE_SENT: 'AI message sent',
  AGENT_HANDOFF: 'Agent handoff',
  INTENT_CHANGED: 'Intent changed',
  LEAD_SCORE_CHANGED: 'Lead score changed',
  OBJECTION_DETECTED: 'Objection detected',
  DEMO_REQUESTED: 'Demo requested',
  DEMO_SCHEDULED: 'Demo scheduled',
  DEMO_RESCHEDULED: 'Demo rescheduled',
  DEMO_CANCELLED: 'Demo cancelled',
  DEMO_COMPLETED: 'Demo completed',
  DEMO_NO_SHOW: 'Demo no-show',
  NURTURE_ACTION_SCHEDULED: 'Nurture step scheduled',
  NURTURE_ACTION_CANCELLED: 'Nurture step cancelled',
  NURTURE_ACTION_SKIPPED: 'Nurture step skipped',
  PAYMENT_SUCCESS: 'Payment successful',
  CUSTOMER_ACTIVATED: 'Customer activated',
  HUMAN_HANDOFF: 'Handed to human',
  OPT_OUT: 'Opted out',
  NBA_SELECTED: 'Next best action selected',
  NBA_EXECUTED: 'Next best action executed',
  NBA_OVERRIDDEN: 'AI suggestion overridden',
  NOTE_ADDED: 'Team note',
  LEAD_UPDATED: 'Details edited',
  STAGE_CHANGED: 'Stage changed',
  LEAD_IMPORTED: 'Imported from CSV',
  LEAD_CAPTURED: 'Came in again',
  CALL_LOGGED: 'Call logged',
  FOLLOW_UP_SCHEDULED: 'Follow-up scheduled',
  FOLLOW_UP_DONE: 'Follow-up done',
};

function eventTone(type: string): string {
  if (['HUMAN_HANDOFF', 'OPT_OUT', 'DEMO_NO_SHOW', 'DEMO_CANCELLED'].includes(type)) return 'bg-error';
  if (['CUSTOMER_ACTIVATED', 'PAYMENT_SUCCESS', 'DEMO_COMPLETED', 'DEMO_SCHEDULED'].includes(type)) return 'bg-secondary';
  if (['INTENT_CHANGED', 'LEAD_SCORE_CHANGED', 'NBA_SELECTED', 'NBA_EXECUTED'].includes(type)) return 'bg-primary';
  return 'bg-outline';
}

/** "trial_active" → "Free trial · ends 5 Nov" — readable billing state. */
function workspaceBillingText(b: { subscriptionStatus?: string | null; trialEndsAt?: string | null; trialCancelledAt?: string | null }): string {
  const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  switch (b.subscriptionStatus) {
    case 'active': return 'Paid';
    case 'trial_active':
      return b.trialCancelledAt ? `Free trial (cancelled) · ends ${date(b.trialEndsAt)}` : `Free trial · ends ${date(b.trialEndsAt)}`;
    case 'past_due': return 'Payment failed';
    case 'canceled': return 'Cancelled';
    default: return 'Not subscribed';
  }
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnMsg, setReturnMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [convoTab, setConvoTab] = useState<string | null>(null);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetch('/api/admin/inbox/team').then((r) => r.json()).then((j) => setTeam(j?.team ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/conversion/leads/${params.id}`);
      const json = await res.json().catch(() => null);
      if (json?.success) { setD(json); setErr(null); }
      else setErr(json?.error || `Failed to load (${res.status})`);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const returnToAI = async () => {
    if (!d) return;
    setReturning(true);
    setReturnMsg(null);
    try {
      // Reuse the existing generic release endpoint — no new mutation path.
      const res = await fetch('/api/admin/leads/return-to-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: params.id, targetAgent: 'SALES' }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setReturnMsg({ ok: true, text: 'Returned to the Sales agent.' });
        await load();
      } else {
        setReturnMsg({ ok: false, text: json?.error || `Could not return this lead to the AI (${res.status}).` });
      }
    } catch (e: any) {
      setReturnMsg({ ok: false, text: e?.message || 'Could not return this lead to the AI.' });
    } finally {
      setReturning(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (err || !d) return <div className="p-8 text-center text-error">{err || 'Not found'}</div>;

  const l = d.lead;

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/admin/leads" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary">
        <ArrowLeft className="w-4 h-4" /> Back to pipeline
      </Link>

      {/* Header */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-xl font-bold text-on-surface">{l.displayName || l.name || l.phone || 'Lead'}</h1>
              <OwnershipBadge ownership={l.isCustomer ? 'CUSTOMER' : l.currentAgent === 'HUMAN' ? 'HUMAN' : 'AI'} />
            </div>
            <p className="text-sm text-on-surface-variant mt-0.5">
              {l.phone || '—'}{l.email ? ` · ${l.email}` : ''}{l.businessName ? ` · ${l.businessName}` : ''}
            </p>
            <p className="text-xs text-outline mt-1">
              {l.source ? `Source: ${l.source} · ` : ''}Created <RelTime date={l.createdAt} />
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-primary-fixed text-primary">{l.funnelStage}</span>
          </div>
        </div>

        {/* Human handoff banner */}
        {(l.humanHandoff?.active || l.currentAgent === 'HUMAN') && (
          <div className="mt-4 flex items-start gap-2 bg-warning/15 border border-warning/40 rounded-lg px-3 py-2.5 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning-text" />
            <div className="flex-1">
              <p className="font-semibold text-warning-text">Human-owned — AI is paused</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Reason: {l.humanHandoff?.reason || 'unspecified'}{l.humanHandoff?.since ? <> · since <RelTime date={l.humanHandoff.since} /></> : null}.
                {' '}AI does not resume automatically.
              </p>
            </div>
            <button
              onClick={returnToAI}
              disabled={returning}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-container disabled:opacity-60 shrink-0"
            >
              {returning ? 'Returning…' : 'Return to AI'}
            </button>
          </div>
        )}
        {returnMsg && (
          <p role="status" className={`mt-3 text-xs font-medium ${returnMsg.ok ? 'text-secondary' : 'text-error'}`}>{returnMsg.text}</p>
        )}
      </div>

      {(l.captureSources || []).length > 0 && (
        <p className="text-xs text-on-surface-variant -mt-2">
          Came in through: {(l.captureSources as string[]).map((s) => <span key={s} className="ml-1 px-1.5 py-0.5 rounded bg-surface-container">{s}</span>)}
        </p>
      )}
      <LeadCrmPanel
        lead={l}
        onSaved={load}
        notes={[...d.timeline].reverse().filter((e) => e.type === 'NOTE_ADDED').map((e) => ({ text: e.payload?.text || '', at: e.at, by: e.actorName ?? null }))}
      />
      <LeadActivityPanel
        leadId={l._id}
        team={team}
        onChanged={load}
        calls={[...d.timeline].reverse().filter((e) => e.type === 'CALL_LOGGED').map((e) => ({ at: e.at, payload: e.payload, actorName: e.actorName }))}
      />

      {/* Intelligence + state grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel title="Lead intelligence">
          <Field label="Behavioural score"><ScoreBar score={l.leadScore} /></Field>
          <Field label="Score band">{l.scoreBand || '—'}</Field>
          <Field label="AI qualification score">{l.aiLeadScore != null ? `${l.aiLeadScore}/100` : '—'}</Field>
          <Field label="Intent">{l.intent || '—'}</Field>
          <Field label="Buying signals">
            {l.buyingSignals?.length ? (
              <ul className="text-xs space-y-0.5">
                {l.buyingSignals.map((s: any, i: number) => (
                  <li key={i}>
                    <span className="font-medium">{s.type}</span>{s.note ? ` — ${s.note}` : ''}
                  </li>
                ))}
              </ul>
            ) : '—'}
          </Field>
          <Field label="Pain points">
            {l.painPoints?.length ? (
              <ul className="list-disc list-inside text-xs space-y-0.5">{l.painPoints.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
            ) : '—'}
          </Field>
          <Field label="Objections">
            {l.objections?.length ? (
              <ul className="text-xs space-y-0.5">
                {l.objections.map((o: any, i: number) => (
                  <li key={i} className={o.resolved ? 'text-outline line-through' : ''}>
                    <span className="font-medium">{o.type}</span>{o.note ? ` — ${o.note}` : ''}
                  </li>
                ))}
              </ul>
            ) : '—'}
          </Field>
        </Panel>

        <Panel title="Engine state">
          <Field label="Current agent">{l.currentAgent}</Field>
          <Field label="Current stage">{l.currentStage}</Field>
          <Field label="Nurture status">
            <span className={l.nurtureStatus === 'OPTED_OUT' ? 'text-error font-medium' : ''}>{l.nurtureStatus}</span>
          </Field>
          <Field label="Next best action">{l.nextBestAction || '—'}</Field>
          <Field label="Next action at">{l.nextActionAt ? <RelTime date={l.nextActionAt} /> : '—'}</Field>
        </Panel>

        <Panel title="Business profile">
          {l.businessProfile && (l.businessProfile.industry || l.businessProfile.businessType || l.businessProfile.interestedServices?.length) ? (
            <>
              <Field label="Industry">{l.businessProfile.industry || '—'}</Field>
              <Field label="Business type">{l.businessProfile.businessType || '—'}</Field>
              <Field label="Goals">{(l.businessProfile.goals || []).join(', ') || '—'}</Field>
              <Field label="Interested services">{(l.businessProfile.interestedServices || []).join(', ') || '—'}</Field>
            </>
          ) : (
            <p className="text-xs text-outline">Not yet extracted from the conversation.</p>
          )}
          {l.business && (
            <Field label="Workspace billing">{workspaceBillingText(l.business)}</Field>
          )}
          {l.auditId && <Field label="Linked audit">{l.auditId}</Field>}
        </Panel>
      </div>

      {/* Last analysis from LeadEvent (NBA_SELECTED / LEAD_SCORE_CHANGED) */}
      {(() => {
        const lastAnalysis = [...(d.timeline || [])]
          .reverse()
          .find((e) => e.type === 'NBA_SELECTED' || e.type === 'LEAD_SCORE_CHANGED');
        if (!lastAnalysis) return null;
        return (
          <Panel title="Last analysis">
            <Field label="Event">{EVENT_LABEL[lastAnalysis.type] || lastAnalysis.type}</Field>
            <Field label="When"><RelTime date={lastAnalysis.at} /></Field>
            <Field label="Detail">
              <pre className="text-[11px] whitespace-pre-wrap text-on-surface-variant max-h-28 overflow-auto">
                {JSON.stringify(lastAnalysis.payload ?? {}, null, 2)}
              </pre>
            </Field>
          </Panel>
        );
      })()}

      {/* Pending scheduled actions */}
      {d.pendingActions.length > 0 && (
        <Panel title={`Pending scheduled actions (${d.pendingActions.length})`}>
          <ul className="text-xs space-y-1">
            {d.pendingActions.map((a, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="font-medium">{a.actionType}</span>
                <span className="text-on-surface-variant">due <RelTime date={a.dueAt} /> · {a.createdBy}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Demos */}
      {d.demos.length > 0 && (
        <Panel title="Demos">
          <ul className="divide-y divide-outline-variant text-sm">
            {d.demos.map((dm) => (
              <li key={dm._id} className="py-2 flex items-center justify-between">
                <div>
                  <span className="font-medium text-on-surface">{dm.date} · {dm.timeSlot}</span>
                  <span className="text-xs text-on-surface-variant ml-2">{dm.channel}</span>
                  {dm.timezone && <span className="text-xs text-on-surface-variant ml-2">{dm.timezone}</span>}
                  {dm.googleEmail && <span className="text-xs text-on-surface-variant ml-2">{dm.googleEmail}</span>}
                  {dm.meetingLink && <a href={dm.meetingLink} target="_blank" rel="noreferrer" className="text-xs text-primary ml-2 underline">Google Meet</a>}
                  {dm.calendarEventId && <span className="text-xs text-outline ml-2">event {dm.calendarEventId}</span>}
                  {!dm.calendarEventId && <span className="text-xs text-outline ml-2">(calendar not linked)</span>}
                  {Array.isArray(dm.reminderActionIds) && dm.reminderActionIds.length > 0 && (
                    <span className="text-xs text-outline ml-2">{dm.reminderActionIds.length} reminders</span>
                  )}
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant">{dm.status}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversations — every agent that has talked to this lead */}
        {(() => {
          const convos = d.conversations ?? (d.conversation ? [{ type: 'sales', label: 'Sales agent', ...d.conversation }] : []);
          const active = convos.find((c) => c.type === convoTab) ?? convos[0];
          return (
            <Panel title="Conversations" subtitle={active ? `${active.label} · ${active.status}${active.type === 'sales' && active.followUpsSent != null ? ` · ${active.followUpsSent} follow-ups sent` : ''}` : undefined}>
              {convos.length === 0 ? (
                <p className="text-xs text-outline">No agent conversation on record.</p>
              ) : (
                <>
                  {convos.length > 1 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {convos.map((c) => (
                        <button key={c.type} onClick={() => setConvoTab(c.type)} className={`text-xs px-2 py-1 rounded-md ${c.type === active?.type ? 'bg-primary text-white' : 'bg-surface-container text-on-surface-variant'}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {active!.messages.length === 0 && <p className="text-xs text-outline">No messages yet.</p>}
                    {active!.messages.map((m: any, i: number) => (
                      <div key={i} className={`flex ${m.role === 'lead' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${m.role === 'lead' ? 'bg-surface-container text-on-surface' : m.by === 'team' ? 'bg-secondary-container/40 text-on-secondary-container' : 'bg-primary-fixed text-primary'}`}>
                          <div className="flex items-center gap-1 mb-0.5 opacity-70">
                            {m.role === 'lead' || m.by === 'team' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                            <span>{m.role === 'lead' ? (l.displayName || 'Lead') : m.by === 'team' ? 'Team' : 'AI'}</span>
                            <span>· {new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{m.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          );
        })()}

        {/* Timeline */}
        <Panel title="Timeline" subtitle={d.timelineTruncated ? `latest ${d.timeline.length} events — older ones not shown` : `${d.timeline.length} events`}>
          <ol className="relative border-l border-outline-variant ml-1.5 space-y-3 max-h-96 overflow-y-auto pr-1">
            {d.timeline.length === 0 && <li className="text-xs text-outline ml-4">No events yet.</li>}
            {d.timeline.map((e, i) => (
              <li key={i} className="ml-4">
                <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${eventTone(e.type)} ring-2 ring-surface-container-lowest`} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-on-surface">{EVENT_LABEL[e.type] || e.type}</span>
                  <RelTime date={e.at} />
                </div>
                <p className="text-[11px] text-on-surface-variant">
                  {e.actorName || e.actor}
                  {e.payload && renderPayload(e.type, e.payload)}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function renderPayload(type: string, p: any): string {
  try {
    if (type === 'INTENT_CHANGED') return ` · ${p.from} → ${p.to}`;
    if (type === 'LEAD_SCORE_CHANGED') return ` · ${p.from} → ${p.to} (${p.signal})`;
    if (type === 'AGENT_HANDOFF') return ` · ${p.from} → ${p.to}${p.reason ? ` (${p.reason})` : ''}`;
    if (type === 'HUMAN_HANDOFF') return p.reason ? ` · ${p.reason}${p.detail ? ` — ${p.detail}` : ''}` : '';
    if (type === 'NBA_SELECTED' || type === 'NBA_EXECUTED') return ` · ${p.action}${p.outcome ? ` → ${p.outcome}` : ''}`;
    if (type === 'NBA_OVERRIDDEN') return ` · ${p.suggested} → ${p.used} (${p.reason})`;
    if (type === 'NURTURE_ACTION_SKIPPED') return p.reason ? ` · ${p.reason}` : '';
    if (type === 'OPT_OUT') return p.reason ? ` · ${p.reason}` : '';
    if (type === 'MESSAGE_SENT') return p.nbaAction ? ` · ${p.nbaAction}` : '';
    if (type === 'STAGE_CHANGED') return ` · ${p.from} → ${p.to}${p.reason ? ` (${p.reason})` : ''}`;
    if (type === 'LEAD_UPDATED') return Array.isArray(p.fields) ? ` · ${p.fields.join(', ')}${p.via ? ` (${p.via})` : ''}` : '';
    if (type === 'NOTE_ADDED') return p.text ? ` · ${String(p.text).slice(0, 120)}` : '';
    if (type === 'LEAD_CAPTURED' || type === 'LEAD_CREATED') return p.source || p.channel ? ` · ${p.source || p.channel}` : '';
    if (type === 'CALL_LOGGED') return ` · ${p.direction === 'inbound' ? 'they called' : 'we called'} — ${p.outcomeLabel || p.outcome}`;
    if (type === 'FOLLOW_UP_SCHEDULED') return ` · ${p.type} ${p.dueAt ? new Date(p.dueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}`;
  } catch {
    /* ignore */
  }
  return '';
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4">
      <div className="mb-3">
        <h2 className="font-semibold text-sm text-on-surface">{title}</h2>
        {subtitle && <p className="text-xs text-outline">{subtitle}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-on-surface-variant text-xs shrink-0 pt-0.5">{label}</span>
      <span className="text-on-surface text-right">{children}</span>
    </div>
  );
}
