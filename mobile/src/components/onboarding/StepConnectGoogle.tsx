import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { PrimaryButton, SecondaryButton } from '@/components/ui';
import { useTheme } from '@/lib/theme';

interface Props {
  onDone: () => void;
}

/**
 * Final onboarding step — connect Google Business Profile. GBP OAuth has no
 * native mobile flow, so this opens the web dashboard's /api/auth/google route
 * in an in-app browser, exactly like lib/connectGoogle.tsx does everywhere
 * else in the app. It's skippable: the connection can also be made later from
 * Settings → Google Business Profile.
 */
export function StepConnectGoogle({ onDone }: Props) {
  const t = useTheme();
  const queryClient = useQueryClient();
  const [returned, setReturned] = useState(false);

  async function connect() {
    await WebBrowser.openBrowserAsync(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/google`);
    // The in-app browser has no redirect back into the app, so we only know
    // the user dismissed it — refresh the workspace data so a successful
    // connection is reflected, and let them finish.
    setReturned(true);
    void queryClient.invalidateQueries({ queryKey: ['businesses'] });
    void queryClient.invalidateQueries({ queryKey: ['business-detail'] });
  }

  return (
    <ScrollView contentContainerClassName="px-5 pb-16 pt-2" keyboardShouldPersistTaps="handled">
      <View className="mb-5 items-center">
        <View
          className="mb-4 h-16 w-16 items-center justify-center rounded-2xl"
          style={{ backgroundColor: t.card, borderWidth: 1, borderColor: t.border }}
        >
          <Ionicons name="logo-google" size={28} color={t.brandBright} />
        </View>
        <Text className="mb-1 text-center font-display-bold text-lg text-white">
          Connect Google Business Profile
        </Text>
        <Text className="text-center font-sans text-sm leading-5 text-zinc-400">
          This lets us sync your reviews, publish posts, and track your Google Maps ranking
          automatically. You can also do this later from Settings.
        </Text>
      </View>

      <View className="gap-3">
        <PrimaryButton
          title={returned ? 'Reconnect Google' : 'Connect Google Business Profile'}
          onPress={connect}
        />
        <SecondaryButton
          title={returned ? 'Done — go to dashboard' : 'Skip for now'}
          onPress={onDone}
        />
      </View>
    </ScrollView>
  );
}
