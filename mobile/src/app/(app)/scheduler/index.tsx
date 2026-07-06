import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { generateBufferPosts } from '@/api/endpoints/scheduler';
import { useBusiness } from '@/business/BusinessContext';
import { SchedulerPanel } from '@/components/scheduler-panel';
import { Screen, ScreenTitle } from '@/components/ui';

export default function SchedulerScreen() {
  const { activeBusinessId } = useBusiness();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const generateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          className={`flex-row items-center gap-1.5 rounded-full px-4 py-2 ${
            generate.isPending || generating ? 'bg-brand-muted opacity-60' : 'bg-brand active:opacity-80'
          }`}
        >
          {generate.isPending || generating ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Ionicons name="sparkles" size={14} color="#ffffff" />
          )}
          <Text className="text-sm font-semibold text-on-brand">
            {generating ? 'Generating…' : 'Generate'}
          </Text>
        </Pressable>
      </View>

      <SchedulerPanel />
    </Screen>
  );
}
