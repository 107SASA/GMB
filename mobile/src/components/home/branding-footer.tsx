import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** End-of-feed watermark, closing out the Home scroll. */
export function BrandingFooter() {
  const t = useTheme();
  return (
    <View className="mt-12 items-center px-6 py-10 opacity-40">
      <Ionicons name="trending-up-outline" size={28} color={t.textFaint} />
      <Text className="mt-3 text-center font-display-bold text-2xl leading-8 text-zinc-500">
        Powering{'\n'}Your Growth
      </Text>
      <Text className="mt-3 font-sans text-xs text-zinc-600">Made with ❤️ in India</Text>
    </View>
  );
}
