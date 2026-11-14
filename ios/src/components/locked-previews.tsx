import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import type { FreeReport } from '@/api/endpoints/freeReport';
import { useTheme } from '@/lib/theme';

/**
 * What a locked tab looks like when unlocked — drawn BEHIND the lock card for
 * Free CRM accounts (components/locked.tsx), faded and not touchable.
 *
 * Honest by design: every preview is labelled "Sample preview" by the lock
 * screen, uses the business's own name / category, and shows real report
 * numbers where we have them (score, top fixes) — sample numbers only where
 * we don't. STORE COMPLIANCE — no prices, no "upgrade/buy" wording.
 */

export type LockedPreviewKind = 'home' | 'performance' | 'posts' | 'reviews' | 'profile';

export interface PreviewContext {
  businessName: string;
  category: string | null;
  report: FreeReport | null;
}

/** One-line description shown on the lock card for each preview. */
export function previewCopy(kind: LockedPreviewKind, businessName: string): { title: string; body: string } {
  switch (kind) {
    case 'home':
      return { title: 'Your Google dashboard', body: 'Calls, website clicks and direction requests from Google, every day.' };
    case 'performance':
      return { title: 'Google ranking', body: 'Where you rank for every search in your area, and what moves you up.' };
    case 'posts':
      return { title: 'Google posts', body: `We write and publish posts for ${businessName} every week.` };
    case 'reviews':
      return { title: 'Reviews', body: 'Ask happy customers for reviews and reply to every review automatically.' };
    case 'profile':
      return { title: 'Google profile', body: 'Fix and update your Google profile right from the app.' };
  }
}

function Box({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 14 }, style]}>
      {children}
    </View>
  );
}

function Stat({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  const t = useTheme();
  return (
    <Box style={{ flex: 1, gap: 6 }}>
      <Ionicons name={icon} size={18} color={t.brandBright} />
      <Text className="font-display-bold text-2xl text-white">{value}</Text>
      <Text className="font-sans text-xs text-zinc-400">{label}</Text>
    </Box>
  );
}

function Bars() {
  const t = useTheme();
  const h = [38, 52, 44, 66, 58, 74, 88];
  return (
    <Box style={{ gap: 10 }}>
      <Text className="font-sans-semibold text-sm text-zinc-300">Profile views · last 7 days</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 96 }}>
        {h.map((v, i) => (
          <View key={i} style={{ flex: 1, height: `${v}%`, borderRadius: 6, backgroundColor: t.brand }} />
        ))}
      </View>
    </Box>
  );
}

const what = (category: string | null) => (category || 'your service').toLowerCase();

export function LockedPreview({ kind, ctx }: { kind: LockedPreviewKind; ctx: PreviewContext }) {
  const t = useTheme();
  const name = ctx.businessName;

  if (kind === 'home') {
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Stat icon="call-outline" label="Calls from Google" value="48" />
          <Stat icon="navigate-outline" label="Direction requests" value="37" />
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Stat icon="globe-outline" label="Website clicks" value="126" />
          <Stat icon="eye-outline" label="Profile views" value="2,340" />
        </View>
        <Bars />
      </View>
    );
  }

  if (kind === 'performance') {
    const keywords = [
      `${what(ctx.category)} near me`,
      `best ${what(ctx.category)}`,
      `${name.toLowerCase()}`,
      `${what(ctx.category)} open now`,
    ];
    const ranks = [7, 12, 1, 18];
    return (
      <View style={{ gap: 12 }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Text className="font-display-bold text-white" style={{ fontSize: 36 }}>
            {ctx.report?.score ?? 72}
          </Text>
          <Text className="flex-1 font-sans text-sm text-zinc-400">Google profile score · checked every month</Text>
        </Box>
        <Box style={{ gap: 12 }}>
          <Text className="font-sans-semibold text-sm text-zinc-300">Your position on Google Maps</Text>
          {keywords.map((k, i) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text className="flex-1 font-sans text-sm text-zinc-300" numberOfLines={1}>{k}</Text>
              <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: ranks[i] <= 3 ? '#16a34a40' : '#f59e0b33' }}>
                <Text className="font-sans-semibold text-xs text-white">#{ranks[i]}</Text>
              </View>
            </View>
          ))}
        </Box>
        {(ctx.report?.topFixes?.length ?? 0) > 0 && (
          <Box style={{ gap: 8 }}>
            <Text className="font-sans-semibold text-sm text-zinc-300">Fixes we handle for you</Text>
            {ctx.report!.topFixes.map((f) => (
              <Text key={f} className="font-sans text-sm text-zinc-400" numberOfLines={1}>• {f}</Text>
            ))}
          </Box>
        )}
      </View>
    );
  }

  if (kind === 'posts') {
    const posts = [
      { title: `New this week at ${name}`, body: `Fresh updates from ${name} — drop in or call us to know more.`, when: 'Published · Mon' },
      { title: `Why customers choose ${name}`, body: `Trusted ${what(ctx.category)} with real reviews from local customers.`, when: 'Scheduled · Thu' },
      { title: `Festival offer at ${name}`, body: 'A special offer for this festive week. Visit us or message us on WhatsApp.', when: 'Draft · Sat' },
    ];
    return (
      <View style={{ gap: 12 }}>
        {posts.map((p) => (
          <Box key={p.title} style={{ gap: 6 }}>
            <View style={{ height: 90, borderRadius: 10, backgroundColor: t.brand, opacity: 0.35 }} />
            <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>{p.title}</Text>
            <Text className="font-sans text-sm text-zinc-400" numberOfLines={2}>{p.body}</Text>
            <Text className="font-sans text-xs text-zinc-500">{p.when}</Text>
          </Box>
        ))}
      </View>
    );
  }

  if (kind === 'reviews') {
    const reviews = [
      { who: 'Priya S.', stars: 5, text: `Very happy with ${name}. Quick and polite service!`, reply: `Thank you Priya! We're glad you had a great experience — team ${name}` },
      { who: 'Rahul K.', stars: 4, text: 'Good experience overall, will come again.', reply: `Thanks Rahul! See you again soon — team ${name}` },
      { who: 'Anita M.', stars: 5, text: 'Highly recommended.', reply: 'Thank you so much, Anita!' },
    ];
    return (
      <View style={{ gap: 12 }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text className="font-display-bold text-white" style={{ fontSize: 32 }}>4.7</Text>
          <Text className="flex-1 font-sans text-sm text-zinc-400">★★★★★ · 18 new reviews this month</Text>
        </Box>
        {reviews.map((r) => (
          <Box key={r.who} style={{ gap: 6 }}>
            <Text className="font-sans-semibold text-sm text-white">{r.who} · {'★'.repeat(r.stars)}</Text>
            <Text className="font-sans text-sm text-zinc-300">{r.text}</Text>
            <Text className="font-sans text-xs text-zinc-500">Reply: {r.reply}</Text>
          </Box>
        ))}
      </View>
    );
  }

  // profile
  const rows = ['Business hours', 'Services list', 'Photos (10+)', 'Business description', 'Website & phone'];
  return (
    <Box style={{ gap: 12 }}>
      <Text className="font-sans-semibold text-sm text-zinc-300">Google profile checklist</Text>
      {rows.map((r, i) => (
        <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name={i < 3 ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={i < 3 ? t.brandBright : t.textFaint} />
          <Text className="font-sans text-sm text-zinc-300">{r}</Text>
        </View>
      ))}
    </Box>
  );
}
