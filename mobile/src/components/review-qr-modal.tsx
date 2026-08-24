import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle } from 'react-native-svg';

import { EmptyState, useInfoSheet } from '@/components/ui';
import { GoogleG } from '@/components/google-g';
import { useTheme } from '@/lib/theme';

/**
 * Direct-to-review-page QR code for the active business — scan it and you
 * land straight on Google's "write a review" screen for this listing, no
 * searching required. Meant to be printed/displayed anywhere (counter,
 * receipt, storefront) so walk-in customers can leave a review on the spot.
 *
 * Google's own review-page URL format (no API key/backend call needed,
 * works for any place with a Places id):
 *   https://search.google.com/local/writereview?placeid=<PLACE_ID>
 *
 * Sharing here uses React Native's built-in `Share` API (core RN, no native
 * module install/link required) to share the review LINK as text — not an
 * image of the QR itself. An image-sharing version (via expo-sharing +
 * react-native-view-shot) was tried and reverted: importing either of those
 * anywhere in this file — even only require()'d lazily inside a handler —
 * still gets pulled into Metro's static dependency graph and crashes the
 * instant Fast Refresh hot-applies a change to this file on a dev-client
 * build that doesn't have them compiled in yet, not just on first import as
 * expected. The QR itself is still fully on-screen for a screenshot in the
 * meantime; swap this back to real image-sharing once the dev client has
 * been rebuilt with those two native modules included.
 */
function buildReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/** Google's real per-letter brand colors — same mark used on the sign-in button. */
const GOOGLE_LETTERS: { ch: string; color: string }[] = [
  { ch: 'G', color: '#4285F4' },
  { ch: 'o', color: '#EA4335' },
  { ch: 'o', color: '#FBBC05' },
  { ch: 'g', color: '#4285F4' },
  { ch: 'l', color: '#34A853' },
  { ch: 'e', color: '#EA4335' },
];
function GoogleWordmark({ size = 20 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '700' }}>
      {GOOGLE_LETTERS.map((l, i) => (
        <Text key={i} style={{ color: l.color }}>
          {l.ch}
        </Text>
      ))}
    </Text>
  );
}

/** One corner of the printable poster's colorful backdrop — a big soft blob bleeding off the edge, echoing the reference design's wave-corner motif without needing exact path math. */
function CornerBlob({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return <Circle cx={cx} cy={cy} r={r} fill={color} />;
}

/** Small L-shaped corner bracket around the QR box, one Google color per corner. */
function CornerBracket({ position, color }: { position: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const size = 26;
  const thickness = 4;
  const style: any = { position: 'absolute', width: size, height: size, borderColor: color };
  if (position === 'tl') Object.assign(style, { top: -8, left: -8, borderTopWidth: thickness, borderLeftWidth: thickness, borderTopLeftRadius: 10 });
  if (position === 'tr') Object.assign(style, { top: -8, right: -8, borderTopWidth: thickness, borderRightWidth: thickness, borderTopRightRadius: 10 });
  if (position === 'bl') Object.assign(style, { bottom: -8, left: -8, borderBottomWidth: thickness, borderLeftWidth: thickness, borderBottomLeftRadius: 10 });
  if (position === 'br') Object.assign(style, { bottom: -8, right: -8, borderBottomWidth: thickness, borderRightWidth: thickness, borderBottomRightRadius: 10 });
  return <View style={style} />;
}

const POSTER_W = 300;
const POSTER_H = 460;

/**
 * The printable poster — Google's own colors on a dedicated light card,
 * deliberately NOT theme-aware (unlike the rest of the app): this is meant
 * to be screenshotted/printed and displayed standalone at a counter or on a
 * receipt, so it needs to look right on paper regardless of the phone's
 * dark/light setting, the same way the reference design does.
 */
function ReviewPoster({ businessName, reviewUrl }: { businessName: string; reviewUrl: string }) {
  return (
    <View style={{ width: POSTER_W, height: POSTER_H, borderRadius: 24, overflow: 'hidden', backgroundColor: '#ffffff' }}>
      <Svg width={POSTER_W} height={POSTER_H} style={{ position: 'absolute' }}>
        <CornerBlob cx={0} cy={0} r={110} color="#FBBC05" />
        <CornerBlob cx={POSTER_W} cy={0} r={110} color="#EA4335" />
        <CornerBlob cx={0} cy={POSTER_H} r={110} color="#34A853" />
        <CornerBlob cx={POSTER_W} cy={POSTER_H} r={110} color="#4285F4" />
      </Svg>

      <View
        style={{
          position: 'absolute',
          top: 28,
          left: 18,
          right: 18,
          bottom: 28,
          borderRadius: 18,
          backgroundColor: '#ffffff',
          alignItems: 'center',
          paddingTop: 22,
          paddingHorizontal: 18,
        }}
      >
        {/* Google "G" mark in a white circle, like the reference's badge */}
        <View
          style={{
            height: 56,
            width: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#ffffff',
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }}
        >
          <GoogleG size={34} />
        </View>

        <View style={{ flexDirection: 'row', marginTop: 8, gap: 2 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Ionicons key={i} name="star" size={16} color="#FBBC05" />
          ))}
        </View>

        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#191919' }}>Scan to Rate Us on</Text>
          <GoogleWordmark size={16} />
        </View>

        <Text
          style={{ marginTop: 6, textAlign: 'center', fontSize: 15, fontWeight: '700', color: '#191919' }}
          numberOfLines={2}
        >
          {businessName}
        </Text>

        {/* QR with 4 colored corner brackets */}
        <View style={{ marginTop: 20 }}>
          <View style={{ backgroundColor: '#ffffff', padding: 14, borderRadius: 14 }}>
            <QRCode value={reviewUrl} size={150} backgroundColor="#ffffff" color="#191919" />
          </View>
          <CornerBracket position="tl" color="#EA4335" />
          <CornerBracket position="tr" color="#4285F4" />
          <CornerBracket position="bl" color="#FBBC05" />
          <CornerBracket position="br" color="#34A853" />
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ alignItems: 'center', paddingBottom: 4 }}>
          <Text style={{ fontSize: 10, color: '#8d9199', marginBottom: 3 }}>Powered By</Text>
          <Text style={{ fontSize: 15, fontWeight: '800', color: '#06b34c' }}>GrowwMatics</Text>
        </View>
      </View>
    </View>
  );
}

export function ReviewQrModal({
  visible,
  onClose,
  businessName,
  placeId,
}: {
  visible: boolean;
  onClose: () => void;
  businessName: string;
  placeId?: string | null;
}) {
  const t = useTheme();
  const info = useInfoSheet();
  const reviewUrl = placeId ? buildReviewUrl(placeId) : null;

  async function handleShare() {
    if (!reviewUrl) return;
    try {
      await Share.share({
        message: `Leave ${businessName} a Google review: ${reviewUrl}`,
        url: reviewUrl, // iOS uses this as the shared link; Android falls back to `message`.
      });
    } catch {
      info.show('Could not share', 'Please try again.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/70 px-6">
        <View className="w-full max-w-sm items-center rounded-3xl border border-surface-border bg-surface-raised p-6">
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={{ position: 'absolute', right: 16, top: 16, zIndex: 1 }}
          >
            <Ionicons name="close" size={22} color={t.textDim} />
          </Pressable>

          {!reviewUrl ? (
            <EmptyState
              title="Connect Google Business Profile"
              hint="This QR code needs your Google listing connected first — go to Settings to connect it."
            />
          ) : (
            <>
              <Text className="mb-4 mt-2 text-center font-sans text-sm text-zinc-400">
                Screenshot or print this to display anywhere customers can scan it.
              </Text>

              <ReviewPoster businessName={businessName} reviewUrl={reviewUrl} />

              <Pressable
                onPress={handleShare}
                // No `className` — see components/ui.tsx PrimaryButton note.
                style={{
                  marginTop: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: 999,
                  backgroundColor: t.brand,
                  paddingHorizontal: 24,
                  paddingVertical: 12,
                }}
              >
                {/* Fixed white — this button sits on t.brand (same as the header's
                    background), which is always dark/saturated enough for white
                    to read clearly, matching the on-brand icon color convention
                    used on the header and other brand-colored buttons. */}
                <Ionicons name="share-outline" size={18} color="#ffffff" />
                <Text className="font-sans-bold text-sm text-on-brand">Share review link</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      {info.node}
    </Modal>
  );
}
