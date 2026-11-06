import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { fetchGoogleAccess, recheckGoogleAccess } from '@/api/endpoints/googleAccess';
import { useBusiness } from '@/business/BusinessContext';
import { BottomSheet } from '@/components/ui';
import { openGoogleConnect } from '@/lib/connectGoogle';
import { useTheme } from '@/lib/theme';

/** Popup shown once per app session per workspace + problem. */
const popupShown = new Set<string>();

/**
 * "Google refused access" banner + popup for the Home screen (same states and
 * wording as the web dashboard, from GET /api/gbp/access). Reconnect opens
 * the Google connect flow; Check again re-runs the sync.
 */
export function GoogleAccessBanner() {
  const t = useTheme();
  const qc = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const access = useQuery({
    queryKey: ['google-access', activeBusinessId],
    queryFn: fetchGoogleAccess,
    enabled: !!activeBusinessId,
    // While the first check runs, look again every 20 s.
    refetchInterval: (q) => (q.state.data?.status === 'checking' ? 20_000 : false),
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = access.data;
  const problem = data?.status === 'limited' || data?.status === 'blocked';
  const key = `${activeBusinessId}:${data?.reason ?? ''}`;
  useEffect(() => {
    if (problem && !popupShown.has(key)) {
      popupShown.add(key);
      setSheetOpen(true);
    }
  }, [problem, key]);

  if (!data?.copy || (data.status !== 'checking' && !problem)) return null;
  const copy = data.copy;

  if (data.status === 'checking') {
    return (
      <View className="mx-5 mb-2 flex-row items-start gap-2 rounded-xl px-3.5 py-2.5" style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
        <ActivityIndicator size="small" color={t.brand} />
        <View style={{ flex: 1 }}>
          <Text className="font-sans-bold text-xs" style={{ color: t.text }}>{copy.title}</Text>
          <Text className="mt-0.5 font-sans text-xs" style={{ color: t.textDim }}>{copy.body}</Text>
        </View>
      </View>
    );
  }

  const checkAgain = async () => {
    setBusy(true);
    setError(null);
    try {
      await recheckGoogleAccess();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not check right now — try again in a minute.'));
    } finally {
      await qc.invalidateQueries({ queryKey: ['google-access'] });
      setBusy(false);
    }
  };
  const reconnect = async () => {
    setSheetOpen(false);
    try {
      await openGoogleConnect();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not open Google — try again.'));
    }
  };

  const buttons = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      {copy.reconnect && (
        <Pressable onPress={reconnect} style={{ borderRadius: 999, backgroundColor: t.brand, paddingVertical: 8, paddingHorizontal: 14 }}>
          <Text className="font-sans-bold text-xs text-on-brand">Reconnect Google</Text>
        </Pressable>
      )}
      <Pressable
        onPress={checkAgain}
        disabled={busy}
        style={{ borderRadius: 999, borderWidth: 1, borderColor: t.brand, backgroundColor: t.card, paddingVertical: 8, paddingHorizontal: 14, opacity: busy ? 0.6 : 1 }}
      >
        <Text className="font-sans-bold text-xs" style={{ color: t.brand }}>{busy ? 'Checking…' : 'Check again'}</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      <View accessibilityRole="alert" className="mx-5 mb-2 rounded-xl px-3.5 py-3" style={{ backgroundColor: t.errorContainer }}>
        <View className="flex-row items-start gap-2">
          <Ionicons name="warning-outline" size={18} color={t.onErrorContainer} />
          <View style={{ flex: 1 }}>
            <Text className="font-sans-bold text-sm" style={{ color: t.onErrorContainer }}>{copy.title}</Text>
            <Text className="mt-0.5 font-sans text-xs" style={{ color: t.onErrorContainer }}>{copy.body}</Text>
            {buttons}
            {copy.steps.length > 0 && (
              <Pressable onPress={() => setSheetOpen(true)} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                <Text className="font-sans-semibold text-xs underline" style={{ color: t.onErrorContainer }}>Show me how</Text>
              </Pressable>
            )}
            {error && <Text className="mt-2 font-sans text-xs" style={{ color: t.onErrorContainer }}>{error}</Text>}
          </View>
        </View>
      </View>

      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text className="font-display-bold text-lg" style={{ color: t.text }}>{copy.title}</Text>
        <Text className="mt-2 font-sans text-sm leading-5" style={{ color: t.textDim }}>{copy.body}</Text>
        {data.googleEmail ? (
          <Text className="mt-2 font-sans text-xs" style={{ color: t.textDim }}>
            Connected Google account: <Text className="font-sans-bold" style={{ color: t.text }}>{data.googleEmail}</Text>
          </Text>
        ) : null}
        {copy.steps.length > 0 && (
          <View className="mt-4 rounded-xl p-4" style={{ borderWidth: 1, borderColor: t.border }}>
            <Text className="mb-2 font-sans-bold text-xs" style={{ color: t.text }}>How to fix it</Text>
            {copy.steps.map((s, i) => (
              <Text key={s} className="mb-1.5 font-sans text-xs leading-5" style={{ color: t.textDim }}>{i + 1}. {s}</Text>
            ))}
            <Pressable onPress={() => void Linking.openURL('https://business.google.com/')}>
              <Text className="mt-1 font-sans-bold text-xs" style={{ color: t.brand }}>Open Google Business Profile</Text>
            </Pressable>
          </View>
        )}
        {buttons}
        <Pressable onPress={() => setSheetOpen(false)} style={{ marginTop: 16, alignItems: 'center', paddingVertical: 10 }}>
          <Text className="font-sans-semibold text-sm" style={{ color: t.textDim }}>Close</Text>
        </Pressable>
      </BottomSheet>
    </>
  );
}
