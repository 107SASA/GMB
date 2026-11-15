import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useBusiness } from '@/business/BusinessContext';
import { Badge, InitialsAvatar, useConfirmSheet, useInfoSheet } from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * List of the user's businesses; tapping one makes it the active workspace
 * (updates the x-business-id header and persists the choice).
 * Used both as the first-run picker and as the switcher in the More tab.
 *
 * Each row shows a Pro/Free badge. As the switcher (default), a user with more
 * than one workspace gets a delete action per row (trash → confirm); the last
 * remaining workspace can't be deleted — the app always needs one.
 * As the sign-in `picker`, the last-used workspace is listed first and tagged
 * "Last used", and delete is hidden so a tap always just opens a workspace.
 */
export function BusinessSwitcher({ mode = 'switcher' }: { mode?: 'switcher' | 'picker' }) {
  const { businesses, activeBusinessId, lastUsedBusinessId, selectBusiness, deleteBusiness } = useBusiness();
  const picker = mode === 'picker';
  const t = useTheme();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const info = useInfoSheet();
  const confirmSheet = useConfirmSheet();

  const canDelete = !picker && businesses.length > 1;

  // Picker: last used first, then paid workspaces, then the rest (stable).
  const rows = useMemo(() => {
    if (!picker) return businesses;
    const rank = (b: (typeof businesses)[number]) =>
      (b._id === lastUsedBusinessId ? 2 : 0) + (b.planActive ? 1 : 0);
    return [...businesses].sort((a, b) => rank(b) - rank(a));
  }, [businesses, lastUsedBusinessId, picker]);

  const confirmDelete = (id: string, name: string) => {
    confirmSheet.confirm({
      title: 'Delete workspace?',
      message: `"${name}" and its Google connection will be removed from your account. This can't be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setDeletingId(id);
        try {
          await deleteBusiness(id);
        } catch {
          info.show('Could not delete workspace', 'Something went wrong. Please try again.');
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  return (
    <View className="gap-2.5">
      {rows.map((business) => {
        const active = business._id === activeBusinessId;
        // In the picker nothing is selected yet, so "Last used" gets the highlight.
        const highlighted = active || (picker && business._id === lastUsedBusinessId);
        const busy = deletingId === business._id;
        return (
          <Pressable
            key={business._id}
            onPress={() => void selectBusiness(business._id)}
            disabled={busy}
            // No `className` on this Pressable — react-native-css-interop can
            // swallow onPress on styled Pressables (confirmed by device
            // testing; see ui.tsx PrimaryButton for the full explanation).
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderRadius: 20,
              borderWidth: 1,
              padding: 14,
              borderColor: highlighted ? withAlpha(t.brand, 0.6) : t.border,
              backgroundColor: highlighted ? withAlpha(t.brand, 0.1) : t.card,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <InitialsAvatar
              name={business.name}
              size={40}
              colors={highlighted ? undefined : t.inactiveAvatar}
              imageUrl={business.logoUrl}
            />
            <View className="min-w-0 flex-1">
              <View className="mb-1 flex-row flex-wrap gap-1.5">
                <Badge label={business.planActive ? 'Pro' : 'Free'} tone={business.planActive ? 'positive' : 'neutral'} />
                {picker && business._id === lastUsedBusinessId && <Badge label="Last used" tone="info" />}
              </View>
              <Text className="font-sans-semibold text-base text-white" numberOfLines={1}>
                {business.name}
              </Text>
              {!!business.address && (
                <Text className="font-sans text-xs text-zinc-400" numberOfLines={1}>
                  {business.address}
                </Text>
              )}
            </View>
            {picker ? (
              <Ionicons name="chevron-forward" size={20} color={highlighted ? t.brandBright : t.textFaint} />
            ) : active ? (
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
                  // No `className` — see note above.
                  style={{
                    marginLeft: 4,
                    height: 36,
                    width: 36,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={t.rose} />
                </Pressable>
              ))}
          </Pressable>
        );
      })}
      {info.node}
      {confirmSheet.node}
    </View>
  );
}
