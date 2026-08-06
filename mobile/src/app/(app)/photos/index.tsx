import { ScrollView, Text, View } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { BusinessAssets } from '@/components/business-assets';
import { Screen } from '@/components/ui';

/**
 * Photos tab — "Business Assets": the GBP photo bucket (Publishing Soon /
 * Published) with smart tips, matching the reference app's screen.
 */
export default function PhotosScreen() {
  return (
    <Screen>
      <AppHeader title="Business Assets" />
      {/* Plain section label, not a tab-underline style — this screen has no
          sibling tabs, and the earlier active-tab-looking treatment (bold +
          brand underline) implied there were more tabs to switch between. */}
      <View className="border-b border-surface-border px-4 pb-3">
        <Text className="self-start pb-1 font-sans-bold text-base text-white">GBP Photos</Text>
      </View>
      <ScrollView contentContainerClassName="pt-4 pb-10">
        <BusinessAssets />
      </ScrollView>
    </Screen>
  );
}
