import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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

/* Rank (1 = best): ≤5 good, ≤10 okay, beyond that poor. */
function rankColor(rank: number): string {
  if (rank <= 5) return 'text-emerald-400';
  if (rank <= 10) return 'text-amber-400';
  return 'text-rose-300';
}

/* Percentage score (0–100): ≥70 good, ≥40 okay. */
function scoreColor(score: number | null): string {
  if (score === null) return 'text-zinc-500';
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-rose-300';
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`rounded-xl border border-surface-border bg-surface-raised px-4 py-3.5 ${className}`}>
      {children}
    </View>
  );
}

function Bullet({ text, icon, color }: { text: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <View className="flex-row gap-2.5 rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 1 }} />
      <Text className="flex-1 text-sm text-zinc-300">{text}</Text>
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
                <Text className="text-sm font-semibold text-white">{item.title}</Text>
                {!!item.detail && (
                  <Text className="mt-1 text-sm leading-5 text-zinc-400">{item.detail}</Text>
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
            <Text className="text-sm font-semibold text-white">{block.label || `Step ${i + 1}`}</Text>
            {block.tasks.map((task, j) => (
              <View key={j} className="mt-1.5 flex-row gap-2">
                <Text className="text-sm text-zinc-500">•</Text>
                <Text className="flex-1 text-sm leading-5 text-zinc-300">{task}</Text>
              </View>
            ))}
            {!!block.outcome && (
              <Text className="mt-2 text-xs text-emerald-400">Expected: {block.outcome}</Text>
            )}
          </Card>
        ))}
      </View>
    </View>
  );
}

function KeywordTable({ keywords }: { keywords: AuditKeywordRank[] }) {
  const rows = keywords.filter((k) => k.keyword).slice(0, 8);
  if (rows.length === 0) return null;
  return (
    <View>
      <SectionLabel>Your rank for top keywords</SectionLabel>
      <View className="overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
        {rows.map((k, i) => {
          const rank = k.avgRank ?? k.rank;
          return (
            <View
              key={`${k.keyword}-${i}`}
              className={`flex-row items-center justify-between px-4 py-2.5 ${
                i > 0 ? 'border-t border-surface-border' : ''
              }`}
            >
              <Text className="flex-1 pr-3 text-sm text-indigo-300" numberOfLines={2}>
                {k.keyword}
              </Text>
              <Text className={`text-sm font-bold ${rank !== null ? rankColor(rank) : 'text-zinc-500'}`}>
                {rank !== null ? rank.toFixed(1) : '—'}
              </Text>
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
                <Text className="flex-1 text-sm font-semibold text-white" numberOfLines={1}>
                  {i + 1}. {c.name}
                </Text>
                {rank !== null && (
                  <Text className={`text-sm font-bold ${rankColor(rank)}`}>#{rank.toFixed(1)}</Text>
                )}
              </View>
              <View className="mt-1 flex-row flex-wrap gap-x-3">
                {c.rating !== null && <Text className="text-xs text-zinc-400">★ {c.rating}</Text>}
                {c.reviewCount !== null && (
                  <Text className="text-xs text-zinc-400">{c.reviewCount} reviews</Text>
                )}
                {!!c.distance && <Text className="text-xs text-zinc-400">{c.distance}</Text>}
              </View>
              {!!c.reason && <Text className="mt-1.5 text-xs text-zinc-500">{c.reason}</Text>}
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
    <View className="mb-3 overflow-hidden rounded-xl border border-surface-border bg-surface-raised">
      <View className="px-4 py-2.5">
        <Text className="text-xs text-zinc-400">
          Keyword: <Text className="font-semibold text-white">{keyword}</Text>
          {avgRank !== null && (
            <Text>
              {'  ·  '}Avg rank{' '}
              <Text className={`font-bold ${rankColor(avgRank)}`}>{avgRank.toFixed(1)}</Text>
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
    Complete: { color: '#34d399', icon: 'checkmark-circle' },
    Partial: { color: '#fbbf24', icon: 'alert-circle' },
    Missing: { color: '#FB7185', icon: 'close-circle' },
    Unknown: { color: '#666E94', icon: 'help-circle' },
  };
  return (
    <View>
      <SectionLabel>Profile completion</SectionLabel>
      <Card>
        {completionPercentage !== null && (
          <View className="mb-3">
            <View className="mb-1.5 flex-row items-center justify-between">
              <Text className="text-sm text-zinc-300">Completed</Text>
              <Text className={`text-sm font-bold ${scoreColor(completionPercentage)}`}>
                {completionPercentage}%
              </Text>
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
              <Text className="flex-1 pr-3 text-sm text-zinc-300">{item.field}</Text>
              <Ionicons name={style.icon} size={18} color={style.color} />
            </View>
          );
        })}
      </Card>
    </View>
  );
}

function PendingBody() {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <ActivityIndicator size="large" color="#6366F1" />
      <Text className="text-lg font-semibold text-white">Running your audit…</Text>
      <Text className="text-center text-sm text-zinc-400">
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

  return (
    <ScrollView contentContainerClassName="px-5 pb-12">
      {/* Overall score header */}
      <View className="items-center rounded-2xl border border-surface-border bg-surface-raised py-6">
        <Text className={`text-5xl font-bold ${scoreColor(overall)}`}>{overall ?? '—'}</Text>
        <Text className="mt-1 text-sm text-zinc-400">Overall score</Text>
        {(reviews?.averageRating ?? 0) > 0 && (
          <Text className="mt-2 text-sm text-zinc-300">
            ★ {reviews!.averageRating!.toFixed(1)}
            {reviews?.reviewCount !== null && (
              <Text className="text-zinc-500"> ({reviews!.reviewCount} reviews)</Text>
            )}
          </Text>
        )}
        {!!(audit.address ?? audit.location) && (
          <Text className="mt-1 px-6 text-center text-xs text-zinc-500">
            {audit.address ?? audit.location}
          </Text>
        )}
      </View>

      {/* Hero tiles */}
      <View className="mt-3 flex-row gap-3">
        <View className="flex-1 rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
          <Text
            className={`text-3xl font-bold ${overallRank !== null ? rankColor(overallRank) : 'text-zinc-500'}`}
          >
            {overallRank !== null ? overallRank.toFixed(1) : '—'}
          </Text>
          <Text className="mt-0.5 text-xs text-zinc-400">Google search rank</Text>
          <Text className="text-[10px] text-zinc-600">avg across top keywords</Text>
        </View>
        <View className="flex-1 rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
          <Text className={`text-3xl font-bold ${scoreColor(profilePct)}`}>
            {profilePct !== null ? `${profilePct}%` : '—'}
          </Text>
          <Text className="mt-0.5 text-xs text-zinc-400">Profile score</Text>
          <Text className="text-[10px] text-zinc-600">good profiles score 90%+</Text>
        </View>
      </View>
      <View className="mt-3 flex-row gap-3">
        <View className="flex-1 rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
          <Text className={`text-3xl font-bold ${scoreColor(seo?.score ?? null)}`}>
            {seo?.score != null ? `${seo.score}%` : '—'}
          </Text>
          <Text className="mt-0.5 text-xs text-zinc-400">SEO score</Text>
        </View>
        <View className="flex-1 rounded-xl border border-surface-border bg-surface-raised px-4 py-3">
          <Text className="text-3xl font-bold text-white">
            {reviews?.responseRate ?? '—'}
          </Text>
          <Text className="mt-0.5 text-xs text-zinc-400">Review response rate</Text>
        </View>
      </View>

      {!!data?.executiveSummary && (
        <View>
          <SectionLabel>Summary</SectionLabel>
          <Card>
            <Text className="text-sm leading-5 text-zinc-300">{data.executiveSummary}</Text>
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
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Missing keywords
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {seo!.missingKeywords.map((k, i) => (
                    <View key={i} className="rounded-full bg-rose-400/15 px-2.5 py-1">
                      <Text className="text-xs text-rose-300">{k}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}
            {(seo?.optimizationOpportunities ?? []).map((op, i) => (
              <Bullet key={i} text={op} icon="construct" color="#fbbf24" />
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
                  <Text className="text-lg font-bold text-white">{reviews.reviewsPerWeek}</Text>
                  <Text className="text-[10px] text-zinc-500">reviews/week</Text>
                </View>
              )}
              {reviews.industryAverage !== null && (
                <View>
                  <Text className="text-lg font-bold text-white">{reviews.industryAverage}</Text>
                  <Text className="text-[10px] text-zinc-500">industry avg/week</Text>
                </View>
              )}
              {reviews.positivePercent !== null && (
                <View>
                  <Text className="text-lg font-bold text-emerald-400">
                    {reviews.positivePercent}%
                  </Text>
                  <Text className="text-[10px] text-zinc-500">positive</Text>
                </View>
              )}
              {reviews.negativePercent !== null && (
                <View>
                  <Text className="text-lg font-bold text-rose-300">{reviews.negativePercent}%</Text>
                  <Text className="text-[10px] text-zinc-500">negative</Text>
                </View>
              )}
            </View>
            {reviews.mostCommonPraises.length > 0 && (
              <Text className="mt-3 text-xs text-zinc-400">
                <Text className="font-semibold text-emerald-400">Praised for: </Text>
                {reviews.mostCommonPraises.join(', ')}
              </Text>
            )}
            {reviews.mostCommonComplaints.length > 0 && (
              <Text className="mt-1.5 text-xs text-zinc-400">
                <Text className="font-semibold text-rose-300">Complaints: </Text>
                {reviews.mostCommonComplaints.join(', ')}
              </Text>
            )}
          </Card>
        </View>
      )}

      <RichSection title="Strengths" items={data?.strengths ?? []} icon="checkmark-circle" color="#34d399" />
      <RichSection title="Weaknesses" items={data?.weaknesses ?? []} icon="close-circle" color="#FB7185" />
      <BulletSection title="Quick wins" items={data?.quickWins ?? []} icon="flash" color="#fbbf24" />
      <BulletSection
        title="Growth opportunities"
        items={data?.growthOpportunities ?? []}
        icon="trending-up"
        color="#6366F1"
      />
      <RichSection
        title="Priority fixes"
        items={data?.priorityFixes ?? []}
        icon="alert-circle"
        color="#fb923c"
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

  const audit = useQuery({
    queryKey: ['audit', activeBusinessId, id],
    queryFn: () => fetchAudit(id),
    enabled: !!id,
    // Job-status poll: keep asking every 3s until the background worker
    // finishes, then stop (mirrors the web results page).
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 3000 : false),
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
              <ActivityIndicator size="small" color="#6366F1" />
            ) : (
              <Ionicons name="share-outline" size={14} color={t.text} />
            )}
            <Text className="text-sm font-semibold text-white">Share</Text>
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
        <PendingBody />
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
