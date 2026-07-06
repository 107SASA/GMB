import * as SecureStore from 'expo-secure-store';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

const CONSENT_KEY = 'crm_capture_consent_v1';

/**
 * First-use consent for contact/call capture (store-policy requirement:
 * users must understand that selected contacts leave the device and land in
 * their business CRM). Shown once; the choice is persisted.
 *
 * Usage:
 *   const { ensureConsent, consentSheet } = useCrmCaptureConsent();
 *   ...
 *   if (!(await ensureConsent())) return; // user declined
 *   ...
 *   return <>{consentSheet}...</>
 */
export function useCrmCaptureConsent(): {
  ensureConsent: () => Promise<boolean>;
  consentSheet: ReactNode;
} {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((granted: boolean) => void) | null>(null);

  const ensureConsent = useCallback(async () => {
    const stored = await SecureStore.getItemAsync(CONSENT_KEY).catch(() => null);
    if (stored === 'granted') return true;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, []);

  const settle = useCallback((granted: boolean) => {
    setVisible(false);
    if (granted) {
      void SecureStore.setItemAsync(CONSENT_KEY, 'granted').catch(() => {});
    }
    resolver.current?.(granted);
    resolver.current = null;
  }, []);

  const consentSheet = (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => settle(false)}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="rounded-t-3xl border border-surface-border bg-surface-raised px-6 pb-10 pt-6">
          <Text className="text-lg font-bold text-white">Save contacts to your CRM</Text>
          <Text className="mt-2 text-sm leading-5 text-zinc-400">
            Contacts and call details you explicitly select are saved to your business CRM so
            you and your team can follow up. Nothing is read or uploaded automatically — only
            the entries you choose.
          </Text>
          <Pressable
            onPress={() => settle(true)}
            className="mt-5 items-center rounded-xl bg-brand py-3.5 active:opacity-80"
          >
            <Text className="text-base font-semibold text-on-brand">Continue</Text>
          </Pressable>
          <Pressable onPress={() => settle(false)} className="mt-2 items-center py-3 active:opacity-60">
            <Text className="text-sm font-medium text-zinc-400">Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  return { ensureConsent, consentSheet };
}
