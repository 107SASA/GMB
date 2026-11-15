import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';

import type { FreeReport } from '@/api/endpoints/freeReport';
import { BRAND_GRADIENT, CRITICAL_GRADIENT, useTheme, withAlpha } from '@/lib/theme';

/**
 * What a locked tab looks like when unlocked — drawn BEHIND the lock card for
 * Free CRM accounts (components/locked.tsx), blurred and not touchable.
 *
 * Honest by design: it's a sample of the real screens (same layout as the
 * Performance / Posts / Home tabs, under the tab's real header) — numbers
 * are blurred, post images are posts our AI made — and the lock screen
 * labels it "Sample preview".
 * STORE COMPLIANCE — no prices, no "upgrade/buy" wording.
 */

export type LockedPreviewKind = 'home' | 'performance' | 'posts' | 'reviews' | 'profile';

export interface PreviewContext {
  businessName: string;
  category: string | null;
  report: FreeReport | null;
}

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

/** "GBP Performance · Last 28 days" row with the Google logo and Sync — as on the real Performance tab. */
function GbpTitle() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name="logo-google" size={24} color="#4285F4" />
      <View style={{ flex: 1 }}>
        <Text className="font-display-bold text-lg" style={{ color: t.text }}>GBP Performance</Text>
        <Text className="font-sans text-xs" style={{ color: t.textFaint }}>Last 28 days</Text>
      </View>
      <Ionicons name="sync-outline" size={18} color={t.brandBright} />
      <Text className="font-sans-bold text-sm" style={{ color: t.brandBright }}>Sync</Text>
    </View>
  );
}

/** "Upcoming Posts  3  (+)" — as on the real Posts tab. */
function SectionTitle({ title, count, add = false }: { title: string; count: number; add?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text className="font-display-bold text-lg" style={{ color: t.text }}>{title}</Text>
      <View style={{ minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.overlay }}>
        <Text className="font-sans-bold text-xs" style={{ color: t.textDim }}>{count}</Text>
      </View>
      <View style={{ flex: 1 }} />
      {add && (
        <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brandBright }}>
          <Ionicons name="add" size={20} color={t.bg} />
        </View>
      )}
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

/** "Where you rank" list — as on the real Performance tab. */
function RankList() {
  const t = useTheme();
  const rows: [string, number][] = [
    ['digital marketing agency near me', 2],
    ['website development company', 4],
    ['seo services', 3],
    ['social media marketing', 7],
    ['google business profile help', 1],
  ];
  return (
    <Box style={{ gap: 12 }}>
      <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Where you rank on Google Maps</Text>
      {rows.map(([k, r]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="search" size={14} color={t.textFaint} />
          <Text className="flex-1 font-sans text-sm" style={{ color: t.textDim }} numberOfLines={1}>{k}</Text>
          <View style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: withAlpha(r <= 3 ? t.brand : t.amber, 0.2) }}>
            <Text className="font-sans-bold text-xs" style={{ color: r <= 3 ? t.brandBright : t.amber }}>#{r}</Text>
          </View>
        </View>
      ))}
    </Box>
  );
}

/** Row of three photo tiles (sample post images). */
function PhotoStrip() {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[SAMPLE_POST_2, SAMPLE_POST_1, SAMPLE_POST_2].map((img, i) => (
        <Image key={i} source={img} style={{ flex: 1, height: 90, borderRadius: 14 }} contentFit="cover" blurRadius={3} />
      ))}
    </View>
  );
}

export function LockedPreview({ kind }: { kind: LockedPreviewKind; ctx: PreviewContext }) {
  const t = useTheme();

  if (kind === 'home') {
    // Same cards, same order as the real Home tab (app/(app)/dashboard.tsx).
    return (
      <View style={{ gap: 14 }}>
        <LinearGradient colors={[...CRITICAL_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, gap: 12 }}>
          <Text className="font-sans text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>This Week&apos;s Reviews</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text className="font-display-bold text-lg" style={{ color: '#ffffff' }}>No recent reviews received</Text>
            <Text className="font-display-bold text-xl" style={{ color: '#ffd6d6' }}>0/3</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
              <Ionicons name="flame" size={16} color="#ffb74d" />
            </View>
            <View style={{ flex: 1, height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)' }} />
          </View>
          <Text className="font-sans text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Your last review was 7 days ago, reviews are vital for good Google ranking.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around' }}>
            {([['people-outline', 'MORE CUSTOMERS'], ['star-outline', 'MORE REVIEWS'], ['trending-up', 'BETTER RANKING']] as const).map(([icon, label]) => (
              <View key={label} style={{ alignItems: 'center', gap: 6, width: 90 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
                  <Ionicons name={icon} size={20} color="#ffffff" />
                </View>
                <Text className="text-center font-sans-bold text-[10px]" style={{ color: '#ffffff', letterSpacing: 0.6 }}>{label}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 14, height: 50 }}>
            <Text className="font-sans text-sm" style={{ color: t.textFaint }}>Customer Phone Number</Text>
          </View>
          {(['people-outline', 'qr-code-outline'] as const).map((icon) => (
            <View key={icon} style={{ width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
              <Ionicons name={icon} size={20} color={t.brandBright} />
            </View>
          ))}
        </View>
        <LinearGradient colors={[...BRAND_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 999, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text className="font-sans-bold text-base" style={{ color: '#ffffff' }}>Send Review Link</Text>
        </LinearGradient>

        <Box style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(t.brand, 0.15) }}>
              <Ionicons name="sparkles" size={18} color={t.brandBright} />
            </View>
            <Text className="flex-1 font-sans-bold text-base" style={{ color: t.text }}>GrowwMatics AI Agent</Text>
            <View style={{ borderRadius: 999, backgroundColor: withAlpha(t.rose, 0.15), paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text className="font-sans-bold text-xs" style={{ color: t.rose }}>Needs Attention</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: t.overlay, padding: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text className="font-sans-bold text-sm" style={{ color: t.text }}>4 Photos left</Text>
              <Text className="font-sans text-xs" style={{ color: t.textDim }}>No photos added in 2 weeks</Text>
            </View>
            <View style={{ borderRadius: 999, backgroundColor: t.brand, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text className="font-sans-bold text-xs" style={{ color: '#ffffff' }}>Add Photos</Text>
            </View>
          </View>
        </Box>

        <Box style={{ gap: 12 }}>
          {([['storefront-outline', 'GBP Profile SEO', '75% complete'], ['newspaper-outline', 'Posts Published', 'this month']] as const).map(([icon, title, sub]) => (
            <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(t.brand, 0.12) }}>
                <Ionicons name={icon} size={20} color={t.brandBright} />
              </View>
              <View style={{ flex: 1 }}>
                <Text className="font-sans-bold text-base" style={{ color: t.text }}>{title}</Text>
                <Text className="font-sans text-xs" style={{ color: t.textDim }}>{sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.textFaint} />
            </View>
          ))}
        </Box>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Calls" value="48" />
          <Stat label="Directions" value="37" />
          <Stat label="Views" value="2,340" />
        </View>
        <Trend />
        <PhotoStrip />
      </View>
    );
  }

  if (kind === 'performance') {
    return (
      <View style={{ gap: 12 }}>
        <GbpTitle />
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
        <RankList />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Website clicks" value="126" />
          <Stat label="Bookings" value="14" />
        </View>
        <Trend />
      </View>
    );
  }

  if (kind === 'posts') {
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: t.border, padding: 4 }}>
          <View style={{ flex: 1, alignItems: 'center', borderRadius: 999, backgroundColor: t.brand, paddingVertical: 8 }}>
            <Text className="font-sans-bold text-sm" style={{ color: '#ffffff' }}>Posts</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <Text className="font-sans-bold text-sm" style={{ color: t.textFaint }}>Photos</Text>
          </View>
        </View>
        <SectionTitle title="Upcoming Posts" count={3} add />
        <PostCard image={SAMPLE_POST_1} title="AI-Powered Automation Boosts a Growing Business" status="SCHEDULED" when="Scheduled for: Thu, 7:00 pm" />
        <SectionTitle title="Recent Posts" count={9} />
        <PostCard image={SAMPLE_POST_2} title="Building Digital Experiences That Drive Real Impact" status="PUBLISHED" when="Posted on: Mon, 10:30 am" />
        <PostCard image={SAMPLE_POST_1} title="How AI Helps Local Businesses Get Found" status="PUBLISHED" when="Posted on: Fri, 6:15 pm" />
        <PhotoStrip />
      </View>
    );
  }

  if (kind === 'reviews') {
    const reviews = [
      { who: 'Priya S.', text: 'Very happy with the service. Quick and polite!', reply: "Thank you Priya! We're glad you had a great experience." },
      { who: 'Rahul K.', text: 'Good experience overall, will come again.', reply: 'Thanks Rahul! See you again soon.' },
      { who: 'Anita M.', text: 'Highly recommended. Very professional team.', reply: 'Thank you so much, Anita!' },
      { who: 'Suresh P.', text: 'Got my website and Google profile done quickly.', reply: 'Glad we could help, Suresh!' },
      { who: 'Meera J.', text: 'Great support on WhatsApp, always quick to reply.', reply: 'Thanks Meera, happy to help anytime.' },
      { who: 'Vikram R.', text: 'Our calls from Google doubled in two months.', reply: 'That is great to hear, Vikram!' },
      { who: 'Pooja N.', text: 'Clear reports every week, easy to understand.', reply: 'Thank you Pooja, glad they help.' },
      { who: 'Arjun T.', text: 'Fast and friendly service.', reply: 'Thanks Arjun!' },
    ];
    return (
      <View style={{ gap: 12 }}>
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
      <Box style={{ gap: 12 }}>
        <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Google profile checklist</Text>
        {rows.map((r, i) => (
          <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={i < 3 ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={i < 3 ? t.brandBright : t.textFaint} />
            <Text className="font-sans text-sm" style={{ color: t.textDim }}>{r}</Text>
          </View>
        ))}
      </Box>
      <Box style={{ gap: 12 }}>
        <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Business info</Text>
        {([['storefront-outline', 'Business name'], ['pricetag-outline', 'Category'], ['time-outline', 'Opening hours'], ['call-outline', 'Phone number'], ['globe-outline', 'Website'], ['location-outline', 'Address']] as const).map(([icon, label]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={icon} size={18} color={t.brandBright} />
            <Text className="flex-1 font-sans text-sm" style={{ color: t.textDim }}>{label}</Text>
            <Ionicons name="chevron-forward" size={16} color={t.textFaint} />
          </View>
        ))}
      </Box>
      <Box style={{ gap: 10 }}>
        <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Services</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['Website design', 'SEO', 'Google profile', 'Social media', 'WhatsApp marketing', 'Ads'].map((x) => (
            <View key={x} style={{ borderRadius: 999, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text className="font-sans text-xs" style={{ color: t.textDim }}>{x}</Text>
            </View>
          ))}
        </View>
      </Box>
      <Box style={{ gap: 12 }}>
        <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Profile strength</Text>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: t.overlay }}>
          <View style={{ width: '75%', height: 8, borderRadius: 999, backgroundColor: t.brand }} />
        </View>
      </Box>
      <PhotoStrip />
    </View>
  );
}
