'use client';

import { useEffect, useState, useCallback } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface SeoPlan {
  version: number;
  status: string;
  activeFrom: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  cityAreaTerms: string[];
  suggestedTitle?: string;
  suggestedDescription?: string;
  suggestedServices: string[];
  suggestedCategories: string[];
  suggestedQas: Array<{ q: string; a: string }>;
  uspLine?: string;
  reviewReplyMustInclude: string[];
  postThemes: Array<{ weekday: string; theme: string; keyword: string; postType: string }>;
  keyFinding?: string;
  marketOpportunities: Array<{ keyword: string; potential: string; rationale: string }>;
  actionPhases: Array<{ label: string; window: string; items: Array<{ title: string; detail: string; priority: string }> }>;
  baseline: Array<{ avgRank?: number; reviewCount?: number; rating?: number; completionPct?: number; capturedAt: string }>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-6">
      <h2 className="font-heading text-base font-bold text-on-surface mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Chips({ items, tone = 'primary' }: { items: string[]; tone?: 'primary' | 'muted' }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((s, i) => (
        <span
          key={i}
          className={`text-xs px-2 py-1 rounded ${tone === 'primary' ? 'bg-primary-fixed text-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

export default function SeoPlanPage() {
  const [plan, setPlan] = useState<SeoPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/seo-plan');
      const json = await res.json();
      setPlan(json.plan || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const applyToGoogle = async () => {
    setApplying(true);
    setApplyMsg(null);
    try {
      const res = await fetch('/api/seo-plan/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const json = await res.json();
      setApplyMsg(json.reason || (json.success ? 'Applied.' : 'Could not apply.'));
    } catch {
      setApplyMsg('Network error — please try again.');
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <MaterialIcon name="progress_activity" size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="font-heading text-xl font-bold text-on-surface mb-2">SEO Plan</h1>
        <p className="text-on-surface-variant text-sm">
          Your SEO plan is created from your first audit. Run an audit from the Audit Engine, or complete onboarding intake, and it will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-on-surface">SEO Plan</h1>
        <p className="text-xs text-on-surface-variant mt-1">
          Version {plan.version} · active since {new Date(plan.activeFrom).toLocaleDateString()} · this is the single plan your posts, review replies, and monthly re-audit all read from.
        </p>
      </div>

      {plan.keyFinding && (
        <Card title="Key Finding">
          <p className="text-sm text-on-surface leading-relaxed">{plan.keyFinding}</p>
        </Card>
      )}

      {plan.uspLine && (
        <Card title="Your USP (leads posts & review replies)">
          <p className="text-sm text-on-surface">{plan.uspLine}</p>
          {plan.reviewReplyMustInclude.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-on-surface-variant mb-1.5">Review replies try to mention:</p>
              <Chips items={plan.reviewReplyMustInclude} tone="muted" />
            </div>
          )}
        </Card>
      )}

      <Card title="Target keywords">
        <p className="text-xs text-on-surface-variant mb-1.5">Primary</p>
        <Chips items={plan.primaryKeywords} />
        {plan.cityAreaTerms.length > 0 && (
          <>
            <p className="text-xs text-on-surface-variant mb-1.5 mt-3">Areas</p>
            <Chips items={plan.cityAreaTerms} tone="muted" />
          </>
        )}
      </Card>

      {(plan.suggestedTitle || plan.suggestedDescription) && (
        <Card title="Listing drafts">
          {plan.suggestedTitle && (
            <div className="mb-3">
              <p className="text-xs text-on-surface-variant">Suggested title</p>
              <p className="text-sm font-medium text-on-surface">{plan.suggestedTitle}</p>
            </div>
          )}
          {plan.suggestedDescription && (
            <div className="mb-4">
              <p className="text-xs text-on-surface-variant">Suggested description</p>
              <p className="text-sm text-on-surface leading-relaxed">{plan.suggestedDescription}</p>
            </div>
          )}
          <button
            onClick={applyToGoogle}
            disabled={applying}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-bold hover:bg-primary-container disabled:opacity-60"
          >
            {applying ? 'Applying…' : 'Apply to Google'}
          </button>
          {applyMsg && <p className="text-xs text-on-surface-variant mt-2">{applyMsg}</p>}
        </Card>
      )}

      {plan.suggestedServices.length > 0 && (
        <Card title="Suggested services">
          <Chips items={plan.suggestedServices} />
          {plan.suggestedCategories.length > 0 && (
            <>
              <p className="text-xs text-on-surface-variant mb-1.5 mt-3">Extra Google categories</p>
              <Chips items={plan.suggestedCategories} tone="muted" />
            </>
          )}
        </Card>
      )}

      {plan.postThemes.length > 0 && (
        <Card title="Weekly post plan">
          <div className="grid sm:grid-cols-2 gap-3">
            {plan.postThemes.map((t, i) => (
              <div key={i} className="border border-outline-variant rounded-lg p-3">
                <div className="text-xs font-bold uppercase text-on-surface-variant">{t.weekday} · {t.postType}</div>
                <div className="text-sm text-on-surface mt-1">{t.theme}</div>
                <div className="text-xs text-on-surface-variant mt-1">Keyword: {t.keyword}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {plan.actionPhases.length > 0 && (
        <Card title="Action plan">
          <div className="space-y-5">
            {plan.actionPhases.map((phase, pi) => (
              <div key={pi}>
                <div className="text-xs font-bold uppercase tracking-wide text-error mb-2">{phase.label} ({phase.window})</div>
                <ul className="space-y-2">
                  {phase.items.map((it, ii) => (
                    <li key={ii} className="text-sm">
                      <span className="font-semibold text-on-surface">{it.title}</span>
                      <span className="text-on-surface-variant"> — {it.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {plan.suggestedQas.length > 0 && (
        <Card title="Suggested Q&As">
          <div className="divide-y divide-outline-variant">
            {plan.suggestedQas.map((qa, i) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="text-sm font-semibold text-on-surface">{qa.q}</div>
                <p className="text-sm text-on-surface-variant mt-1">{qa.a}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {plan.baseline.length > 0 && (
        <Card title="Baseline history">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-outline uppercase">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Avg rank</th>
                  <th className="py-2 pr-4 font-medium">Reviews</th>
                  <th className="py-2 pr-4 font-medium">Rating</th>
                  <th className="py-2 font-medium">Completion</th>
                </tr>
              </thead>
              <tbody>
                {plan.baseline.slice().reverse().map((b, i) => (
                  <tr key={i} className="border-t border-outline-variant">
                    <td className="py-2 pr-4">{new Date(b.capturedAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">{b.avgRank != null ? `#${Math.round(b.avgRank)}` : '—'}</td>
                    <td className="py-2 pr-4">{b.reviewCount ?? '—'}</td>
                    <td className="py-2 pr-4">{b.rating ?? '—'}</td>
                    <td className="py-2">{b.completionPct != null ? `${b.completionPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
