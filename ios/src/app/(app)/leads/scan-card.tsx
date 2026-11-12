import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNetInfo } from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { Contact } from 'expo-contacts';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  logLeadActivity,
  saveBusinessCardLead,
  scanBusinessCard,
  type BusinessCardLeadInput,
  type CardFields,
  type CardPhoto,
  type QuickAddResult,
} from '@/api/endpoints/leads';
import { useBusiness } from '@/business/BusinessContext';
import { EventPicker, loadLastEvent, rememberEvent } from '@/components/event-picker';
import { BackChevron, ErrorText, Field, PrimaryButton, Screen, SecondaryButton } from '@/components/ui';
import {
  enqueueCard,
  enqueueSave,
  getSyncState,
  isOfflineError,
  listQueue,
  recentSyncedResults,
  removeQueued,
  retryQueued,
  shrinkPhoto,
  subscribeQueue,
  syncCardQueue,
  type QueueItem,
  type QueuedCard,
  type SyncedResult,
} from '@/lib/cardQueue';
import { checkPhotoBlur } from '@/lib/blur';
import { whatsappNumber } from '@/lib/format';
import { parsePhoneCandidate } from '@/lib/phone';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Visiting-card capture, built for crowded conference halls:
 *
 *  - "Save card" (default, no confirmation): the photo is kept on the phone
 *    and sent in the background (lib/cardQueue.ts + CardSyncRunner). The
 *    server reads AND saves the lead in one call; unclear reads are flagged
 *    "Check details" on the lead, which the owner can edit later. Works with
 *    no network — cards are sent automatically when it comes back.
 *  - "Read & check now": read, check the form, save (online). On a slow
 *    network it offers to switch to background after 15 s, and does so by
 *    itself after 45 s. A Save that fails for lack of network is kept and
 *    sent later too.
 *
 * Photos are shrunk on the phone (≤1280px, ~200 KB) before anything is sent.
 * After a checked save, the owner can send an intro from THEIR OWN WhatsApp /
 * email app — nothing is ever sent automatically.
 */

const INTRO_KEY = 'cardScan.introTemplate';
const DEFAULT_INTRO =
  'Hi {name}, it was great meeting you{at event}! This is {business}. Saving your number here — do reach out whenever we can help.';
const SLOW_HINT_MS = 15_000;
const SLOW_SWITCH_MS = 45_000;

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

const EMPTY_FIELDS: CardFields = {
  isBusinessCard: true, name: '', designation: '', company: '', phones: [], emails: [], website: '', address: '', city: '', uncertain: [],
};

async function capture(source: 'camera' | 'library'): Promise<CardPhoto | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || result.assets.length === 0) return null;
  const a = result.assets[0];
  // ~2–4 MB camera file → ~200 KB: the difference between seconds and minutes on conference Wi-Fi.
  return shrinkPhoto({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? `card-${Date.now()}.jpg` }, a.width, a.height);
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


function QueueRow({
  item,
  status,
  actions,
}: {
  item: QueueItem;
  status: string;
  actions?: { label: string; onPress: () => void; tone?: 'danger' }[];
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 10 }}>
      {item.kind === 'scan' ? (
        <Image source={{ uri: item.front.uri }} style={{ width: 64, height: 38, borderRadius: 6 }} contentFit="cover" />
      ) : (
        <View style={{ width: 64, height: 38, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(t.brand, 0.12) }}>
          <Ionicons name="person-outline" size={18} color={t.brandBright} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text className="font-sans-semibold text-sm text-zinc-200" numberOfLines={1}>
          {item.kind === 'save' ? item.label : item.metAt || 'Visiting card'}
        </Text>
        <Text className="font-sans text-xs text-zinc-500" numberOfLines={2}>{status}</Text>
      </View>
      {actions?.map((a) => (
        <Pressable key={a.label} onPress={a.onPress} hitSlop={6}>
          <Text className={`font-sans-semibold text-sm ${a.tone === 'danger' ? 'text-zinc-500' : 'text-indigo-300'}`}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text className="mt-2 font-sans-bold text-xs uppercase tracking-wider text-zinc-500">{children}</Text>;
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
  const [capturedCount, setCapturedCount] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [sync, setSync] = useState(getSyncState());
  const [results, setResults] = useState<SyncedResult[]>(recentSyncedResults());
  const [typingFor, setTypingFor] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [slow, setSlow] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [editingIntro, setEditingIntro] = useState(false);
  const [sentVia, setSentVia] = useState<string[]>([]);
  // Instant on-phone blur check per photo (warning only — "Use anyway" always works).
  const [blur, setBlur] = useState<{ front: boolean; back: boolean }>({ front: false, back: false });
  // Cards captured on this screen — if one comes back unreadable while the
  // person may still be at the stall, say so straight away.
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  // Live view of the background queue.
  const refresh = useCallback(() => {
    void listQueue().then(setQueue);
    setSync(getSyncState());
    setResults([...recentSyncedResults()]);
  }, []);
  useEffect(() => {
    refresh();
    return subscribeQueue(() => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
    });
  }, [refresh, queryClient, activeBusinessId]);

  useEffect(() => {
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => v && setIntro(v))
      .catch(() => {});
  }, []);

  // Last "Where you met" in THIS workspace is pre-selected (event-picker.tsx).
  useEffect(() => {
    void loadLastEvent(activeBusinessId).then((v) => setForm((f) => ({ ...f, metAt: v })));
  }, [activeBusinessId]);

  // Leaving the screen mid-read cancels the upload.
  useEffect(() => () => abortRef.current?.abort(), []);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function resetForNext() {
    setFront(null);
    setBack(null);
    setScanned(null);
    setTypingFor(null);
    setSaved(null);
    setSentVia([]);
    setError(null);
    setBlur({ front: false, back: false });
    setForm((f) => ({ ...EMPTY_FORM, metAt: f.metAt }));
  }

  async function take(slot: 'front' | 'back', source: 'camera' | 'library') {
    try {
      const p = await capture(source);
      if (!p) return;
      (slot === 'front' ? setFront : setBack)(p);
      setError(null);
      setNotice(null);
      setBlur((b) => ({ ...b, [slot]: false }));
      void checkPhotoBlur(p.uri).then((r) => {
        if (r?.blurry) setBlur((b) => ({ ...b, [slot]: true }));
      });
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

  /** Default: keep the card and let the background sync read + save it. */
  async function saveCard(photos: { front: CardPhoto; back: CardPhoto | null } | null = front ? { front, back } : null, why?: string) {
    if (!photos) return;
    try {
      const card = await enqueueCard({ businessId: activeBusinessId, front: photos.front, back: photos.back, metAt: form.metAt });
      setSessionIds((ids) => [...ids, card.id]);
      await rememberEvent(activeBusinessId, form.metAt);
      setCapturedCount((c) => c + 1);
      resetForNext();
      setNotice(
        why ??
          (offline
            ? "Card saved on this phone. It will be added to your CRM automatically when you're back online."
            : 'Card saved. It is being added to your CRM in the background — take the next one.'),
      );
      void syncCardQueue();
    } catch (e: any) {
      setError(e?.message || 'Could not keep the photo on this phone.');
    }
  }

  /** Optional: read now and check the form before saving (online). */
  async function readNow() {
    if (!front) return;
    const photos = { front, back };
    const ac = new AbortController();
    abortRef.current = ac;
    setReading(true);
    setSlow(false);
    setError(null);
    setNotice(null);
    const hint = setTimeout(() => setSlow(true), SLOW_HINT_MS);
    const giveUp = setTimeout(() => ac.abort(), SLOW_SWITCH_MS);
    try {
      const { fields, imageKeys } = await scanBusinessCard(photos.front, photos.back, { signal: ac.signal });
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
    } catch (err) {
      if (isOfflineError(err)) {
        // No / too slow network (or the owner tapped "save in background").
        await saveCard(photos, 'The network is slow, so the card was saved on this phone. It will be added to your CRM automatically.');
      } else {
        setError(getApiErrorMessage(err, 'Could not read the card. Try again, or tap Save card to do it in the background.'));
      }
    } finally {
      clearTimeout(hint);
      clearTimeout(giveUp);
      abortRef.current = null;
      setReading(false);
      setSlow(false);
    }
  }

  const trimmedValuation = form.valuation.trim();
  const valuationValid = !trimmedValuation || (Number.isFinite(Number(trimmedValuation)) && Number(trimmedValuation) >= 0);
  const phoneValid = !form.phone.trim() || parsePhoneCandidate(form.phone) !== null;
  const hasContact = !!(form.name.trim() || form.phone.trim() || form.email.trim());

  async function saveChecked() {
    const primaryPhone = form.phone.trim();
    const primaryEmail = form.email.trim().toLowerCase();
    const otherPhones = scanned?.fields.phones.map((p) => p.number).filter((n) => n !== primaryPhone) ?? [];
    const otherEmails = scanned?.fields.emails.filter((e) => e !== primaryEmail) ?? [];
    const payload: BusinessCardLeadInput = {
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
    };
    setSaving(true);
    setError(null);
    try {
      const result = await saveBusinessCardLead(payload);
      await rememberEvent(activeBusinessId, form.metAt);
      void queryClient.invalidateQueries({ queryKey: ['crm-leads', activeBusinessId] });
      void queryClient.invalidateQueries({ queryKey: ['card-events', activeBusinessId] });
      if (typingFor) void removeQueued(typingFor);
      setCapturedCount((c) => c + 1);
      setSaved({ result, form, phones: [primaryPhone, ...otherPhones].filter(Boolean), emails: [primaryEmail, ...otherEmails].filter(Boolean) });
    } catch (err) {
      if (isOfflineError(err)) {
        await enqueueSave({ businessId: activeBusinessId, payload, label: payload.name || payload.company || payload.phone || 'Visiting card' });
        await rememberEvent(activeBusinessId, form.metAt);
        if (typingFor) void removeQueued(typingFor);
        setCapturedCount((c) => c + 1);
        resetForNext();
        setNotice("No network — the lead is saved on this phone and will be added to your CRM automatically.");
      } else {
        setError(getApiErrorMessage(err, 'Failed to save the lead.'));
      }
    } finally {
      setSaving(false);
    }
  }

  function typeQueued(item: QueuedCard) {
    setFront(item.front);
    setBack(item.back);
    setTypingFor(item.id);
    setForm((f) => ({ ...EMPTY_FORM, metAt: item.metAt || f.metAt }));
    setScanned({ fields: EMPTY_FIELDS, imageKeys: [] });
  }

  function discardQueued(item: QueueItem) {
    Alert.alert('Remove this card?', 'It will be deleted from this phone and not added to your CRM.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeQueued(item.id) },
    ]);
  }

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
  const canSave = hasContact && phoneValid && valuationValid && !saving;

  const waiting = queue.filter((i) => i.status === 'waiting');
  const unreadable = queue.filter((i) => i.status === 'unreadable' || i.status === 'failed');
  const justFailed = unreadable.find((i) => sessionIds.includes(i.id) && !dismissedAlerts.includes(i.id) && i.kind === 'scan') as
    | QueuedCard
    | undefined;

  async function retakeFailed(item: QueuedCard) {
    await removeQueued(item.id);
    setDismissedAlerts((d) => [...d, item.id]);
    resetForNext();
    void take('front', 'camera');
  }

  const waitingStatus = sync.running && !offline ? 'Sending…' : offline || sync.offline ? 'Waiting for network' : 'Waiting to send';

  return (
    <Screen>
      <View className="flex-row items-center gap-3 border-b border-surface-border px-4 pb-3 pt-2">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <BackChevron />
        </Pressable>
        <Text className="font-display-bold text-lg text-white">Scan visiting card</Text>
        {capturedCount > 0 && <Text className="ml-auto font-sans text-xs text-zinc-500">{capturedCount} this session</Text>}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="gap-4 px-4 pb-16 pt-4" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {saved ? (
            /* ── Checked lead saved: intro message + contacts ────────── */
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
                    <SecondaryButton title={sentVia.includes('WhatsApp') ? 'WhatsApp opened ✓' : 'Send on WhatsApp'} onPress={() => void sendIntro('WhatsApp')} />
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
              <Labeled label="Where you met">
                <EventPicker businessId={activeBusinessId} value={form.metAt} onChange={set('metAt')} />
              </Labeled>
              {offline && (
                <Text className="font-sans text-sm text-amber-400">
                  You're offline — keep scanning. Cards are saved on this phone and added to your CRM automatically when the network is back.
                </Text>
              )}
              {justFailed && (
                <View style={{ gap: 10, borderRadius: 16, borderWidth: 1, borderColor: '#f59e0b80', backgroundColor: '#f59e0b14', padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Image source={{ uri: justFailed.front.uri }} style={{ width: 64, height: 38, borderRadius: 6 }} contentFit="cover" />
                    <Text className="flex-1 font-sans text-sm text-zinc-200">
                      The card you just saved couldn't be read{justFailed.lastError ? ` — ${justFailed.lastError}` : '.'} Retake it while you're still there?
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
                    <Pressable onPress={() => setDismissedAlerts((d) => [...d, justFailed.id])} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-zinc-500">Later</Text>
                    </Pressable>
                    <Pressable onPress={() => typeQueued(justFailed)} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-indigo-300">Type it</Text>
                    </Pressable>
                    <Pressable onPress={() => void retakeFailed(justFailed)} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-emerald-400">Retake</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              <PhotoSlot label="Front of card" photo={front} onTake={() => void take('front', 'camera')} onPick={() => void take('front', 'library')} />
              {!front && (
                <Text className="font-sans text-xs text-zinc-500">
                  Tips: lay the card flat · good light, no glare · card fills most of the photo · hold still for a second.
                </Text>
              )}
              {front && blur.front && (
                <View style={{ gap: 8, borderRadius: 14, borderWidth: 1, borderColor: '#f59e0b80', backgroundColor: '#f59e0b14', padding: 12 }}>
                  <Text className="font-sans text-sm text-zinc-200">
                    This photo looks blurry — the details may not be readable. Hold the phone still and tap the card on screen to focus.
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
                    <Pressable onPress={() => setBlur((b) => ({ ...b, front: false }))} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-zinc-400">Use anyway</Text>
                    </Pressable>
                    <Pressable onPress={() => void take('front', 'camera')} hitSlop={6}>
                      <Text className="font-sans-semibold text-sm text-emerald-400">Retake</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              {front && (
                <PhotoSlot
                  label="Back of card (optional)"
                  photo={back}
                  onTake={() => void take('back', 'camera')}
                  onPick={() => void take('back', 'library')}
                  onRemove={() => setBack(null)}
                />
              )}
              {back && blur.back && (
                <Text className="font-sans text-sm text-amber-400">
                  The back photo looks blurry.{' '}
                  <Text className="font-sans-semibold text-emerald-400" onPress={() => void take('back', 'camera')}>Retake</Text>
                  {'  ·  '}
                  <Text className="font-sans-semibold text-zinc-400" onPress={() => setBlur((b) => ({ ...b, back: false }))}>Use anyway</Text>
                </Text>
              )}
              {!!notice && <Text className="font-sans text-sm text-emerald-400">{notice}</Text>}
              <ErrorText>{error}</ErrorText>

              {reading ? (
                <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
                  <ActivityIndicator />
                  <Text className="font-sans text-sm text-zinc-400">Reading the card…</Text>
                  {slow && (
                    <>
                      <Text className="text-center font-sans text-sm text-amber-400">The network is slow.</Text>
                      <SecondaryButton title="Save in background instead" onPress={() => abortRef.current?.abort()} />
                    </>
                  )}
                </View>
              ) : (
                <>
                  <PrimaryButton
                    title={!front ? 'Take a photo first' : blur.front ? 'Save anyway' : 'Save card'}
                    disabled={!front}
                    onPress={() => void saveCard()}
                  />
                  <Text className="text-center font-sans text-xs text-zinc-500">
                    Saved straight to your CRM — no checking needed. Unclear ones are marked “Check details”.
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20 }}>
                    <Pressable onPress={() => void readNow()} disabled={!front || offline} hitSlop={6} style={{ opacity: !front || offline ? 0.4 : 1 }}>
                      <Text className="font-sans-semibold text-sm text-indigo-300">Read & check now</Text>
                    </Pressable>
                    <Pressable onPress={() => setScanned({ fields: EMPTY_FIELDS, imageKeys: [] })} hitSlop={6}>
                      <Text className="font-sans text-sm text-zinc-500">Type it instead</Text>
                    </Pressable>
                  </View>
                </>
              )}

              {!!sync.message && <Text className="font-sans text-sm text-amber-400">{sync.message}</Text>}

              {waiting.length > 0 && (
                <View style={{ gap: 8 }}>
                  <SectionTitle>{`Adding to CRM (${waiting.length})`}</SectionTitle>
                  {waiting.map((item) => (
                    <QueueRow
                      key={item.id}
                      item={item}
                      status={item.attempts > 0 && item.lastError ? `${waitingStatus} · last try: ${item.lastError}` : waitingStatus}
                    />
                  ))}
                </View>
              )}

              {unreadable.length > 0 && (
                <View style={{ gap: 8 }}>
                  <SectionTitle>{`Couldn't add (${unreadable.length})`}</SectionTitle>
                  {unreadable.map((item) => (
                    <QueueRow
                      key={item.id}
                      item={item}
                      status={item.lastError || "We couldn't read this card."}
                      actions={[
                        { label: 'Retry', onPress: () => void retryQueued(item.id) },
                        ...(item.kind === 'scan' ? [{ label: 'Type', onPress: () => typeQueued(item) }] : []),
                        { label: 'Delete', onPress: () => discardQueued(item), tone: 'danger' as const },
                      ]}
                    />
                  ))}
                </View>
              )}

              {results.length > 0 && (
                <View style={{ gap: 8 }}>
                  <SectionTitle>Added just now</SectionTitle>
                  {results.slice(0, 10).map((r) => (
                    <Pressable
                      key={`${r.leadId}-${r.at}`}
                      onPress={() => router.push(`/leads/${r.leadId}`)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, paddingHorizontal: 12, minHeight: 48 }}
                    >
                      <Ionicons name={r.needsReview ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={r.needsReview ? '#fbbf24' : t.brandBright} />
                      <Text className="flex-1 font-sans-semibold text-sm text-zinc-200" numberOfLines={1}>{r.name}</Text>
                      <Text className={`font-sans text-xs ${r.needsReview ? 'text-amber-400' : 'text-zinc-500'}`}>
                        {r.needsReview ? 'Check details' : r.existing ? 'Already in CRM' : 'Added'}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={t.textFaint} />
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          ) : (
            /* ── Check form ("Read & check now" / "Type it") ─────────── */
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
                <EventPicker businessId={activeBusinessId} value={form.metAt} onChange={set('metAt')} />
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

              <PrimaryButton title="Save lead" loading={saving} disabled={!canSave} onPress={() => void saveChecked()} />
              <Pressable
                onPress={() => {
                  setScanned(null);
                  setTypingFor(null);
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
