import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetInfo } from '@react-native-community/netinfo';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Contact } from 'expo-contacts';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  logLeadActivity,
  saveBusinessCardLead,
  scanBusinessCard,
  type CardFields,
  type CardPhoto,
  type QuickAddResult,
} from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { BackChevron, ErrorText, Field, PrimaryButton, Screen, SecondaryButton } from '@/components/ui';
import { enqueueCard, isOfflineError, listQueuedCards, removeQueuedCard, type QueuedCard } from '@/lib/cardQueue';
import { whatsappNumber } from '@/lib/format';
import { parsePhoneCandidate } from '@/lib/phone';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Scan a visiting card → AI fills the form → owner checks it → Save.
 * Nothing reaches the CRM until Save. "Where we met" is remembered between
 * scans so a whole conference can be tagged without retyping it.
 *
 * No signal? The photos are kept on the phone (lib/cardQueue.ts) and listed
 * as "waiting" until the owner reads them with a connection.
 *
 * After saving, the owner can send an intro from THEIR OWN WhatsApp / email
 * app (nothing is sent automatically — exchanging a card is not consent to
 * be messaged by a system) and add the person to the phone's contacts.
 */

const MET_AT_KEY = 'cardScan.metAt';
const INTRO_KEY = 'cardScan.introTemplate';
const DEFAULT_INTRO =
  'Hi {name}, it was great meeting you{at event}! This is {business}. Saving your number here — do reach out whenever we can help.';

function fillIntro(template: string, v: { name: string; event: string; business: string }): string {
  return template
    .replace(/\{name\}/g, v.name.split(' ')[0] || 'there')
    .replace(/\{at event\}/g, v.event ? ` at ${v.event}` : '')
    .replace(/\{event\}/g, v.event)
    .replace(/\{business\}/g, v.business)
    .replace(/\s+([!.,])/g, '$1');
}

type Saved = { result: QuickAddResult; form: Form; phones: string[]; emails: string[] };

type Form = {
  name: string;
  phone: string;
  email: string;
  company: string;
  designation: string;
  website: string;
  address: string;
  city: string;
  metAt: string;
  notes: string;
  valuation: string;
};

const EMPTY_FORM: Form = {
  name: '', phone: '', email: '', company: '', designation: '', website: '', address: '', city: '', metAt: '', notes: '', valuation: '',
};

async function capture(source: 'camera' | 'library'): Promise<CardPhoto | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || result.assets.length === 0) return null;
  const a = result.assets[0];
  return { uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? `card-${Date.now()}.jpg` };
}

function PhotoSlot({
  label,
  photo,
  onTake,
  onPick,
  onRemove,
}: {
  label: string;
  photo: CardPhoto | null;
  onTake: () => void;
  onPick: () => void;
  onRemove?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text className="font-sans-semibold text-sm text-zinc-400">{label}</Text>
      {photo ? (
        <View>
          <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 1.75, borderRadius: 14 }} contentFit="cover" />
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <Pressable onPress={onTake} hitSlop={6}>
              <Text className="font-sans-semibold text-sm text-indigo-300">Retake</Text>
            </Pressable>
            {onRemove && (
              <Pressable onPress={onRemove} hitSlop={6}>
                <Text className="font-sans-semibold text-sm text-zinc-500">Remove</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={onTake}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              aspectRatio: 1.75,
              borderRadius: 14,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: withAlpha(t.brand, 0.6),
              backgroundColor: withAlpha(t.brand, 0.08),
            }}
          >
            <Ionicons name="camera-outline" size={28} color={t.brandBright} />
            <Text className="font-sans-semibold text-sm text-indigo-300">Take photo</Text>
          </Pressable>
          <Pressable
            onPress={onPick}
            style={{
              width: 88,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: t.card,
            }}
          >
            <Ionicons name="images-outline" size={22} color={t.textFaint} />
            <Text className="font-sans text-xs text-zinc-400">Gallery</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Labeled({ label, unsure, children }: { label: string; unsure?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text className="font-sans-semibold text-xs uppercase tracking-wider text-zinc-500">{label}</Text>
        {unsure && <Text className="font-sans-semibold text-xs text-amber-400">· please check</Text>}
      </View>
      {children}
    </View>
  );
}

export default function ScanCardScreen() {
  const router = useRouter();
  const t = useTheme();
  const queryClient = useQueryClient();
  const { activeBusinessId, activeBusiness } = useBusiness();
  const { isConnected } = useNetInfo();
  const offline = isConnected === false;

  const [front, setFront] = useState<CardPhoto | null>(null);
  const [back, setBack] = useState<CardPhoto | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [scanned, setScanned] = useState<{ fields: CardFields; imageKeys: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [queue, setQueue] = useState<QueuedCard[]>([]);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [editingIntro, setEditingIntro] = useState(false);
  const [sentVia, setSentVia] = useState<string[]>([]);

  const refreshQueue = useCallback(() => {
    void listQueuedCards().then(setQueue);
  }, []);
  useFocusEffect(refreshQueue);

  // Remembered event ("Delhi Expo 2026") and intro message for the next scans.
  useEffect(() => {
    AsyncStorage.getItem(MET_AT_KEY)
      .then((v) => v && setForm((f) => (f.metAt ? f : { ...f, metAt: v })))
      .catch(() => {});
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => v && setIntro(v))
      .catch(() => {});
  }, []);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function resetForNext() {
    setFront(null);
    setBack(null);
    setScanned(null);
    setQueueId(null);
    setSaved(null);
    setSentVia([]);
    setError(null);
    setForm((f) => ({ ...EMPTY_FORM, metAt: f.metAt }));
  }

  async function take(slot: 'front' | 'back', source: 'camera' | 'library') {
    try {
      const p = await capture(source);
      if (!p) return;
      (slot === 'front' ? setFront : setBack)(p);
      setError(null);
      setNotice(null);
    } catch (e: any) {
      if (e?.message === 'permission') {
        Alert.alert(
          source === 'camera' ? 'Camera access needed' : 'Photo access needed',
          'Allow access in Settings to scan visiting cards.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => void Linking.openSettings() }],
        );
      } else {
        setError('Could not open the camera. Please try again.');
      }
    }
  }

  async function keepForLater() {
    if (!front) return;
    try {
      await enqueueCard(front, back, form.metAt.trim());
      await AsyncStorage.setItem(MET_AT_KEY, form.metAt.trim()).catch(() => {});
      resetForNext();
      setNotice('Saved on this phone. Read it when you have internet — it will wait in the list below.');
      refreshQueue();
    } catch (e: any) {
      setError(e?.message || 'Could not keep the photo on this phone.');
    }
  }

  const scan = useMutation({
    mutationFn: (p: { front: CardPhoto; back: CardPhoto | null; queued?: boolean }) => scanBusinessCard(p.front, p.back),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: ({ fields, imageKeys }) => {
      setScanned({ fields, imageKeys });
      setForm((f) => ({
        ...f,
        name: fields.name,
        phone: fields.phones[0]?.number ?? '',
        email: fields.emails[0] ?? '',
        company: fields.company,
        designation: fields.designation,
        website: fields.website,
        address: fields.address,
        city: fields.city,
      }));
    },
    onError: (err, vars) => {
      if (isOfflineError(err) && !vars.queued) {
        // Lost signal mid-scan: keep the card instead of losing it.
        void keepForLater();
        return;
      }
      setError(getApiErrorMessage(err, 'Could not read the card. Check your internet and try again.'));
    },
  });

  function readQueued(card: QueuedCard) {
    setFront(card.front);
    setBack(card.back);
    setQueueId(card.id);
    setForm((f) => ({ ...EMPTY_FORM, metAt: card.metAt || f.metAt }));
    scan.mutate({ front: card.front, back: card.back, queued: true });
  }

  function discardQueued(card: QueuedCard) {
    Alert.alert('Remove this card?', 'The photo will be deleted from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeQueuedCard(card.id).then(refreshQueue) },
    ]);
  }

  const trimmedValuation = form.valuation.trim();
  const valuationValid = !trimmedValuation || (Number.isFinite(Number(trimmedValuation)) && Number(trimmedValuation) >= 0);
  const phoneValid = !form.phone.trim() || parsePhoneCandidate(form.phone) !== null;
  const hasContact = !!(form.name.trim() || form.phone.trim() || form.email.trim());

  const save = useMutation({
    mutationFn: async () => {
      const primaryPhone = form.phone.trim();
      const primaryEmail = form.email.trim().toLowerCase();
      const otherPhones = scanned?.fields.phones.map((p) => p.number).filter((n) => n !== primaryPhone) ?? [];
      const otherEmails = scanned?.fields.emails.filter((e) => e !== primaryEmail) ?? [];
      const result = await saveBusinessCardLead({
        name: form.name.trim() || undefined,
        phone: primaryPhone || undefined,
        email: primaryEmail || undefined,
        company: form.company.trim() || undefined,
        designation: form.designation.trim() || undefined,
        website: form.website.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        metAt: form.metAt.trim() || undefined,
        notes: form.notes.trim() || undefined,
        valuation: trimmedValuation ? Number(trimmedValuation) : undefined,
        otherPhones,
        otherEmails,
        imageKeys: scanned?.imageKeys,
      });
      await AsyncStorage.setItem(MET_AT_KEY, form.metAt.trim()).catch(() => {});
      return { result, phones: [primaryPhone, ...otherPhones].filter(Boolean), emails: [primaryEmail, ...otherEmails].filter(Boolean) };
    },
    onMutate: () => setError(null),
    onSuccess: ({ result, phones, emails }) => {
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
      if (queueId) void removeQueuedCard(queueId).then(refreshQueue);
      setSavedCount((c) => c + 1);
      setSaved({ result, form, phones, emails });
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Failed to save the lead.')),
  });

  const introText = saved
    ? fillIntro(intro, { name: saved.form.name, event: saved.form.metAt.trim(), business: activeBusiness?.name ?? 'us' })
    : '';

  async function sendIntro(via: 'WhatsApp' | 'email') {
    if (!saved) return;
    const url =
      via === 'WhatsApp'
        ? `https://wa.me/${whatsappNumber(saved.form.phone)}?text=${encodeURIComponent(introText)}`
        : `mailto:${saved.form.email}?subject=${encodeURIComponent(`Great meeting you${saved.form.metAt ? ` at ${saved.form.metAt}` : ''}`)}&body=${encodeURIComponent(introText)}`;
    try {
      await Linking.openURL(url);
      setSentVia((v) => [...v, via]);
      await logLeadActivity(saved.result.lead._id, { type: via, content: `Intro message opened in ${via === 'WhatsApp' ? 'WhatsApp' : 'email'}:\n${introText}` }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ['lead-timeline', activeBusinessId, saved.result.lead._id] });
    } catch {
      setError(via === 'WhatsApp' ? 'WhatsApp is not installed on this phone.' : 'No email app is set up on this phone.');
    }
  }

  async function addToContacts() {
    if (!saved) return;
    const f = saved.form;
    const [givenName, ...rest] = f.name.trim().split(/\s+/);
    const record = {
      givenName: givenName || f.company.trim() || 'New contact',
      familyName: rest.join(' ') || undefined,
      company: f.company.trim() || undefined,
      jobTitle: f.designation.trim() || undefined,
      phones: saved.phones.map((number, i) => ({ label: i === 0 ? 'mobile' : 'work', number })),
      emails: saved.emails.map((address) => ({ label: 'work', address })),
      urlAddresses: f.website.trim() ? [{ label: 'work', url: f.website.trim() }] : undefined,
      addresses: f.address.trim() ? [{ label: 'work', street: f.address.trim(), city: f.city.trim() || undefined }] : undefined,
    };
    try {
      // The phone's own "New contact" form, pre-filled — the owner taps Save there.
      const created = await Contact.presentCreateForm(record);
      if (created) setSentVia((v) => [...v, 'contacts']);
    } catch {
      setError('Could not open your phone contacts.');
    }
  }

  const unsure = (k: string) => !!scanned?.fields.uncertain.includes(k);
  const canSave = hasContact && phoneValid && valuationValid && !save.isPending;

  return (
    <Screen>
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <Text className="font-display-bold text-lg text-white">Scan visiting card</Text>
        {savedCount > 0 && <Text className="ml-auto font-sans text-xs text-zinc-500">{savedCount} saved</Text>}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="gap-4 px-4 pb-16 pt-4" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {saved ? (
            /* ── Saved: intro message + contacts ─────────────────────── */
            <>
              <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
                <Ionicons name="checkmark-circle" size={44} color={t.brandBright} />
                <Text className="font-display-bold text-lg text-white">
                  {saved.result.existing ? 'Added to existing lead' : 'Lead saved'}
                </Text>
                <Text className="text-center font-sans text-sm text-zinc-400">
                  {saved.result.lead.name}
                  {saved.form.company ? ` · ${saved.form.company}` : ''}
                </Text>
              </View>

              {(!!saved.form.phone || !!saved.form.email) && (
                <View style={{ gap: 10, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text className="font-sans-semibold text-sm text-zinc-300">Send a quick intro</Text>
                    <Pressable onPress={() => setEditingIntro((v) => !v)} hitSlop={6} style={{ marginLeft: 'auto' }}>
                      <Text className="font-sans-semibold text-xs text-indigo-300">{editingIntro ? 'Done' : 'Edit message'}</Text>
                    </Pressable>
                  </View>
                  {editingIntro ? (
                    <>
                      <Field
                        value={intro}
                        onChangeText={(v) => {
                          setIntro(v);
                          void AsyncStorage.setItem(INTRO_KEY, v).catch(() => {});
                        }}
                        multiline
                        className="min-h-24"
                        textAlignVertical="top"
                      />
                      <Text className="font-sans text-xs text-zinc-500">{'{name}'}, {'{at event}'} and {'{business}'} are filled in for you.</Text>
                    </>
                  ) : (
                    <Text className="font-sans text-sm text-zinc-400">{introText}</Text>
                  )}
                  <Text className="font-sans text-xs text-zinc-600">Opens your own app — you press send.</Text>
                  {!!saved.form.phone && (
                    <SecondaryButton
                      title={sentVia.includes('WhatsApp') ? 'WhatsApp opened ✓' : 'Send on WhatsApp'}
                      onPress={() => void sendIntro('WhatsApp')}
                    />
                  )}
                  {!!saved.form.email && (
                    <SecondaryButton title={sentVia.includes('email') ? 'Email opened ✓' : 'Send email'} onPress={() => void sendIntro('email')} />
                  )}
                </View>
              )}

              <SecondaryButton
                title={sentVia.includes('contacts') ? 'Saved to phone contacts ✓' : 'Save to phone contacts'}
                onPress={() => void addToContacts()}
              />
              <ErrorText>{error}</ErrorText>
              <PrimaryButton title="Scan next card" onPress={resetForNext} />
              <Pressable onPress={() => router.replace(`/leads/${saved.result.lead._id}`)} hitSlop={6}>
                <Text className="text-center font-sans-semibold text-sm text-indigo-300">Open lead</Text>
              </Pressable>
            </>
          ) : !scanned ? (
            /* ── Capture ─────────────────────────────────────────────── */
            <>
              <Text className="font-sans text-sm text-zinc-400">
                Hold the card flat in good light. We read the details for you; you check them before anything is saved.
              </Text>
              {offline && (
                <Text className="font-sans text-sm text-amber-400">
                  You're offline. Take the photo anyway — it's kept on this phone and read when you're back online.
                </Text>
              )}
              <PhotoSlot label="Front of card" photo={front} onTake={() => void take('front', 'camera')} onPick={() => void take('front', 'library')} />
              {front && (
                <PhotoSlot
                  label="Back of card (optional)"
                  photo={back}
                  onTake={() => void take('back', 'camera')}
                  onPick={() => void take('back', 'library')}
                  onRemove={() => setBack(null)}
                />
              )}
              {front && (
                <Labeled label="Where you met">
                  <Field value={form.metAt} onChangeText={set('metAt')} placeholder="e.g. Delhi Expo 2026 (remembered)" />
                </Labeled>
              )}
              {!!notice && <Text className="font-sans text-sm text-emerald-400">{notice}</Text>}
              <ErrorText>{error}</ErrorText>
              {scan.isPending ? (
                <View style={{ alignItems: 'center', gap: 8, paddingVertical: 12 }}>
                  <ActivityIndicator />
                  <Text className="font-sans text-sm text-zinc-400">Reading the card…</Text>
                </View>
              ) : offline ? (
                <PrimaryButton title="Keep for later" disabled={!front} onPress={() => void keepForLater()} />
              ) : (
                <PrimaryButton title="Read card" disabled={!front} onPress={() => front && scan.mutate({ front, back })} />
              )}
              <Pressable
                onPress={() =>
                  setScanned({
                    fields: { isBusinessCard: true, name: '', designation: '', company: '', phones: [], emails: [], website: '', address: '', city: '', uncertain: [] },
                    imageKeys: [],
                  })
                }
                hitSlop={6}
              >
                <Text className="text-center font-sans text-sm text-zinc-500">Type the details instead</Text>
              </Pressable>

              {queue.length > 0 && (
                <View style={{ gap: 10, marginTop: 8 }}>
                  <Text className="font-sans-bold text-xs uppercase tracking-wider text-zinc-500">
                    Waiting to be read ({queue.length})
                  </Text>
                  {queue.map((card) => (
                    <View
                      key={card.id}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 10 }}
                    >
                      <Image source={{ uri: card.front.uri }} style={{ width: 70, height: 40, borderRadius: 6 }} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text className="font-sans-semibold text-sm text-zinc-200" numberOfLines={1}>
                          {card.metAt || 'Visiting card'}
                        </Text>
                        <Text className="font-sans text-xs text-zinc-500">{new Date(card.createdAt).toLocaleString()}</Text>
                      </View>
                      <Pressable onPress={() => readQueued(card)} disabled={offline || scan.isPending} hitSlop={6} style={{ opacity: offline || scan.isPending ? 0.4 : 1 }}>
                        <Text className="font-sans-semibold text-sm text-indigo-300">Read now</Text>
                      </Pressable>
                      <Pressable onPress={() => discardQueued(card)} hitSlop={6}>
                        <Ionicons name="trash-outline" size={18} color={t.textFaint} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            /* ── Review form ─────────────────────────────────────────── */
            <>
              {front && (
                <Image source={{ uri: front.uri }} style={{ width: '100%', aspectRatio: 1.75, borderRadius: 14 }} contentFit="cover" />
              )}
              <Text className="font-sans text-sm text-zinc-400">Check the details and fix anything that's wrong.</Text>

              <Labeled label="Name" unsure={unsure('name')}>
                <Field value={form.name} onChangeText={set('name')} placeholder="Full name" autoCapitalize="words" />
              </Labeled>
              <Labeled label="Phone" unsure={unsure('phones')}>
                <Field value={form.phone} onChangeText={set('phone')} placeholder="+91 98765 43210" keyboardType="phone-pad" />
                {!phoneValid && <Text className="font-sans text-xs text-zinc-500">Enter a 10-digit number or use +country format.</Text>}
                {scanned.fields.phones.length > 1 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {scanned.fields.phones.map((p) => (
                      <Pressable key={p.number} onPress={() => set('phone')(p.number)} hitSlop={4}>
                        <Text className={`font-sans text-xs ${p.number === form.phone ? 'text-indigo-300' : 'text-zinc-500'}`}>
                          {p.label}: {p.number}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </Labeled>
              <Labeled label="Email" unsure={unsure('emails')}>
                <Field value={form.email} onChangeText={set('email')} placeholder="name@company.com" keyboardType="email-address" autoCapitalize="none" />
              </Labeled>
              <Labeled label="Company" unsure={unsure('company')}>
                <Field value={form.company} onChangeText={set('company')} placeholder="Company" />
              </Labeled>
              <Labeled label="Job title" unsure={unsure('designation')}>
                <Field value={form.designation} onChangeText={set('designation')} placeholder="e.g. Sales Manager" />
              </Labeled>
              <Labeled label="Website" unsure={unsure('website')}>
                <Field value={form.website} onChangeText={set('website')} placeholder="www.company.com" autoCapitalize="none" keyboardType="url" />
              </Labeled>
              <Labeled label="Address" unsure={unsure('address')}>
                <Field value={form.address} onChangeText={set('address')} placeholder="Address" multiline className="min-h-16" textAlignVertical="top" />
              </Labeled>
              <Labeled label="City" unsure={unsure('city')}>
                <Field value={form.city} onChangeText={set('city')} placeholder="City" />
              </Labeled>

              <Labeled label="Where you met">
                <Field value={form.metAt} onChangeText={set('metAt')} placeholder="e.g. Delhi Expo 2026 (remembered for next scan)" />
              </Labeled>
              <Labeled label="Notes">
                <Field value={form.notes} onChangeText={set('notes')} placeholder="What did you talk about? (optional)" multiline className="min-h-20" textAlignVertical="top" />
              </Labeled>
              <Labeled label="Valuation">
                <Field value={form.valuation} onChangeText={set('valuation')} placeholder="Estimated deal value in ₹ (optional)" keyboardType="numeric" />
                {!valuationValid && <Text className="font-sans text-xs text-zinc-500">Valuation must be a non-negative number.</Text>}
              </Labeled>

              {!hasContact && <Text className="font-sans text-sm text-zinc-500">Add at least a name, phone or email.</Text>}
              <ErrorText>{error}</ErrorText>

              <PrimaryButton title="Save lead" loading={save.isPending} disabled={!canSave} onPress={() => save.mutate()} />
              <Pressable
                onPress={() => {
                  setScanned(null);
                  setError(null);
                  setForm((f) => ({ ...EMPTY_FORM, metAt: f.metAt }));
                }}
                hitSlop={6}
              >
                <Text className="text-center font-sans text-sm text-zinc-500">Start over</Text>
              </Pressable>
              <Text className="text-center font-sans text-xs text-zinc-600">
                If this phone or email already exists, the details are added to the existing lead.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
