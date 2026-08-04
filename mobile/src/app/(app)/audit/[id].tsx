import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';

import { getApiErrorMessage, getAuthToken } from '@/api/client';
import {
  fetchAudit,
  shareAudit,
  type Audit,
  type AuditChecklistItem,
  type AuditCompetitor,
  type AuditKeywordRank,
  type AuditPlanBlock,
  type AuditRichItem,
} from '@/api/endpoints/audit';
import { useBusiness } from '@/business/BusinessContext';
import { Badge, EmptyState, ProgressBar, Screen, ScreenTitle, SectionLabel, Skeleton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/** Semantic score-color tier — green ≥70/rank≤5, amber 40-69/rank≤10, rose below. */
type ScoreTone = 'positive' | 'warning' | 'negative' | 'neutral';

const TONE_TEXT: Record<ScoreTone, string> = {
  positive: 'text-secondary',
  warning: 'text-on-warning-container',
  negative: 'text-error',
  neutral: 'text-zinc-500',
};
/** Tinted container background matching the tone — score numbers never sit on plain gray alone. */
const TONE_BG: Record<ScoreTone, string> = {
  positive: 'bg-secondary-container/50',
  warning: 'bg-warning-container/60',
  negative: 'bg-error-container/50',
  neutral: 'bg-surface-raised',
};

/* Rank (1 = best): ≤5 good, ≤10 okay, beyond that poor. */
function rankTone(rank: number): ScoreTone {
  if (rank <= 5) return 'positive';
  if (rank <= 10) return 'warning';
  return 'negative';
}

/* Percentage score (0–100): ≥70 good, ≥40 okay. */
function scoreTone(score: number | null): ScoreTone {
  if (score === null) return 'neutral';
  if (score >= 70) return 'positive';
  if (score >= 40) return 'warning';
  return 'negative';
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`rounded-card border border-surface-border bg-surface-raised px-4 py-3.5 ${className}`}>
      {children}
    </View>
  );
}

function Bullet({ text, icon, color }: { text: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <View className="flex-row gap-2.5 rounded-card border border-surface-border bg-surface-raised px-4 py-3">
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 1 }} />
      <Text className="flex-1 font-sans text-sm text-zinc-300">{text}</Text>
    </View>
  );
}

function BulletSection({
  title,
  items,
  icon,
  color,
}: {
  title: string;
  items: string[];
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionLabel>{title}</SectionLabel>
      <View className="gap-2">
        {items.map((item, i) => (
          <Bullet key={i} text={item} icon={icon} color={color} />
        ))}
      </View>
    </View>
  );
}

/* Strengths / weaknesses / priority fixes — object items from V6/V7. */
function RichSection({
  title,
  items,
  icon,
  color,
}: {
  title: string;
  items: AuditRichItem[];
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionLabel>{title}</SectionLabel>
      <View className="gap-2">
        {items.map((item, i) => (
          <Card key={i}>
            <View className="flex-row items-start gap-2.5">
              <Ionicons name={icon} size={16} color={color} style={{ marginTop: 2 }} />
              <View className="flex-1">
                <Text className="font-sans-semibold text-sm text-white">{item.title}</Text>
                {!!item.detail && (
                  <Text className="mt-1 font-sans text-sm leading-5 text-zinc-400">{item.detail}</Text>
                )}
                {(item.impact || item.effort || item.gain) && (
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    {!!item.impact && <Badge label={`Impact: ${item.impact}`} tone="warning" />}
                    {!!item.effort && <Badge label={`Effort: ${item.effort}`} tone="neutral" />}
                    {!!item.gain && <Badge label={`+${item.gain}`} tone="positive" />}
                  </View>
                )}
              </View>
            </View>
          </Card>
        ))}
      </View>
    </View>
  );
}

function PlanSection({ title, blocks }: { title: string; blocks: AuditPlanBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <View>
      <SectionLabel>{title}</SectionLabel>
      <View className="gap-2">
        {blocks.map((block, i) => (
          <Card key={i}>
            <Text className="font-sans-semibold text-sm text-white">
              {block.label || `Step ${i + 1}`}
            </Text>
            {block.tasks.map((task, j) => (
              <View key={j} className="mt-1.5 flex-row gap-2">
                <Text className="font-sans text-sm text-zinc-500">•</Text>
                <Text className="flex-1 font-sans text-sm leading-5 text-zinc-300">{task}</Text>
              </View>
            ))}
            {!!block.outcome && (
              <Text className="mt-2 font-sans-semibold text-xs text-secondary">
                Expected: {block.outcome}
              </Text>
            )}
          </Card>
        ))}
      </View>
    </View>
  );
}

/** Small solid rank/score pill — the score-color rule applied as a container, never bare text. */
function ScorePill({ tone, children }: { tone: ScoreTone; children: React.ReactNode }) {
  return (
    <View className={`rounded-full px-2.5 py-1 ${TONE_BG[tone]}`}>
      <Text className={`font-sans-bold text-sm ${TONE_TEXT[tone]}`}>{children}</Text>
    </View>
  );
}

function KeywordTable({ keywords }: { keywords: AuditKeywordRank[] }) {
  const rows = keywords.filter((k) => k.keyword).slice(0, 8);
  if (rows.length === 0) return null;
  return (
    <View>
      <SectionLabel>Your rank for top keywords</SectionLabel>
      <View className="overflow-hidden rounded-card border border-surface-border bg-surface-raised">
        {rows.map((k, i) => {
          const rank = k.avgRank ?? k.rank;
          return (
            <View
              key={`${k.keyword}-${i}`}
              className={`flex-row items-center justify-between px-4 py-2.5 ${
                i > 0 ? 'border-t border-surface-border' : ''
              }`}
            >
              <Text className="flex-1 pr-3 font-sans text-sm text-indigo-300" numberOfLines={2}>
                {k.keyword}
              </Text>
              <ScorePill tone={rank !== null ? rankTone(rank) : 'neutral'}>
                {rank !== null ? rank.toFixed(1) : '—'}
              </ScorePill>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function CompetitorSection({ competitors, ranked }: { competitors: AuditCompetitor[]; ranked: boolean }) {
  if (competitors.length === 0) return null;
  return (
    <View>
      <SectionLabel>
        {ranked ? 'Competitors ranking higher near you' : 'Nearby competitors'}
      </SectionLabel>
      <View className="gap-2">
        {competitors.slice(0, 6).map((c, i) => {
          const rank = c.avgRank ?? c.estimatedRank;
          return (
            <Card key={`${c.name}-${i}`}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 font-sans-semibold text-sm text-white" numberOfLines={1}>
                  {i + 1}. {c.name}
                </Text>
                {rank !== null && <ScorePill tone={rankTone(rank)}>#{rank.toFixed(1)}</ScorePill>}
              </View>
              <View className="mt-1 flex-row flex-wrap gap-x-3">
                {c.rating !== null && (
                  <Text className="font-sans text-xs text-zinc-400">★ {c.rating}</Text>
                )}
                {c.reviewCount !== null && (
                  <Text className="font-sans text-xs text-zinc-400">{c.reviewCount} reviews</Text>
                )}
                {!!c.distance && <Text className="font-sans text-xs text-zinc-400">{c.distance}</Text>}
              </View>
              {!!c.reason && <Text className="mt-1.5 font-sans text-xs text-zinc-500">{c.reason}</Text>}
            </Card>
          );
        })}
      </View>
    </View>
  );
}

/* Rank map baked server-side; needs the bearer token since RN <Image> has no session. */
function GeoMapCard({
  auditId,
  kwIndex,
  keyword,
  avgRank,
}: {
  auditId: string;
  kwIndex: number;
  keyword: string;
  avgRank: number | null;
}) {
  const [failed, setFailed] = useState(false);
  const token = getAuthToken();
  if (failed || !token) return null;
  return (
    <View className="mb-3 overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      <View className="px-4 py-2.5">
        <Text className="font-sans text-xs text-zinc-400">
          Keyword: <Text className="font-sans-semibold text-white">{keyword}</Text>
          {avgRank !== null && (
            <Text>
              {'  ·  '}Avg rank{' '}
              <Text className={`font-sans-bold ${TONE_TEXT[rankTone(avgRank)]}`}>
                {avgRank.toFixed(1)}
              </Text>
            </Text>
          )}
        </Text>
      </View>
      <Image
        source={{
          uri: `${process.env.EXPO_PUBLIC_API_URL}/api/audit/${auditId}/geo-map?kwIndex=${kwIndex}`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={{ width: '100%', height: 300 }}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

function ChecklistSection({
  completionPercentage,
  checklist,
}: {
  completionPercentage: number | null;
  checklist: AuditChecklistItem[];
}) {
  if (completionPercentage === null && checklist.length === 0) return null;
  const statusStyle: Record<AuditChecklistItem['status'], { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    Complete: { color: '#1db877', icon: 'checkmark-circle' },
    Partial: { color: '#ffb300', icon: 'alert-circle' },
    Missing: { color: '#ef4444', icon: 'close-circle' },
    Unknown: { color: '#8d9199', icon: 'help-circle' },
  };
  return (
    <View>
      <SectionLabel>Profile completion</SectionLabel>
      <Card>
        {completionPercentage !== null && (
          <View className="mb-3">
            <View className="mb-1.5 flex-row items-center justify-between">
              <Text className="font-sans text-sm text-zinc-300">Completed</Text>
              <ScorePill tone={scoreTone(completionPercentage)}>{completionPercentage}%</ScorePill>
            </View>
            <ProgressBar used={completionPercentage} limit={100} />
          </View>
        )}
        {checklist.map((item, i) => {
          const style = statusStyle[item.status];
          return (
            <View
              key={`${item.field}-${i}`}
              className={`flex-row items-center justify-between py-2 ${
                i > 0 ? 'border-t border-surface-border' : ''
              }`}
            >
              <Text className="flex-1 pr-3 font-sans text-sm text-zinc-300">{item.field}</Text>
              <Ionicons name={style.icon} size={18} color={style.color} />
            </View>
          );
        })}
      </Card>
    </View>
  );
}

function PendingBody({ timedOut, onRetry }: { timedOut: boolean; onRetry: () => void }) {
  if (timedOut) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-10">
        <Ionicons name="time-outline" size={40} color="#a6c8ff" />
        <Text className="font-display-bold text-lg text-white">Taking longer than usual</Text>
        <Text className="text-center font-sans text-sm text-zinc-400">
          This audit is taking much longer than expected.
        </Text>
        <Pressable
          onPress={onRetry}
          className="mt-2 flex-row items-center gap-2 rounded-full bg-brand px-5 py-2.5 active:scale-95"
        >
          <Ionicons name="refresh" size={15} color="#ffffff" />
          <Text className="font-sans-bold text-sm text-on-brand">Check again</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <ActivityIndicator size="large" color="#a6c8ff" />
      <Text className="font-display-bold text-lg text-white">Running your audit…</Text>
      <Text className="text-center font-sans text-sm text-zinc-400">
        We're analysing your Google ranking, profile, SEO and reviews. This usually takes a couple
        of minutes — you can leave this screen and come back.
      </Text>
    </View>
  );
}

function ResultsBody({ audit }: { audit: Audit }) {
  const data = audit.auditData;
  const overall = audit.overallScore ?? data?.overallScore ?? null;

  const overallRank =
    data?.geoGridRank?.overallAvgRank ?? data?.googleSearchRank?.averageRank ?? null;
  const profilePct = data?.profileScore?.overallScore ?? data?.profileScore?.score ?? null;
  const seo = data?.seoScore;
  const reviews = data?.reviewAnalysis;

  const geoKeywords = (data?.geoGridRank?.keywords ?? []).filter(
    (k): k is AuditKeywordRank => k !== null
  );
  const keywords =
    geoKeywords.length > 0
      ? geoKeywords
      : (data?.googleSearchRank?.topKeywords ?? []).filter(
          (k): k is AuditKeywordRank => k !== null
        );

  const localComps = (data?.localPackCompetitors ?? []).filter(
    (c): c is AuditCompetitor => c !== null
  );
  const fallbackComps = (data?.competitors ?? [])
    .filter((c): c is AuditCompetitor => c !== null)
    .sort((a, b) => (a.estimatedRank ?? 99) - (b.estimatedRank ?? 99));
  const competitors = localComps.length > 0 ? localComps : fallbackComps;

  const t = useTheme();
  const overallTone = scoreTone(overall);
  const rankTierTone = overallRank !== null ? rankTone(overallRank) : 'neutral';
  const profileTone = scoreTone(profilePct);
  const seoTone = scoreTone(seo?.score ?? null);

  return (
    <ScrollView contentContainerClassName="px-5 pb-12">
      {/* Overall score header — tinted container matches the score's tier, never bare colored text alone */}
      <View className={`items-center rounded-card border border-surface-border py-6 ${TONE_BG[overallTone]}`}>
        <Text className={`font-display text-5xl ${TONE_TEXT[overallTone]}`}>{overall ?? '—'}</Text>
        <Text className="mt-1 font-sans text-sm text-zinc-400">Overall score</Text>
        {(reviews?.averageRating ?? 0) > 0 && (
          <Text className="mt-2 font-sans text-sm text-zinc-300">
            ★ {reviews!.averageRating!.toFixed(1)}
            {reviews?.reviewCount !== null && (
              <Text className="font-sans text-zinc-500"> ({reviews!.reviewCount} reviews)</Text>
            )}
          </Text>
        )}
        {!!(audit.address ?? audit.location) && (
          <Text className="mt-1 px-6 text-center font-sans text-xs text-zinc-500">
            {audit.address ?? audit.location}
          </Text>
        )}
      </View>

      {/* Hero tiles — each tinted to its own score tier */}
      <View className="mt-3 flex-row gap-3">
        <View className={`flex-1 rounded-card border border-surface-border px-4 py-3 ${TONE_BG[rankTierTone]}`}>
          <Text className={`font-display text-3xl ${TONE_TEXT[rankTierTone]}`}>
            {overallRank !== null ? overallRank.toFixed(1) : '—'}
          </Text>
          <Text className="mt-0.5 font-sans text-xs text-zinc-400">Google search rank</Text>
          <Text className="font-sans text-[10px] text-zinc-600">avg across top keywords</Text>
        </View>
        <View className={`flex-1 rounded-card border border-surface-border px-4 py-3 ${TONE_BG[profileTone]}`}>
          <Text className={`font-display text-3xl ${TONE_TEXT[profileTone]}`}>
            {profilePct !== null ? `${profilePct}%` : '—'}
          </Text>
          <Text className="mt-0.5 font-sans text-xs text-zinc-400">Profile score</Text>
          <Text className="font-sans text-[10px] text-zinc-600">good profiles score 90%+</Text>
        </View>
      </View>
      <View className="mt-3 flex-row gap-3">
        <View className={`flex-1 rounded-card border border-surface-border px-4 py-3 ${TONE_BG[seoTone]}`}>
          <Text className={`font-display text-3xl ${TONE_TEXT[seoTone]}`}>
            {seo?.score != null ? `${seo.score}%` : '—'}
          </Text>
          <Text className="mt-0.5 font-sans text-xs text-zinc-400">SEO score</Text>
        </View>
        <View className="flex-1 rounded-card border border-surface-border bg-surface-raised px-4 py-3">
          <Text className="font-display text-3xl text-white">{reviews?.responseRate ?? '—'}</Text>
          <Text className="mt-0.5 font-sans text-xs text-zinc-400">Review response rate</Text>
        </View>
      </View>

      {!!data?.executiveSummary && (
        <View>
          <SectionLabel>Summary</SectionLabel>
          <Card>
            <Text className="font-sans text-sm leading-5 text-zinc-300">{data.executiveSummary}</Text>
          </Card>
        </View>
      )}

      <KeywordTable keywords={keywords} />

      {/* Geo-grid rank maps for the top 2 keywords (same images as the web report) */}
      {geoKeywords.length > 0 && (
        <View>
          <SectionLabel>Your rank at nearby locations</SectionLabel>
          {geoKeywords.slice(0, 2).map((kw, i) => (
            <GeoMapCard
              key={`${kw.keyword}-${i}`}
              auditId={audit._id}
              kwIndex={i}
              keyword={kw.keyword}
              avgRank={kw.avgRank}
            />
          ))}
        </View>
      )}

      <CompetitorSection competitors={competitors} ranked={localComps.length > 0} />

      <ChecklistSection
        completionPercentage={data?.profileCompletion?.completionPercentage ?? null}
        checklist={data?.profileCompletion?.checklist ?? []}
      />

      {/* SEO details */}
      {((seo?.missingKeywords?.length ?? 0) > 0 ||
        (seo?.optimizationOpportunities?.length ?? 0) > 0) && (
        <View>
          <SectionLabel>SEO opportunities</SectionLabel>
          <View className="gap-2">
            {(seo?.missingKeywords?.length ?? 0) > 0 && (
              <Card>
                <Text className="mb-2 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">
                  Missing keywords
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {seo!.missingKeywords.map((k, i) => (
                    <View key={i} className="rounded-full bg-error-container px-2.5 py-1">
                      <Text className="font-sans-bold text-xs text-on-error-container">{k}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}
            {(seo?.optimizationOpportunities ?? []).map((op, i) => (
              <Bullet key={i} text={op} icon="construct" color={t.amber} />
            ))}
          </View>
        </View>
      )}

      {/* Review analysis */}
      {reviews && (reviews.reviewCount !== null || reviews.averageRating !== null) && (
        <View>
          <SectionLabel>Review analysis</SectionLabel>
          <Card>
            <View className="flex-row flex-wrap gap-x-5 gap-y-2">
              {reviews.reviewsPerWeek !== null && (
                <View>
                  <Text className="font-display text-lg text-white">{reviews.reviewsPerWeek}</Text>
                  <Text className="font-sans text-[10px] text-zinc-500">reviews/week</Text>
                </View>
              )}
              {reviews.industryAverage !== null && (
                <View>
                  <Text className="font-display text-lg text-white">{reviews.industryAverage}</Text>
                  <Text className="font-sans text-[10px] text-zinc-500">industry avg/week</Text>
                </View>
              )}
              {reviews.positivePercent !== null && (
                <View>
                  <Text className="font-display text-lg text-secondary">
                    {reviews.positivePercent}%
                  </Text>
                  <Text className="font-sans text-[10px] text-zinc-500">positive</Text>
                </View>
              )}
              {reviews.negativePercent !== null && (
                <View>
                  <Text className="font-display text-lg text-error">{reviews.negativePercent}%</Text>
                  <Text className="font-sans text-[10px] text-zinc-500">negative</Text>
                </View>
              )}
            </View>
            {reviews.mostCommonPraises.length > 0 && (
              <Text className="mt-3 font-sans text-xs text-zinc-400">
                <Text className="font-sans-bold text-secondary">Praised for: </Text>
                {reviews.mostCommonPraises.join(', ')}
              </Text>
            )}
            {reviews.mostCommonComplaints.length > 0 && (
              <Text className="mt-1.5 font-sans text-xs text-zinc-400">
                <Text className="font-sans-bold text-error">Complaints: </Text>
                {reviews.mostCommonComplaints.join(', ')}
              </Text>
            )}
          </Card>
        </View>
      )}

      <RichSection title="Strengths" items={data?.strengths ?? []} icon="checkmark-circle" color={t.emerald} />
      <RichSection title="Weaknesses" items={data?.weaknesses ?? []} icon="close-circle" color={t.rose} />
      <BulletSection title="Quick wins" items={data?.quickWins ?? []} icon="flash" color={t.amber} />
      <BulletSection
        title="Growth opportunities"
        items={data?.growthOpportunities ?? []}
        icon="trending-up"
        color={t.brandBright}
      />
      <RichSection
        title="Priority fixes"
        items={data?.priorityFixes ?? []}
        icon="alert-circle"
        color="#ff8f00"
      />
      <PlanSection title="30-day plan" blocks={data?.thirtyDayPlan ?? []} />
      <PlanSection title="90-day plan" blocks={data?.ninetyDayPlan ?? []} />
    </ScrollView>
  );
}

export default function AuditDetailScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useBusiness();

  // Job-status poll: keep asking every 3s until the background worker
  // finishes, then stop (mirrors the web results page). Capped at 4 minutes —
  // the backend marks the audit FAILED on a caught error, which stops this
  // immediately, but if the job never ran at all (worker crash, queue never
  // picked it up) status would stay PENDING forever with no way out.
  const firstPendingAt = useRef<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const audit = useQuery({
    queryKey: ['audit', activeBusinessId, id],
    queryFn: () => fetchAudit(id),
    enabled: !!id,
    refetchInterval: (query) => {
      if (query.state.data?.status !== 'PENDING') return false;
      if (firstPendingAt.current == null) firstPendingAt.current = Date.now();
      if (Date.now() - firstPendingAt.current > 4 * 60 * 1000) {
        setTimedOut(true);
        return false;
      }
      return 3000;
    },
  });

  const share = useMutation({
    mutationFn: () => shareAudit(id),
    onSuccess: (token) => {
      const base = process.env.EXPO_PUBLIC_API_URL ?? '';
      void Share.share({ message: `${base}/reports/${token}` });
    },
  });

  const status = audit.data?.status;

  return (
    <Screen>
      <View className="flex-row items-center justify-between pr-5">
        <View className="flex-1">
          <ScreenTitle>{audit.data?.businessName ?? 'Audit'}</ScreenTitle>
        </View>
        {status === 'COMPLETED' && (
          <Pressable
            onPress={() => share.mutate()}
            disabled={share.isPending}
            className="flex-row items-center gap-1.5 rounded-full border border-surface-border bg-surface-raised px-4 py-2 active:opacity-80"
          >
            {share.isPending ? (
              <ActivityIndicator size="small" color={t.brandBright} />
            ) : (
              <Ionicons name="share-outline" size={14} color={t.text} />
            )}
            <Text className="font-sans-semibold text-sm text-white">Share</Text>
          </Pressable>
        )}
      </View>

      {audit.isLoading ? (
        <View className="mt-3 gap-3 px-5">
          <Skeleton className="h-32" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </View>
      ) : audit.isError ? (
        <EmptyState
          title="Couldn't load this audit"
          hint={getApiErrorMessage(audit.error, 'Go back and try again.')}
        />
      ) : status === 'PENDING' ? (
        <PendingBody
          timedOut={timedOut}
          onRetry={() => {
            firstPendingAt.current = null;
            setTimedOut(false);
            void audit.refetch();
          }}
        />
      ) : status === 'FAILED' ? (
        <EmptyState
          title="Audit failed"
          hint="Something went wrong while generating this audit. Run a new one from the audit list."
        />
      ) : (
        <ResultsBody audit={audit.data!} />
      )}
    </Screen>
  );
}
