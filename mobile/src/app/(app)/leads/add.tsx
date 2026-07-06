import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { logLeadActivity, quickAddLead } from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { useCrmCaptureConsent } from '@/components/consent-sheet';
import {
  BackChevron, ErrorText, Field, PrimaryButton, Screen
} from '@/components/ui';
import { parsePhoneCandidate } from '@/lib/phone';

/**
 * Quick lead capture. Plain mode adds a lead; ?intent=call is the "Log a
 * call" quick action — same capture, but with source "Phone Call" and a call
 * Activity (+ optional note) appended.
 */
export default function AddLeadScreen() {
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const isCallLog = intent === 'call';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeBusinessId } = useBusiness();
  const { ensureConsent, consentSheet } = useCrmCaptureConsent();

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [clipboardPhone, setClipboardPhone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Android: preview the clipboard number as a one-tap chip. iOS 14+ shows a
  // system "pasted from" banner on every read, so there we only read on an
  // explicit tap (generic "Paste number" chip instead of a preview).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    void (async () => {
      try {
        const text = await Clipboard.getStringAsync();
        const candidate = parsePhoneCandidate(text);
        if (!cancelled && candidate) setClipboardPhone(candidate);
      } catch {
        // No clipboard access — chip just doesn't appear.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pasteFromClipboard() {
    const text = await Clipboard.getStringAsync().catch(() => '');
    const candidate = parsePhoneCandidate(text);
    if (candidate) {
      setPhone(candidate);
      setNotice(null);
    } else {
      setNotice("The clipboard doesn't contain a phone number.");
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      const result = await quickAddLead({
        phone: phone.trim(),
        name: name.trim() || undefined,
        source: isCallLog ? 'Phone Call' : 'Manual',
      });
      if (isCallLog) {
        await logLeadActivity(result.lead._id, {
          type: 'call',
          content: note.trim() || 'Phone call logged from mobile',
        });
      }
      return result;
    },
    onMutate: () => setError(null),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
      if (isCallLog) {
        void queryClient.invalidateQueries({
          queryKey: ['lead-timeline', activeBusinessId, result.lead._id],
        });
      }
      router.replace(`/leads/${result.lead._id}`);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to add the lead.')),
  });

  const phoneValid = parsePhoneCandidate(phone) !== null;

  return (
    <Screen>
      {consentSheet}
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8} className="active:opacity-60">
          <BackChevron />
        </Pressable>
        <Text className="text-lg font-bold text-white">
          {isCallLog ? 'Log a call' : 'Add lead'}
        </Text>
      </View>

      <ScrollView contentContainerClassName="gap-3 px-5 pt-4" keyboardShouldPersistTaps="handled">
        {/* Paste chip */}
        {Platform.OS === 'android' && clipboardPhone && clipboardPhone !== phone ? (
          <Pressable
            onPress={() => setPhone(clipboardPhone)}
            className="flex-row items-center gap-2 self-start rounded-full border border-brand/50 bg-indigo-400/15 px-3.5 py-2 active:opacity-70"
          >
            <Ionicons name="clipboard-outline" size={14} color="#6366F1" />
            <Text className="text-sm font-medium text-indigo-300">Paste {clipboardPhone}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void pasteFromClipboard()}
            className="flex-row items-center gap-2 self-start rounded-full border border-surface-border bg-surface-raised px-3.5 py-2 active:opacity-70"
          >
            <Ionicons name="clipboard-outline" size={14} color="#8B93B8" />
            <Text className="text-sm font-medium text-zinc-300">Paste number</Text>
          </Pressable>
        )}
        {!!notice && <Text className="text-sm text-zinc-500">{notice}</Text>}

        <Field
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            setNotice(null);
          }}
          placeholder="Phone number (e.g. +91 98765 43210)"
          keyboardType="phone-pad"
          autoFocus
        />
        <Field value={name} onChangeText={setName} placeholder="Name (optional)" />
        {isCallLog && (
          <Field
            value={note}
            onChangeText={setNote}
            placeholder="How did the call go? (optional)"
            multiline
            className="min-h-20"
            textAlignVertical="top"
          />
        )}

        {!!phone.trim() && !phoneValid && (
          <Text className="text-sm text-zinc-500">
            Enter a 10-digit number or use +country format.
          </Text>
        )}
        <ErrorText>{error}</ErrorText>

        <PrimaryButton
          title={isCallLog ? 'Save call' : 'Add lead'}
          loading={submit.isPending}
          disabled={!phoneValid}
          onPress={() => {
            void (async () => {
              // Call capture counts as a CRM-capture feature — one-time consent.
              if (isCallLog && !(await ensureConsent())) return;
              submit.mutate();
            })();
          }}
        />
        <Text className="text-center text-xs text-zinc-600">
          If this number already exists, you'll be taken to the existing lead.
        </Text>
      </ScrollView>
    </Screen>
  );
}
