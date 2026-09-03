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

interface Detail {
  lead: any;
  timeline: { type: string; payload: any; actor: string; conversationType: string | null; at: string }[];
  conversation: any;
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
};

function eventTone(type: string): string {
  if (['HUMAN_HANDOFF', 'OPT_OUT', 'DEMO_NO_SHOW', 'DEMO_CANCELLED'].includes(type)) return 'bg-error';
  if (['CUSTOMER_ACTIVATED', 'PAYMENT_SUCCESS', 'DEMO_COMPLETED', 'DEMO_SCHEDULED'].includes(type)) return 'bg-secondary';
  if (['INTENT_CHANGED', 'LEAD_SCORE_CHANGED', 'NBA_SELECTED', 'NBA_EXECUTED'].includes(type)) return 'bg-primary';
  return 'bg-outline';
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/conversion/leads/${params.id}`);
      const json = await res.json();
      if (json.success) setD(json);
      else setErr(json.error || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const returnToAI = async () => {
    if (!d) return;
    setReturning(true);
    try {
      // Reuse the existing generic release endpoint — no new mutation path.
      const res = await fetch('/api/admin/leads/return-to-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: params.id, targetAgent: 'SALES', resumeStage: 'NURTURING' }),
      });
      if (res.ok) await load();
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
              <h1 className="font-heading text-xl font-bold text-on-surface">{l.name || l.phone || 'Lead'}</h1>
              <OwnershipBadge ownership={l.isCustomer ? 'CUSTOMER' : l.currentAgent === 'HUMAN' ? 'HUMAN' : 'AI'} />
            </div>
            <p className="text-sm text-on-surface-variant mt-0.5">
              {l.phone || '—'}{l.email ? ` · ${l.email}` : ''}{l.business ? ` · ${l.business.name}` : ''}
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
        {l.humanHandoff?.active && (
          <div className="mt-4 flex items-start gap-2 bg-warning/15 border border-warning/40 rounded-lg px-3 py-2.5 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning-text" />
            <div className="flex-1">
              <p className="font-semibold text-warning-text">Human-owned — AI is paused</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Reason: {l.humanHandoff.reason || 'unspecified'} · since <RelTime date={l.humanHandoff.since} />.
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
      </div>

      {/* Intelligence + state grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel title="Lead intelligence">
          <Field label="Behavioural score"><ScoreBar score={l.leadScore} /></Field>
          <Field label="AI qualification score">{l.aiLeadScore != null ? `${l.aiLeadScore}/100` : '—'}</Field>
          <Field label="Intent">{l.intent || '—'}</Field>
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
          {l.businessProfile && (l.businessProfile.industry || l.businessProfile.businessType) ? (
            <>
              <Field label="Industry">{l.businessProfile.industry || '—'}</Field>
              <Field label="Business type">{l.businessProfile.businessType || '—'}</Field>
              <Field label="Goals">{(l.businessProfile.goals || []).join(', ') || '—'}</Field>
            </>
          ) : (
            <p className="text-xs text-outline">Not yet extracted from the conversation.</p>
          )}
          {l.business && (
            <Field label="Workspace billing">{l.business.subscriptionStatus || '—'}</Field>
          )}
        </Panel>
      </div>

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
                  {dm.meetingLink && <a href={dm.meetingLink} target="_blank" rel="noreferrer" className="text-xs text-primary ml-2 underline">meeting link</a>}
                  {!dm.calendarEventId && <span className="text-xs text-outline ml-2">(calendar not linked)</span>}
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant">{dm.status}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversation */}
        <Panel title="Sales conversation" subtitle={d.conversation ? `${d.conversation.status} · ${d.conversation.followUpsSent} follow-ups sent` : undefined}>
          {!d.conversation ? (
            <p className="text-xs text-outline">No sales conversation on record.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {d.conversation.messages.length === 0 && <p className="text-xs text-outline">No messages yet.</p>}
              {d.conversation.messages.map((m: any, i: number) => (
                <div key={i} className={`flex ${m.role === 'lead' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${m.role === 'lead' ? 'bg-surface-container text-on-surface' : 'bg-primary-fixed text-primary'}`}>
                    <div className="flex items-center gap-1 mb-0.5 opacity-70">
                      {m.role === 'lead' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                      <span>{m.role === 'lead' ? 'Lead' : 'AI'}</span>
                      <span>· {new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Timeline */}
        <Panel title="Timeline" subtitle={`${d.timeline.length} events`}>
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
                  {e.actor}
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
    if (type === 'HUMAN_HANDOFF') return p.reason ? ` · ${p.reason}` : '';
    if (type === 'NBA_SELECTED' || type === 'NBA_EXECUTED') return ` · ${p.action}${p.outcome ? ` → ${p.outcome}` : ''}`;
    if (type === 'NBA_OVERRIDDEN') return ` · ${p.suggested} → ${p.used} (${p.reason})`;
    if (type === 'NURTURE_ACTION_SKIPPED') return p.reason ? ` · ${p.reason}` : '';
    if (type === 'OPT_OUT') return p.reason ? ` · ${p.reason}` : '';
    if (type === 'MESSAGE_SENT') return p.nbaAction ? ` · ${p.nbaAction}` : '';
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
