import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui';
import { markIntroSeen } from '@/lib/intro';
import { BRAND_GRADIENT, useTheme } from '@/lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface Slide {
  key: string;
  /** Centre of the illustration: the brand logo, or an icon on the brand gradient. */
  hero: 'logo' | IconName;
  /** Two small "app" chips floating around the hero, showing the feature in use. */
  chips: [{ icon: IconName; text: string }, { icon: IconName; text: string }];
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    hero: 'logo',
    chips: [
      { icon: 'location', text: 'On Google Maps' },
      { icon: 'call', text: 'More calls' },
    ],
    title: 'Grow your business on Google',
    body: 'GrowwMatics AI looks after your Google Business Profile so more local customers find you and call you.',
  },
  {
    key: 'reviews',
    hero: 'star',
    chips: [
      { icon: 'logo-whatsapp', text: 'Link sent' },
      { icon: 'star', text: 'New 5★ review' },
    ],
    title: 'Get more 5★ reviews',
    body: 'Send a review link on WhatsApp or show your QR code. Happy customers review you in one tap.',
  },
  {
    key: 'ai',
    hero: 'sparkles',
    chips: [
      { icon: 'sparkles', text: 'AI drafted a reply' },
      { icon: 'checkmark-circle', text: 'Reply posted' },
    ],
    title: 'AI replies for you',
    body: 'AI replies to your reviews automatically after a fact check, and drafts posts for your profile. Prefer to approve each reply? Switch it in Review settings.',
  },
  {
    key: 'photos',
    hero: 'images',
    chips: [
      { icon: 'camera', text: 'Photo added' },
      { icon: 'pulse', text: 'Profile active' },
    ],
    title: 'Keep your profile fresh',
    body: 'Add photos and videos straight from your phone. Your AI Agent reminds you when it is time for new ones.',
  },
  {
    key: 'growth',
    hero: 'trending-up',
    chips: [
      { icon: 'trending-up', text: 'Ranking up' },
      { icon: 'people', text: 'New lead' },
    ],
    title: 'Track growth and leads',
    body: 'See your views, calls and ranking change, and follow up every WhatsApp lead from one place.',
  },
];

/**
 * First-launch intro — shown once per install after the splash screen,
 * before sign-in (see app/index.tsx and lib/intro.ts). Swipe or tap Next;
 * Skip or Get started both go to sign-in and never show this again.
 */
export default function WelcomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  // Illustration scales with the screen: room for text and buttons on a
  // 320×568 phone, capped so it does not dominate a tablet.
  const art = Math.round(Math.min(width * 0.74, height * 0.36, 340));

  const finish = async () => {
    await markIntroSeen();
    router.replace('/login');
  };

  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (i !== index) setIndex(Math.max(0, Math.min(SLIDES.length - 1, i)));
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}>
      {/* Top bar: brand on the left, Skip on the right (hidden on the last slide). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 56 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Image source={require('../../assets/images/splash-icon.png')} style={{ width: 28, height: 28 }} contentFit="contain" />
          <Text className="font-display-bold text-base text-white">GrowwMatics AI</Text>
        </View>
        {!last && (
          <Pressable
            onPress={finish}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Skip introduction"
            style={{ minHeight: 44, minWidth: 44, alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <Text className="font-sans-semibold text-base text-zinc-400">Skip</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        // Web has no momentum event; keep the dots in sync while dragging.
        onScroll={onScrollEnd}
        scrollEventThrottle={64}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide) => (
          <View key={slide.key} style={{ width, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
            <Illustration slide={slide} size={art} />
            <Text
              className="mt-8 text-center font-display-bold text-white"
              style={{ fontSize: width < 360 ? 24 : 28, lineHeight: width < 360 ? 30 : 34, maxWidth: 360 }}
              accessibilityRole="header"
            >
              {slide.title}
            </Text>
            <Text className="mt-3 text-center font-sans text-zinc-400" style={{ fontSize: 15, lineHeight: 22, maxWidth: 340 }}>
              {slide.body}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots + main action. */}
      <View style={{ paddingHorizontal: 24, paddingTop: 12, gap: 20 }}>
        <View
          style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}
          accessible
          accessibilityLabel={`Slide ${index + 1} of ${SLIDES.length}`}
        >
          {SLIDES.map((s, i) => (
            <Pressable key={s.key} onPress={() => goTo(i)} hitSlop={8} accessibilityLabel={`Go to slide ${i + 1}`}>
              <View
                style={{
                  height: 8,
                  width: i === index ? 24 : 8,
                  borderRadius: 999,
                  backgroundColor: i === index ? t.brand : t.border,
                }}
              />
            </Pressable>
          ))}
        </View>
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center' }}>
          <PrimaryButton title={last ? 'Get started' : 'Next'} onPress={() => (last ? void finish() : goTo(index + 1))} />
        </View>
      </View>
    </View>
  );
}

/** Hero: soft brand rings, the logo or a gradient icon tile, and two floating feature chips. */
function Illustration({ slide, size }: { slide: Slide; size: number }) {
  const t = useTheme();
  const tile = Math.round(size * 0.36);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{ position: 'absolute', width: size * 0.92, height: size * 0.92, borderRadius: 999, backgroundColor: `${t.brand}12` }}
      />
      <View
        style={{ position: 'absolute', width: size * 0.64, height: size * 0.64, borderRadius: 999, backgroundColor: `${t.brand}1f` }}
      />
      {slide.hero === 'logo' ? (
        <View
          style={{
            width: tile,
            height: tile,
            borderRadius: tile * 0.3,
            backgroundColor: '#ffffff',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: t.border,
          }}
        >
          <Image source={require('../../assets/images/splash-icon.png')} style={{ width: tile * 0.72, height: tile * 0.72 }} contentFit="contain" />
        </View>
      ) : (
        <LinearGradient
          colors={[...BRAND_GRADIENT]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ width: tile, height: tile, borderRadius: tile * 0.3, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={slide.hero} size={tile * 0.46} color="#ffffff" />
        </LinearGradient>
      )}
      {/* On compact screens the art is small, so the chips sit in the corners clear of the tile. */}
      <Chip {...slide.chips[0]} style={{ top: size < 260 ? 0 : size * 0.1, left: 0 }} />
      <Chip {...slide.chips[1]} style={{ bottom: size < 260 ? 0 : size * 0.12, right: 0 }} />
    </View>
  );
}

function Chip({ icon, text, style }: { icon: IconName; text: string; style: object }) {
  const t = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        maxWidth: '78%',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.border,
        ...style,
      }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: `${t.brand}24` }}>
        <Ionicons name={icon} size={13} color={t.brandBright} />
      </View>
      <Text numberOfLines={1} className="font-sans-semibold text-xs text-white" style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}
