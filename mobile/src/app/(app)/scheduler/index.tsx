import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { generateBufferPosts } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { SchedulerPanel } from '@/components/scheduler-panel';
import { Screen, ScreenTitle } from '@/components/ui';
import { useTheme } from '@/lib/theme';

export default function SchedulerScreen() {
  const { activeBusinessId } = useBusiness();
  const t = useTheme();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const generateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The ref above exists specifically so this timer can be cancelled — it
  // previously wasn't, so navigating away from this screen within the 6s
  // window still called setGenerating/invalidateQueries against an
  // unmounted screen.
  useEffect(() => {
    return () => {
      if (generateTimer.current) clearTimeout(generateTimer.current);
    };
  }, []);

  const generate = useMutation({
    mutationFn: generateBufferPosts,
    onSuccess: () => {
      // The job runs in the background — refetch once it has had a moment,
      // same as the web dashboard's delayed refresh.
      setGenerating(true);
      generateTimer.current = setTimeout(() => {
        setGenerating(false);
        void queryClient.invalidateQueries({ queryKey: ['scheduler-buffer', activeBusinessId] });
        void queryClient.invalidateQueries({ queryKey: ['content-posts', activeBusinessId] });
      }, 6000);
    },
    onError: (err) => Alert.alert('Error', getApiErrorMessage(err, 'Could not start generation.')),
  });

  return (
    <Screen>
      <View className="flex-row items-center justify-between pr-5">
        <ScreenTitle>Content Scheduler</ScreenTitle>
        <Pressable
          onPress={() => generate.mutate()}
          disabled={generate.isPending || generating}
          // No `className` — react-native-css-interop can swallow onPress on
          // styled Pressables (see components/ui.tsx).
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: generate.isPending || generating ? t.brandMuted : t.brand,
            opacity: generate.isPending || generating ? 0.6 : 1,
          }}
        >
          {generate.isPending || generating ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="sparkles" size={14} color="#ffffff" />
          )}
          <Text className="font-sans-bold text-sm text-on-brand">
            {generating ? 'Generating…' : 'Generate'}
          </Text>
        </Pressable>
      </View>

      <SchedulerPanel />
    </Screen>
  );
}
