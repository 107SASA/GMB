import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { useBusiness } from '@/business/BusinessContext';
import { InitialsAvatar } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/**
 * List of the user's businesses; tapping one makes it the active workspace
 * (updates the x-business-id header and persists the choice).
 * Used both as the first-run picker and as the switcher in the More tab.
 *
 * When the user has more than one workspace, each row exposes a delete
 * action (trash → confirm). The last remaining workspace can't be deleted —
 * the app always needs at least one active business.
 */
export function BusinessSwitcher() {
  const { businesses, activeBusinessId, selectBusiness, deleteBusiness } = useBusiness();
  const t = useTheme();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canDelete = businesses.length > 1;

  const confirmDelete = (id: string, name: string) => {
    Alert.alert(
      'Delete workspace?',
      `"${name}" and its Google connection will be removed from your account. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setDeletingId(id);
            try {
              await deleteBusiness(id);
            } catch {
              Alert.alert('Could not delete workspace', 'Something went wrong. Please try again.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View className="gap-2.5">
      {businesses.map((business) => {
        const active = business._id === activeBusinessId;
        const busy = deletingId === business._id;
        return (
          <Pressable
            key={business._id}
            onPress={() => void selectBusiness(business._id)}
            disabled={busy}
            className={`flex-row items-center gap-3 rounded-card border p-3.5 ${
              active
                ? 'border-brand/60 bg-brand/10'
                : 'border-surface-border bg-surface-raised active:bg-surface-overlay'
            } ${busy ? 'opacity-50' : ''}`}
          >
            <InitialsAvatar
              name={business.name}
              size={40}
              colors={active ? undefined : t.inactiveAvatar}
            />
            <View className="flex-1">
              <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>
                {business.name}
              </Text>
              {!!business.address && (
                <Text className="font-sans text-xs text-zinc-400" numberOfLines={1}>
                  {business.address}
                </Text>
              )}
            </View>
            {active ? (
              <Ionicons name="checkmark-circle" size={22} color={t.brandBright} />
            ) : (
              <View className="h-5 w-5 rounded-full border-2 border-surface-border" />
            )}
            {canDelete &&
              (busy ? (
                <ActivityIndicator size="small" color={t.textFaint} />
              ) : (
                <Pressable
                  hitSlop={10}
                  onPress={() => confirmDelete(business._id, business.name)}
                  className="ml-1 h-9 w-9 items-center justify-center rounded-xl active:bg-surface-overlay"
                >
                  <Ionicons name="trash-outline" size={18} color={t.rose} />
                </Pressable>
              ))}
          </Pressable>
        );
      })}
    </View>
  );
}
