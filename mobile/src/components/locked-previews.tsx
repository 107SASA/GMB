import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import type { FreeReport } from '@/api/endpoints/freeReport';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * What a locked tab looks like when unlocked — drawn BEHIND the lock card for
 * Free CRM accounts (components/locked.tsx), blurred and not touchable.
 *
 * Honest by design: it's a sample of the real screens (same layout as the
 * Performance / Posts / Home tabs) for a sample business — the Growwmatics
 * logo sits in the corner, numbers are blurred, post images are posts our AI
 * made — and the lock screen labels it "Sample preview".
 * STORE COMPLIANCE — no prices, no "upgrade/buy" wording.
 */

export type LockedPreviewKind = 'home' | 'performance' | 'posts' | 'reviews' | 'profile';

export interface PreviewContext {
  businessName: string;
  category: string | null;
  report: FreeReport | null;
}

const LOGO = require('../../assets/images/icon.png');
const SAMPLE_POST_1 = require('../../assets/images/sample/post-ai-automation.jpg');
const SAMPLE_POST_2 = require('../../assets/images/sample/post-services.jpg');

/** Title + one line shown on the lock card for each preview. */
export function previewCopy(kind: LockedPreviewKind, businessName: string): { title: string; body: string } {
  switch (kind) {
    case 'home':
      return { title: 'Unlock your Google dashboard', body: 'Calls, website clicks and direction requests from Google, every day.' };
    case 'performance':
      return { title: 'Unlock Performance Analytics', body: 'Get detailed views, calls, directions and ranking trends for your business.' };
    case 'posts':
      return { title: 'Unlock Google Posts', body: `We write, design and publish posts and photos for ${businessName} every week.` };
    case 'reviews':
      return { title: 'Unlock Review Automation', body: 'Ask happy customers for reviews and reply to every review automatically.' };
    case 'profile':
      return { title: 'Unlock Profile Optimization', body: 'Fix and update your Google profile right from the app.' };
  }
}

/** Text drawn as a soft smudge — sample numbers read as "a number here", not a value. */
function Blurred({ children, size = 28 }: { children: string; size?: number }) {
  const t = useTheme();
  return (
    <Text
      style={{
        fontFamily: 'PublicSans_700Bold',
        fontSize: size,
        color: withAlpha(t.text, 0.28),
        textShadowColor: t.text,
        textShadowRadius: size / 3,
        textShadowOffset: { width: 0, height: 0 },
      }}
    >
      {children}
    </Text>
  );
}

function Box({ children, style }: { children: React.ReactNode; style?: object }) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: 18, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 14 }, style]}>
      {children}
    </View>
  );
}

/** Sample header: Growwmatics logo in the corner + the screen's title. */
function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} testID="preview-logo">
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.border }}>
        <Image source={LOGO} style={{ width: 28, height: 28 }} contentFit="contain" />
      </View>
      <View style={{ flex: 1 }}>
        <Text className="font-display-bold text-lg" style={{ color: t.text }} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text className="font-sans text-xs" style={{ color: t.textFaint }} numberOfLines={1}>{subtitle}</Text>}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <Box style={{ flex: 1, gap: 4 }}>
      <Text className="font-sans text-xs" style={{ color: t.textDim }}>{label}</Text>
      <Blurred>{value}</Blurred>
    </Box>
  );
}

/** "Last 6 months" area chart, drawn with bars so it needs no chart library. */
function Trend() {
  const t = useTheme();
  const h = [12, 14, 18, 30, 52, 58, 61, 68, 80, 72, 88, 96];
  return (
    <Box style={{ gap: 10 }}>
      <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Last 6 Months Trends</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {['Views', 'Calls', 'Directions'].map((c, i) => (
          <View key={c} style={{ borderRadius: 999, borderWidth: 1, borderColor: i === 0 ? t.brandBright : t.border, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Text className="font-sans-semibold text-xs" style={{ color: i === 0 ? t.brandBright : t.textFaint }}>{c}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 90 }}>
        {h.map((v, i) => (
          <View key={i} style={{ flex: 1, height: `${v}%`, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: withAlpha(t.brand, 0.45) }} />
        ))}
      </View>
    </Box>
  );
}

function PostCard({ image, title, status, when }: { image: number; title: string; status: string; when: string }) {
  const t = useTheme();
  return (
    <Box style={{ padding: 0, overflow: 'hidden' }}>
      <View>
        <Image source={image} style={{ width: '100%', height: 130 }} contentFit="cover" blurRadius={3} />
        <View style={{ position: 'absolute', left: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: 'rgba(90,60,0,0.9)', paddingHorizontal: 10, paddingVertical: 4 }}>
          <Ionicons name="newspaper-outline" size={12} color="#ffd38a" />
          <Text className="font-sans-bold text-xs" style={{ color: '#ffd38a' }}>Update Post</Text>
        </View>
      </View>
      <View style={{ padding: 14, gap: 8 }}>
        <Text className="font-sans-bold text-base" style={{ color: t.text }} numberOfLines={1}>{title}</Text>
        <View style={{ alignSelf: 'flex-start', borderRadius: 999, backgroundColor: withAlpha(t.brand, 0.2), paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text className="font-sans-bold text-xs" style={{ color: t.brandBright }}>{status}</Text>
        </View>
        <Text className="font-sans text-xs" style={{ color: t.textFaint }}>{when}</Text>
      </View>
    </Box>
  );
}

export function LockedPreview({ kind }: { kind: LockedPreviewKind; ctx: PreviewContext }) {
  const t = useTheme();

  if (kind === 'home') {
    return (
      <View style={{ gap: 12 }}>
        <Header title="Growwmatics AI" subtitle="Sample business · Pune" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Calls" value="48" />
          <Stat label="Directions" value="37" />
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Website clicks" value="126" />
          <Stat label="Views" value="2,340" />
        </View>
        <Trend />
      </View>
    );
  }

  if (kind === 'performance') {
    return (
      <View style={{ gap: 12 }}>
        <Header title="GBP Performance" subtitle="Last 28 days" />
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: withAlpha(t.brand, 0.12), borderColor: withAlpha(t.brand, 0.3) }}>
          <Ionicons name="sparkles" size={18} color={t.brandBright} />
          <Text className="flex-1 font-sans-semibold text-sm" style={{ color: t.brandBright }} numberOfLines={2}>
            Next priority: more reviews than the businesses above you
          </Text>
        </Box>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Views" value="375" />
          <Stat label="Calls" value="25" />
          <Stat label="Directions" value="16" />
        </View>
        <Box style={{ gap: 4 }}>
          <Text className="font-sans text-xs" style={{ color: t.textDim }}>Latest Google Rank</Text>
          <Blurred size={34}>#2.6</Blurred>
          <Text className="font-sans text-xs" style={{ color: t.textFaint }}>Average rank across 45 searches</Text>
        </Box>
        <Trend />
      </View>
    );
  }

  if (kind === 'posts') {
    return (
      <View style={{ gap: 12 }}>
        <Header title="Posts" subtitle="Growwmatics AI · sample" />
        <View style={{ flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: t.border, padding: 4 }}>
          <View style={{ flex: 1, alignItems: 'center', borderRadius: 999, backgroundColor: t.brand, paddingVertical: 8 }}>
            <Text className="font-sans-bold text-sm" style={{ color: '#ffffff' }}>Posts</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <Text className="font-sans-bold text-sm" style={{ color: t.textFaint }}>Photos</Text>
          </View>
        </View>
        <Text className="font-display-bold text-base" style={{ color: t.text }}>Upcoming Posts</Text>
        <PostCard image={SAMPLE_POST_1} title="AI-Powered Automation Boosts a Growing Business" status="SCHEDULED" when="Scheduled for: Thu, 7:00 pm" />
        <Text className="font-display-bold text-base" style={{ color: t.text }}>Recent Posts</Text>
        <PostCard image={SAMPLE_POST_2} title="Building Digital Experiences That Drive Real Impact" status="PUBLISHED" when="Posted on: Mon, 10:30 am" />
      </View>
    );
  }

  if (kind === 'reviews') {
    const reviews = [
      { who: 'Priya S.', text: 'Very happy with the service. Quick and polite!', reply: "Thank you Priya! We're glad you had a great experience." },
      { who: 'Rahul K.', text: 'Good experience overall, will come again.', reply: 'Thanks Rahul! See you again soon.' },
    ];
    return (
      <View style={{ gap: 12 }}>
        <Header title="Reviews" subtitle="Growwmatics AI · sample" />
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Blurred size={32}>4.7</Blurred>
          <Text className="flex-1 font-sans text-sm" style={{ color: t.textDim }}>★★★★★ · new reviews this month</Text>
        </Box>
        {reviews.map((r) => (
          <Box key={r.who} style={{ gap: 6 }}>
            <Text className="font-sans-semibold text-sm" style={{ color: t.text }}>{r.who} · ★★★★★</Text>
            <Text className="font-sans text-sm" style={{ color: t.textDim }}>{r.text}</Text>
            <Text className="font-sans text-xs" style={{ color: t.textFaint }}>AI reply: {r.reply}</Text>
          </Box>
        ))}
      </View>
    );
  }

  // profile
  const rows = ['Business hours', 'Services list', 'Photos (10+)', 'Business description', 'Website & phone'];
  return (
    <View style={{ gap: 12 }}>
      <Header title="Business Profile" subtitle="Growwmatics AI · sample" />
      <Box style={{ gap: 12 }}>
        <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Google profile checklist</Text>
        {rows.map((r, i) => (
          <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={i < 3 ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={i < 3 ? t.brandBright : t.textFaint} />
            <Text className="font-sans text-sm" style={{ color: t.textDim }}>{r}</Text>
          </View>
        ))}
      </Box>
    </View>
  );
}
