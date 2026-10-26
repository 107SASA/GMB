import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { ErrorText, PrimaryButton, SecondaryButton } from '@/components/ui';
import { openGoogleConnect } from '@/lib/connectGoogle';
import { useTheme } from '@/lib/theme';

interface Props {
  onDone: () => void;
}

/**
 * Final onboarding step — connect Google Business Profile, through the same
 * single-use handoff + in-app browser flow as lib/connectGoogle.tsx. It's
 * skippable: the connection can also be made later from Settings → Google
 * Business Profile.
 */
export function StepConnectGoogle({ onDone }: Props) {
  const t = useTheme();
  const [returned, setReturned] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setOpening(true);
    setError(null);
    try {
      // Resolves once the user closes the sheet (the web flow doesn't
      // redirect back); openGoogleConnect refetches everything then.
      await openGoogleConnect();
      setReturned(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't start the Google connection. Please try again."));
    } finally {
      setOpening(false);
    }
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
        <ErrorText>{error}</ErrorText>
        <PrimaryButton
          title={returned ? 'Reconnect Google' : 'Connect Google Business Profile'}
          onPress={connect}
          loading={opening}
        />
        <SecondaryButton
          title={returned ? 'Done — go to dashboard' : 'Skip for now'}
          onPress={onDone}
        />
      </View>
    </ScrollView>
  );
}
