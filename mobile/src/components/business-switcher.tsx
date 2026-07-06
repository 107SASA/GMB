import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { useBusiness } from '@/business/BusinessContext';
import { InitialsAvatar } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * List of the user's businesses; tapping one makes it the active workspace
 * (updates the x-business-id header and persists the choice).
 * Used both as the first-run picker and as the switcher in the More tab.
 */
export function BusinessSwitcher() {
  const { businesses, activeBusinessId, selectBusiness } = useBusiness();
  const t = useTheme();

  return (
    <View className="gap-2.5">
      {businesses.map((business) => {
        const active = business._id === activeBusinessId;
        return (
          <Pressable
            key={business._id}
            onPress={() => void selectBusiness(business._id)}
            className={`flex-row items-center gap-3 rounded-2xl border p-3.5 ${
              active
                ? 'border-brand/60 bg-brand/10'
                : 'border-surface-border bg-surface-raised active:bg-surface-overlay'
            }`}
          >
            <InitialsAvatar
              name={business.name}
              size={40}
              colors={active ? undefined : t.inactiveAvatar}
            />
            <View className="flex-1">
              <Text className="text-base font-semibold text-white" numberOfLines={1}>
                {business.name}
              </Text>
              {!!business.address && (
                <Text className="text-xs text-zinc-400" numberOfLines={1}>
                  {business.address}
                </Text>
              )}
            </View>
            {active ? (
              <Ionicons name="checkmark-circle" size={22} color={t.brandBright} />
            ) : (
              <View className="h-5 w-5 rounded-full border-2 border-surface-border" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
