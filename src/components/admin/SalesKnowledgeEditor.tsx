'use client';

/**
 * Structured editor for SalesAgentConfig.knowledge — the approved business
 * knowledge the Sales Agent grounds every reply in.
 *
 * It edits a working COPY passed down from the parent page; "Save" is the
 * parent's single Save button (the whole config, knowledge included, goes to
 * PUT /api/admin/sales-agent). This component only owns the editing widgets
 * + a local "Reset section to defaults" that swaps in `defaultKnowledge`
 * (served by the GET route).
 *
 * No raw-JSON editing — every field is a real input, textarea, or a
 * add/remove list. `useCases` is edited as structured cards; a legacy
 * plain-string use case (from an older config) is shown in its `solution`
 * field so nothing is lost.
 */

import { useState } from 'react';
import { Plus, Trash2, RotateCcw, AlertTriangle, ChevronDown } from 'lucide-react';

export interface SalesUseCaseForm {
  name?: string;
  problem?: string;
  solution?: string;
  benefit?: string;
  idealCustomer?: string;
  recommendedNextAction?: string;
}

export interface KnowledgeShape {
  businessOverview?: string;
  idealCustomerProfile?: string;
  targetCustomers?: string[];
  customerProblems?: string[];
  services?: { name: string; description: string }[];
  useCases?: (string | SalesUseCaseForm)[];
  faqs?: { q: string; a: string }[];
  educationPoints?: string[];
  objectionResponses?: Partial<Record<'PRICE' | 'DECISION_MAKER' | 'TIMING' | 'TRUST' | 'FEATURE_GAP' | 'OTHER', string>>;
  pricingResponse?: string;
  demoExplanation?: string;
  subscriptionExplanation?: string;
  limitations?: string[];
  escalationRules?: string;
}

const input =
  'w-full px-3 py-2 rounded-lg border border-outline-variant focus:ring-2 focus:ring-primary focus:border-primary text-sm bg-surface-container-lowest';
const area = `${input} leading-relaxed`;
const label = 'text-sm font-semibold text-on-surface';
const hint = 'text-xs text-on-surface-variant mt-0.5';

const OBJECTION_TYPES: { key: keyof NonNullable<KnowledgeShape['objectionResponses']>; label: string }[] = [
  { key: 'PRICE', label: 'Price / too expensive' },
  { key: 'DECISION_MAKER', label: 'Need to discuss with team' },
  { key: 'TIMING', label: 'Not the right time' },
  { key: 'TRUST', label: 'Trust / "we already have something"' },
  { key: 'FEATURE_GAP', label: 'Missing a feature they need' },
  { key: 'OTHER', label: 'Other' },
];

function Section({
  title,
  desc,
  children,
  onReset,
  defaultOpen = true,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  onReset?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border border-outline-variant rounded-xl bg-surface-container-lowest">
      <div className="flex items-center justify-between p-4">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
          <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${open ? '' : '-rotate-90'}`} />
          <div>
            <h3 className="font-bold text-on-surface text-sm">{title}</h3>
            {desc && <p className={hint}>{desc}</p>}
          </div>
        </button>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-xs font-medium text-on-surface-variant hover:text-primary shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset section
          </button>
        )}
      </div>
      {open && <div className="p-4 pt-0 space-y-3">{children}</div>}
    </section>
  );
}

/** Simple add/remove string list. */
function StringList({
  items,
  onChange,
  placeholder,
  textarea = false,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  textarea?: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex gap-2">
          {textarea ? (
            <textarea
              rows={2}
              className={area}
              value={v}
              placeholder={placeholder}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ) : (
            <input
              className={input}
              value={v}
              placeholder={placeholder}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
          )}
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="p-2 text-outline hover:text-error shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="flex items-center gap-1 text-sm font-semibold text-primary"
      >
        <Plus className="w-4 h-4" /> Add
      </button>
    </div>
  );
}

export function SalesKnowledgeEditor({
  value,
  onChange,
  defaults,
}: {
  value: KnowledgeShape;
  onChange: (next: KnowledgeShape) => void;
  defaults: KnowledgeShape;
}) {
  const k = value || {};
  const set = <K extends keyof KnowledgeShape>(key: K, v: KnowledgeShape[K]) => onChange({ ...k, [key]: v });
  const resetField = (key: keyof KnowledgeShape) => onChange({ ...k, [key]: (defaults as any)[key] });

  const useCases: SalesUseCaseForm[] = (k.useCases || []).map((u) =>
    typeof u === 'string' ? { solution: u } : u
  );
  const setUseCase = (i: number, patch: Partial<SalesUseCaseForm>) =>
    set(
      'useCases',
      useCases.map((u, j) => (j === i ? { ...u, ...patch } : u))
    );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-error-container/40 border border-error-container rounded-xl px-4 py-3 text-xs text-on-error-container">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          Only enter <strong>approved</strong> business information. The agent conveys everything here as fact and is
          told never to invent a price, feature, integration, guarantee, statistic, or customer number that isn&apos;t
          written here. Pricing and per-objection responses are empty by default on purpose — fill them in only with
          wording you&apos;ve approved.
        </div>
      </div>

      <Section
        title="Business overview"
        desc="2–4 sentences: what GrowwMatics is, who it's for, the problem it solves."
        onReset={() => resetField('businessOverview')}
      >
        <textarea
          rows={4}
          className={area}
          value={k.businessOverview ?? ''}
          onChange={(e) => set('businessOverview', e.target.value)}
        />
      </Section>

      <Section
        title="Ideal customer profile"
        desc="Business type/size, good-fit and poor-fit signals."
        onReset={() => resetField('idealCustomerProfile')}
      >
        <textarea
          rows={4}
          className={area}
          value={k.idealCustomerProfile ?? ''}
          onChange={(e) => set('idealCustomerProfile', e.target.value)}
        />
        <label className={label}>Target customer segments</label>
        <StringList
          items={k.targetCustomers ?? []}
          onChange={(v) => set('targetCustomers', v)}
          placeholder="e.g. Dental clinics"
        />
      </Section>

      <Section
        title="Customer problems"
        desc="Common problems GrowwMatics addresses — one short phrase each."
        onReset={() => resetField('customerProblems')}
      >
        <StringList
          items={k.customerProblems ?? []}
          onChange={(v) => set('customerProblems', v)}
          placeholder="e.g. Inbound WhatsApp leads go cold before anyone replies"
          textarea
        />
      </Section>

      <Section
        title="Services / offerings"
        desc="The 'what we offer' catalogue — name + one line each."
        onReset={() => resetField('services')}
      >
        <div className="space-y-2">
          {(k.services ?? []).map((s, i) => (
            <div key={i} className="border border-outline-variant rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  className={input}
                  value={s.name}
                  placeholder="Service name"
                  onChange={(e) =>
                    set(
                      'services',
                      (k.services ?? []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => set('services', (k.services ?? []).filter((_, j) => j !== i))}
                  className="p-2 text-outline hover:text-error shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <textarea
                rows={2}
                className={area}
                value={s.description}
                placeholder="What it does (and what it isn't)"
                onChange={(e) =>
                  set(
                    'services',
                    (k.services ?? []).map((x, j) => (j === i ? { ...x, description: e.target.value } : x))
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('services', [...(k.services ?? []), { name: '', description: '' }])}
            className="flex items-center gap-1 text-sm font-semibold text-primary"
          >
            <Plus className="w-4 h-4" /> Add service
          </button>
        </div>
      </Section>

      <Section
        title="Use cases"
        desc="Problem → solution → benefit narratives the agent picks from."
        onReset={() => resetField('useCases')}
      >
        <div className="space-y-3">
          {useCases.map((u, i) => (
            <div key={i} className="border border-outline-variant rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  className={input}
                  value={u.name ?? ''}
                  placeholder="Use case name"
                  onChange={(e) => setUseCase(i, { name: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => set('useCases', useCases.filter((_, j) => j !== i))}
                  className="p-2 text-outline hover:text-error shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <textarea rows={2} className={area} value={u.problem ?? ''} placeholder="Problem" onChange={(e) => setUseCase(i, { problem: e.target.value })} />
                <textarea rows={2} className={area} value={u.solution ?? ''} placeholder="Solution (how GrowwMatics solves it)" onChange={(e) => setUseCase(i, { solution: e.target.value })} />
                <textarea rows={2} className={area} value={u.benefit ?? ''} placeholder="Benefit" onChange={(e) => setUseCase(i, { benefit: e.target.value })} />
                <input className={input} value={u.idealCustomer ?? ''} placeholder="Ideal customer" onChange={(e) => setUseCase(i, { idealCustomer: e.target.value })} />
              </div>
              <input className={input} value={u.recommendedNextAction ?? ''} placeholder="Recommended next step (hint for the agent)" onChange={(e) => setUseCase(i, { recommendedNextAction: e.target.value })} />
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('useCases', [...useCases, {}])}
            className="flex items-center gap-1 text-sm font-semibold text-primary"
          >
            <Plus className="w-4 h-4" /> Add use case
          </button>
        </div>
      </Section>

      <Section title="FAQs" desc="Approved question → answer pairs. Unknown questions get a safe 'I'll confirm that' fallback." onReset={() => resetField('faqs')}>
        <div className="space-y-2">
          {(k.faqs ?? []).map((f, i) => (
            <div key={i} className="border border-outline-variant rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  className={input}
                  value={f.q}
                  placeholder="Question"
                  onChange={(e) => set('faqs', (k.faqs ?? []).map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
                />
                <button
                  type="button"
                  onClick={() => set('faqs', (k.faqs ?? []).filter((_, j) => j !== i))}
                  className="p-2 text-outline hover:text-error shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <textarea
                rows={2}
                className={area}
                value={f.a}
                placeholder="Approved answer"
                onChange={(e) => set('faqs', (k.faqs ?? []).map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('faqs', [...(k.faqs ?? []), { q: '', a: '' }])}
            className="flex items-center gap-1 text-sm font-semibold text-primary"
          >
            <Plus className="w-4 h-4" /> Add FAQ
          </button>
        </div>
      </Section>

      <Section title="Education points" desc="Short truths the agent can teach a lead, in its own words." onReset={() => resetField('educationPoints')}>
        <StringList
          items={k.educationPoints ?? []}
          onChange={(v) => set('educationPoints', v)}
          placeholder="e.g. Replying to reviews signals to Google that the business is active"
          textarea
        />
      </Section>

      <Section title="Objection responses" desc="Optional approved wording per objection type. Empty = the agent acknowledges honestly without a scripted rebuttal." onReset={() => resetField('objectionResponses')}>
        {OBJECTION_TYPES.map((o) => (
          <div key={o.key}>
            <label className={label}>{o.label}</label>
            <textarea
              rows={2}
              className={area}
              value={k.objectionResponses?.[o.key] ?? ''}
              onChange={(e) => set('objectionResponses', { ...(k.objectionResponses ?? {}), [o.key]: e.target.value })}
            />
          </div>
        ))}
      </Section>

      <Section title="Pricing response" desc="Exact wording sent when a lead asks about price. LEAVE EMPTY unless you have approved pricing copy — the agent then says it will confirm pricing instead of guessing." onReset={() => resetField('pricingResponse')}>
        <textarea
          rows={3}
          className={area}
          value={k.pricingResponse ?? ''}
          placeholder="(empty — the agent will not state a price)"
          onChange={(e) => set('pricingResponse', e.target.value)}
        />
        <p className={hint}>Supports {'{{name}}'}, {'{{subscribeUrl}}'}, {'{{shopUrl}}'}.</p>
      </Section>

      <Section title="Demo explanation" desc="What a demo is and when it's offered." onReset={() => resetField('demoExplanation')}>
        <textarea rows={3} className={area} value={k.demoExplanation ?? ''} onChange={(e) => set('demoExplanation', e.target.value)} />
      </Section>

      <Section title="Subscription explanation" desc="How subscribing / getting started works." onReset={() => resetField('subscriptionExplanation')}>
        <textarea rows={3} className={area} value={k.subscriptionExplanation ?? ''} onChange={(e) => set('subscriptionExplanation', e.target.value)} />
      </Section>

      <Section title="Limitations" desc="Honest statements of what GrowwMatics does NOT do." onReset={() => resetField('limitations')}>
        <StringList items={k.limitations ?? []} onChange={(v) => set('limitations', v)} placeholder="e.g. Does not run Google or Meta ads" />
      </Section>

      <Section title="Escalation guidance" desc="When the agent should hand a lead to a human (advisory — deterministic handoff triggers are unaffected)." onReset={() => resetField('escalationRules')}>
        <textarea rows={3} className={area} value={k.escalationRules ?? ''} onChange={(e) => set('escalationRules', e.target.value)} />
      </Section>
    </div>
  );
}
