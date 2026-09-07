'use client';

/**
 * The consultant half of the free report — sections 1..9 of the reference
 * report (Keyword Search Volume Analysis → Data Required). Rendered only when
 * `seoPlanDraft` is present on the audit (older / failed audits skip it).
 *
 * Deliberately styled with the navy section bars / coloured pills of the
 * reference report via inline styles, so it reads the same regardless of the
 * surrounding green design system. If one subsection failed generation
 * (draft.failed includes its name) that block shows a support note instead
 * of fabricated copy.
 */

import Link from 'next/link';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import type { ISeoPlanDraft, IKeywordTableRow } from '@/models/Audit';

const NAVY = '#1e293b';
const AMBER_BG = '#fffbeb';
const AMBER_BORDER = '#fde68a';
const RANK_RED = '#dc2626';

const BAND_WIDTH: Record<string, string> = { HIGH: '100%', MED: '66%', LOW: '38%', NICHE: '18%' };
const BAND_COLOR: Record<string, string> = { HIGH: '#f59e0b', MED: '#f59e0b', LOW: '#60a5fa', NICHE: '#a78bfa' };

function fmtRank(r?: number | null) {
  if (r == null) return '—';
  return r >= 21 ? '20+' : `#${Math.round(r)}`;
}

function SectionBar({ num, title }: { num: number; title: string }) {
  return (
    <div style={{ background: NAVY, color: '#fff', borderRadius: 12, padding: '14px 18px', fontWeight: 700, fontSize: 14, letterSpacing: '0.02em' }}>
      {num}. {title}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
      {children}
    </div>
  );
}

function SupportNote({ what }: { what: string }) {
  return (
    <p className="text-sm text-on-surface-variant italic">
      This section ({what}) couldn&apos;t be generated. Contact support and we&apos;ll regenerate it.
    </p>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ background: color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.03em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {text}
    </span>
  );
}

const POTENTIAL_COLOR: Record<string, string> = {
  'HIGHEST POTENTIAL': '#16a34a',
  'IMMEDIATE WIN': '#ea580c',
  'HIGH POTENTIAL': '#2563eb',
  'MEDIUM POTENTIAL': '#0891b2',
};
const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#ca8a04',
};
const TONE_COLOR: Record<string, string> = { good: '#16a34a', warn: '#ca8a04', bad: '#dc2626' };

function GapStatusIcon({ status }: { status?: 'ok' | 'missing' | 'unverified' }) {
  if (status === 'ok') return <MaterialIcon name="check_circle" size={16} className="text-secondary shrink-0" />;
  if (status === 'unverified') return <MaterialIcon name="help" size={16} className="text-outline shrink-0" />;
  return <MaterialIcon name="cancel" size={16} className="text-error shrink-0" />;
}

function SnapshotGrid({ tiles }: { tiles: NonNullable<ISeoPlanDraft['performanceSnapshot']> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map((t, i) => (
        <div key={i} className="bg-surface-container rounded-xl border border-outline-variant p-4">
          <div className="text-[11px] text-on-surface-variant">{t.label}</div>
          <div className="font-heading text-lg font-bold mt-1" style={{ color: t.tone ? TONE_COLOR[t.tone] : undefined }}>
            {t.value}
          </div>
          {t.note && <div className="text-[11px] text-on-surface-variant mt-0.5">{t.note}</div>}
        </div>
      ))}
    </div>
  );
}

export default function ConsultantSections({
  draft,
  keywordTable,
  businessName,
  city,
  checkoutHref,
}: {
  draft: ISeoPlanDraft;
  keywordTable: IKeywordTableRow[];
  businessName: string;
  city: string;
  checkoutHref: string;
}) {
  const failed = new Set(draft.failed || []);
  const table = keywordTable?.length ? keywordTable : [];
  const full = draft.depth === 'full';
  const showMapsVol = table.some((k) => k.mapsVolume != null);
  // Running section number — JSX below evaluates top-to-bottom, so this
  // stays in step. Free and full tiers number their own sections.
  const counter = { n: 0 };
  const S = () => ++counter.n;

  return (
    <div className="space-y-8">
      {full && (
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
          <MaterialIcon name="verified" size={16} />
          Full Audit Report
        </div>
      )}

      {/* PERFORMANCE SNAPSHOT */}
      {(draft.performanceSnapshot || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="PERFORMANCE SNAPSHOT" />
          <Card>
            <SnapshotGrid tiles={draft.performanceSnapshot!} />
          </Card>
        </div>
      )}

      {/* KEY FINDING */}
      {(draft.keyFinding || failed.has('narrative')) && (
        <Card>
          <div className="text-xs font-bold uppercase tracking-wide text-primary mb-2">Key Finding</div>
          {draft.keyFinding ? (
            <p className="text-sm text-on-surface leading-relaxed">{draft.keyFinding}</p>
          ) : (
            <SupportNote what="Key Finding" />
          )}
        </Card>
      )}

      {/* WEBSITE ASSESSMENT (full only) */}
      {full && draft.websiteAssessment && (
        <Card>
          <div className="text-xs font-bold uppercase tracking-wide text-primary mb-2">Your Website</div>
          <p className="text-sm text-on-surface leading-relaxed">{draft.websiteAssessment}</p>
        </Card>
      )}

      {/* CRITICAL GAP */}
      {draft.criticalGap && draft.criticalGap.rows.length > 0 && (
        <div style={{ background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 12 }} className="p-6">
          <div className="text-xs font-bold uppercase tracking-wide text-on-surface mb-2">
            Critical Gap — Searches That Are Not Showing You
          </div>
          <p className="text-sm text-on-surface-variant mb-4">{draft.criticalGap.intro}</p>
          <div className="divide-y divide-outline-variant/60">
            {draft.criticalGap.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <span className="text-on-surface">{r.keyword}</span>
                <span style={{ color: RANK_RED }} className="font-bold">{fmtRank(r.mapsRank)}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-on-surface-variant mt-4">{draft.criticalGap.closer}</p>
        </div>
      )}

      {/* 1. KEYWORD SEARCH VOLUME ANALYSIS */}
      {table.length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="KEYWORD SEARCH VOLUME ANALYSIS — GOOGLE MAPS" />
          <Card>
            <p className="text-sm text-on-surface-variant mb-3">
              Phrases people type around {city || 'your area'}. Rank is live Maps data when we have it — never guessed. Volume is a band, not a monthly count.
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4 text-[11px]">
              {['HIGH', 'MED', 'LOW', 'NICHE'].map((b) => (
                <span key={b} style={{ color: BAND_COLOR[b] }} className="font-bold">{b}</span>
              ))}
              <span className="text-on-surface-variant ml-2">Red rank = not in a strong position</span>
              <span className="text-on-surface-variant">* = estimated demand</span>
              {showMapsVol && <span className="text-on-surface-variant">~ Maps volume derived from Google search volume</span>}
            </div>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm min-w-90">
                <thead>
                  <tr className="text-left text-xs text-outline uppercase tracking-wide">
                    <th className="px-2 py-2 font-medium">Keyword</th>
                    {showMapsVol && <th className="px-2 py-2 font-medium text-right">Search / mo</th>}
                    {showMapsVol && <th className="px-2 py-2 font-medium text-right">Maps / mo ~</th>}
                    <th className="px-2 py-2 font-medium">Demand</th>
                    <th className="px-2 py-2 font-medium text-right">Maps Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((k, i) => (
                    <tr key={i} className="border-t border-outline-variant">
                      <td className="px-2 py-3 text-on-surface">{k.keyword}</td>
                      {showMapsVol && (
                        <td className="px-2 py-3 text-right text-on-surface-variant whitespace-nowrap">
                          {k.searchVolume != null ? k.searchVolume.toLocaleString('en-IN') : '—'}
                        </td>
                      )}
                      {showMapsVol && (
                        <td className="px-2 py-3 text-right text-on-surface-variant whitespace-nowrap">
                          {k.mapsVolume != null ? `~${k.mapsVolume.toLocaleString('en-IN')}` : '—'}
                        </td>
                      )}
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-surface-container overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: BAND_WIDTH[k.volumeBand], background: BAND_COLOR[k.volumeBand] }} />
                          </div>
                          <span className="text-xs font-bold" style={{ color: BAND_COLOR[k.volumeBand] }}>
                            {k.volumeBand}{k.estimated ? '*' : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right font-bold" style={{ color: k.mapsRank > 5 ? RANK_RED : '#16a34a' }}>
                        {fmtRank(k.mapsRank)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(draft.keywordInsights || []).length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {draft.keywordInsights!.map((line, i) => (
                  <li key={i} className="text-sm text-on-surface-variant">{line}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* 2. COMPETITOR LANDSCAPE */}
      {(draft.competitorLandscape || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="COMPETITOR LANDSCAPE" />
          <Card>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm min-w-90">
                <thead>
                  <tr className="text-left text-xs text-outline uppercase tracking-wide">
                    <th className="px-2 py-2 font-medium">Competitor</th>
                    <th className="px-2 py-2 font-medium">Maps Rank</th>
                    <th className="px-2 py-2 font-medium">Reviews</th>
                    <th className="px-2 py-2 font-medium">Key Edge</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.competitorLandscape!.map((c, i) => (
                    <tr key={i} className="border-t border-outline-variant align-top">
                      <td className="px-2 py-3 font-medium text-on-surface">{c.name}</td>
                      <td className="px-2 py-3 font-bold text-primary whitespace-nowrap">{fmtRank(c.mapsRank)}</td>
                      <td className="px-2 py-3 text-secondary whitespace-nowrap">
                        {c.rating != null ? `${c.rating}★` : '—'} {c.reviewCount != null ? `· ${c.reviewCount}` : ''}
                      </td>
                      <td className="px-2 py-3 text-on-surface-variant">{c.keyEdge}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {draft.competitorCounterPosition && (
              <p className="text-sm text-on-surface-variant mt-4 leading-relaxed">{draft.competitorCounterPosition}</p>
            )}
          </Card>
        </div>
      )}

      {/* 3. GBP PROFILE GAP ANALYSIS */}
      {(draft.gbpGaps?.length || draft.suggestedTitle || failed.has('gbpDrafts')) && (
        <div className="space-y-4">
          <SectionBar num={S()} title="GBP PROFILE GAP ANALYSIS" />
          <Card>
            <p className="text-sm text-on-surface-variant mb-5">
              Drafts for {businessName} only. We do not overwrite the live listing from this report. After you subscribe and connect Google, apply them from Google Profile.
            </p>
            {failed.has('gbpDrafts') ? (
              <SupportNote what="GBP drafts" />
            ) : (
              <>
                <div className="space-y-4">
                  {(draft.gbpGaps || []).map((g, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                        <GapStatusIcon status={g.status} />
                        {g.field}
                      </div>
                      <p className="text-xs text-on-surface-variant mt-1">{g.whyItMatters}</p>
                      <p className="text-sm text-on-surface mt-1">{g.recommendation}</p>
                    </div>
                  ))}
                </div>

                {(draft.descriptionKeywords || []).length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant mb-2">The 750-char description must embed</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.descriptionKeywords!.map((k, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded bg-surface-container text-on-surface-variant">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(draft.suggestedAttributes || []).length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-wide text-error mb-2">GBP attributes to set</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.suggestedAttributes!.map((a, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded bg-primary-fixed text-primary">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(draft.platformGaps || []).length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant mb-2">List on these platforms too</div>
                    <ul className="space-y-1.5">
                      {draft.platformGaps!.map((p, i) => (
                        <li key={i} className="text-sm text-on-surface-variant">
                          <span className="font-semibold text-on-surface">{p.platform}</span> — {p.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {draft.suggestedTitle && (
                  <div className="mt-6">
                    <div className="text-xs font-bold uppercase tracking-wide text-error">Title is not carrying the keywords</div>
                    <p className="text-sm font-semibold text-on-surface mt-1">{draft.suggestedTitle}</p>
                  </div>
                )}
                {draft.suggestedDescription && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-wide text-error">Description — first 150 characters must be the USP</div>
                    <p className="text-sm text-on-surface mt-1 leading-relaxed">{draft.suggestedDescription}</p>
                  </div>
                )}
                {(draft.suggestedServices || []).length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-wide text-error mb-2">Services list is thinner than it should be</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.suggestedServices!.map((s, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded bg-primary-fixed text-primary">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(draft.suggestedCategories || []).length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant mb-2">Extra Google categories to add in Google</div>
                    <div className="flex flex-wrap gap-2">
                      {draft.suggestedCategories!.map((c, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded bg-surface-container text-on-surface-variant">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* 4. MARKET OPPORTUNITY GAPS */}
      {(draft.marketOpportunities || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="MARKET OPPORTUNITY GAPS" />
          <Card>
            <div className="divide-y divide-outline-variant">
              {draft.marketOpportunities!.map((m, i) => (
                <div key={i} className="py-4 grid sm:grid-cols-[200px_1fr] gap-3 first:pt-0 last:pb-0">
                  <div>
                    <div className="text-sm font-bold text-on-surface">{m.keyword}</div>
                    <div className="mt-1.5">
                      <Pill text={m.potential} color={POTENTIAL_COLOR[m.potential?.toUpperCase()] || '#2563eb'} />
                    </div>
                  </div>
                  <p className="text-sm text-on-surface-variant">{m.rationale}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* 5. PRIORITY ACTION PLAN */}
      {(draft.actionPhases || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="PRIORITY ACTION PLAN — 30 / 60 / 90 DAYS" />
          <Card>
            <div className="space-y-6">
              {draft.actionPhases!.map((phase, pi) => (
                <div key={pi}>
                  <div className="text-xs font-bold uppercase tracking-wide text-error mb-3">
                    {phase.label} ({phase.window})
                  </div>
                  <div className="space-y-3">
                    {phase.items.map((it, ii) => (
                      <div key={ii} className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-lg bg-primary-fixed text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {ii + 1}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-on-surface">{it.title}</span>
                            <Pill text={it.priority} color={PRIORITY_COLOR[it.priority?.toUpperCase()] || '#ca8a04'} />
                          </div>
                          <p className="text-sm text-on-surface-variant mt-0.5">{it.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* 6. THIS WEEK'S GOOGLE POSTS */}
      {(draft.weeklyPostThemes || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="THIS WEEK'S GOOGLE POSTS" />
          <Card>
            <p className="text-sm text-on-surface-variant mb-4">
              After you subscribe, auto-posts use these themes and keywords — not generic copy.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {draft.weeklyPostThemes!.map((p, i) => (
                <div key={i} className="border border-outline-variant rounded-lg overflow-hidden">
                  <div className="bg-surface-container px-3 py-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                    {p.weekday} · {p.postType}
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold text-on-surface">{p.theme}</div>
                    <div className="text-xs text-on-surface-variant mt-1">Keyword: {p.keyword}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* 7. SUGGESTED GOOGLE Q&AS */}
      {(draft.suggestedQas || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="SUGGESTED GOOGLE Q&AS" />
          <Card>
            <div className="divide-y divide-outline-variant">
              {draft.suggestedQas!.map((qa, i) => (
                <div key={i} className="py-3 first:pt-0 last:pb-0">
                  <div className="text-sm font-semibold text-on-surface">{qa.q}</div>
                  <p className="text-sm text-on-surface-variant mt-1">{qa.a}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* PROJECTED RANK TIMELINE (both tiers) / WHAT WE AIM FOR (fallback) */}
      {(draft.rankTimeline || []).length > 0 ? (
        <div className="space-y-4">
          <SectionBar num={S()} title="PROJECTED RANK IMPROVEMENT TIMELINE" />
          <Card>
            <p className="text-sm text-on-surface-variant mb-4">
              Targets for the work, not a promise of position. Google decides ranking.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {draft.rankTimeline!.map((m, i) => (
                <div
                  key={i}
                  className="rounded-xl p-4 text-center border"
                  style={i === 0 ? { background: AMBER_BG, borderColor: AMBER_BORDER } : { borderColor: 'var(--color-outline-variant)' }}
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{m.label}</div>
                  <div className="font-heading text-xl font-bold mt-1" style={{ color: m.tone ? TONE_COLOR[m.tone] : undefined }}>{m.rank}</div>
                  <div className="text-[11px] text-on-surface-variant mt-1">{m.note}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : draft.whatWeAimFor ? (
        <div className="space-y-4">
          <SectionBar num={S()} title="WHAT WE AIM FOR — NOT A GUARANTEED RANK" />
          <Card>
            <p className="text-sm text-on-surface-variant mb-4">
              Targets for the work, not a promise of position, reviews, or enquiries. Google decides ranking.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl p-4 text-center" style={{ background: AMBER_BG, border: `1px solid ${AMBER_BORDER}` }}>
                <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">Today</div>
                <div className="font-heading text-2xl font-bold mt-1" style={{ color: RANK_RED }}>{draft.whatWeAimFor.todayRank}</div>
                <div className="text-[11px] text-on-surface-variant mt-1">Live Maps position we measured — not a forecast</div>
              </div>
              {draft.whatWeAimFor.milestones.map((m, i) => (
                <div key={i} className="rounded-xl p-4 text-center bg-surface-container border border-outline-variant">
                  <div className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{m.label}</div>
                  <div className="text-[11px] text-on-surface-variant mt-2">{m.text}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {/* 9. DATA REQUIRED */}
      {(draft.dataRequired || []).length > 0 && (
        <div className="space-y-4">
          <SectionBar num={S()} title="DATA REQUIRED TO COMPLETE THIS AUDIT" />
          <Card>
            <ol className="space-y-2">
              {draft.dataRequired!.map((line, i) => (
                <li key={i} className="text-sm text-on-surface flex gap-2">
                  <span className="text-outline font-mono text-xs mt-0.5">{String(i + 1).padStart(2, '0')}.</span>
                  {line}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      <Link
        href={checkoutHref}
        className="block w-full text-center py-4 bg-primary text-on-primary rounded-lg font-bold hover:bg-primary-container transition-all card-shadow"
      >
        Unlock the full plan & platform →
      </Link>
    </div>
  );
}
