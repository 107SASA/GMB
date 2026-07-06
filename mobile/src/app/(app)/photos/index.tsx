import { ScrollView, Text, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { BusinessAssets } from '@/components/business-assets';
import { Screen } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * Photos tab — "Business Assets": the GBP photo bucket (Publishing Soon /
 * Published) with smart tips, matching the reference app's screen.
 */
export default function PhotosScreen() {
  const t = useTheme();
  return (
    <Screen>
      <AppHeader title="Business Assets" />
      <View className="border-b border-surface-border px-4 pb-3">
        <Text
          className="self-start pb-1 text-base font-semibold"
          style={{ color: t.brandBright, borderBottomWidth: 2, borderBottomColor: t.brandBright }}
        >
          GBP Photos
        </Text>
      </View>
      <ScrollView contentContainerClassName="pt-4 pb-10">
        <BusinessAssets />
      </ScrollView>
    </Screen>
  );
}
