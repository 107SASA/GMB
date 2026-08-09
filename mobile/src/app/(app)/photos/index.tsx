import { ScrollView } from 'react-native';

import { AppHeader } from '@/components/app-header';
import { BusinessAssets } from '@/components/business-assets';
import { Screen } from '@/components/ui';

/**
 * Photos tab — recent photos/videos summary, "View All" into the full
 * filterable gallery (photos/all.tsx), and the scheduled-photos timeline.
 */
export default function PhotosScreen() {
  return (
    <Screen>
      <AppHeader title="Photos" />
      <ScrollView contentContainerClassName="pt-4 pb-10">
        <BusinessAssets />
      </ScrollView>
    </Screen>
  );
}
