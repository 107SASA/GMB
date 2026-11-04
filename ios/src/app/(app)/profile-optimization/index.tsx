import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import {
  changeAction,
  fetchProfileOptimization,
  proposeAttributes,
  proposeChange,
  resolveServiceAreas,
  type ActionResult,
  type CategoryRec,
  type ChangeRow,
  type HoursPeriod,
} from '@/api/endpoints/profileOptimization';
import { useBusiness } from '@/business/BusinessContext';
import { dateToTime, dateToYmd, timeLabel, timeToDate, useTimeDatePicker, ymdLabel } from '@/components/time-date-picker';
import {
  BackChevron,
  Badge,
  Card,
  EmptyState,
  Field,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionLabel,
  Skeleton,
  useConfirmSheet,
  useInfoSheet,
} from '@/components/ui';
import { openGoogleConnect } from '@/lib/connectGoogle';
import {
  actionResultText,
  businessTypeText,
  changedLines,
  dayLabel,
  formatValue,
  groupDuplicates,
  kindLabel,
  pinText,
  shortReference,
  sourceLabel,
  statusInfo,
  usesWordDiff,
} from '@/lib/profile-optimization/presentation';
import { ROLLBACK_CONFIRM, validationReview, wordDiff } from '@/lib/profile-optimization/textDiff';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Profile optimization — the app's counterpart of the web page
 * (src/app/dashboard/profile-optimization/page.tsx): same sections, same
 * proposals, same copy. Nothing changes on Google until "Apply to Google".
 * Results open in a sheet (the screen is long, so a banner at the top would
 * be off-screen); times and dates use the native pickers.
 */

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Tablet: keep line lengths readable instead of stretching edge to edge. */
const MAX_WIDTH = 640;

/** Narrow phone (iPhone SE / small Android) or large accessibility text — rows stack instead of squeezing. */
function useCompact(): boolean {
  const { width, fontScale } = useWindowDimensions();
  return width < 360 || fontScale > 1.3;
}

interface DayHours { open: string; close: string; closed: boolean; split?: boolean }

/** Same as the web weekFromGoogle: a day with no period is closed; null → every day blank and open. */
function weekFromGoogle(periods: HoursPeriod[] | null | undefined): Record<string, DayHours> {
  const week: Record<string, DayHours> = {};
  for (const day of DAYS) {
    if (!Array.isArray(periods)) { week[day] = { open: '', close: '', closed: false }; continue; }
    const own = periods.filter((p) => p.openDay === day);
    week[day] = own.length
      ? { open: own[0].openTime, close: own[0].closeTime, closed: false, split: own.length > 1 || own[0].closeDay !== day }
      : { open: '', close: '', closed: true };
  }
  return week;
}

/** A link without utm_* tags (the server adds its own on save). */
function withoutUtm(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function sameDay(a: DayHours | undefined, b: DayHours | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.closed === b.closed && (a.closed || (a.open === b.open && a.close === b.close));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Hint({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <Text className={`font-sans text-xs leading-[18px] ${error ? 'text-accent-rose' : 'text-zinc-400'}`}>{children}</Text>;
}

/** One collapsible section with an icon; `count` highlights how many suggestions wait inside. */
function Panel({
  title,
  icon,
  hint,
  count = 0,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  hint?: string;
  count?: number;
  children: ReactNode;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View className="mb-2.5 overflow-hidden rounded-card border border-surface-border bg-surface-raised">
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // No `className` — react-native-css-interop can swallow onPress on
        // styled Pressables (see components/ui.tsx PrimaryButton).
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, minHeight: 60 }}
      >
        <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: withAlpha(t.brand, 0.15) }}>
          <Ionicons name={icon} size={18} color={t.brandBright} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-base text-white">{title}</Text>
          {!!hint && <Text className="font-sans text-xs text-zinc-400" numberOfLines={1}>{hint}</Text>}
        </View>
        {count > 0 && (
          <View className="min-w-[24px] items-center rounded-full px-2 py-0.5" style={{ backgroundColor: t.brand }}>
            <Text className="font-sans-bold text-xs text-on-brand">{count}</Text>
          </View>
        )}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.textFaint} />
      </Pressable>
      {open && <View className="gap-3.5 border-t border-surface-border px-4 py-4">{children}</View>}
    </View>
  );
}

/** Tappable box with a leading tick — for lists of things to pick. */
function CheckRow({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: checked ? t.brand : t.border,
        backgroundColor: checked ? withAlpha(t.brand, 0.1) : 'transparent',
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? t.brand : t.textFaint} />
      <Text className="flex-1 font-sans text-sm text-white">{label}</Text>
    </Pressable>
  );
}

/** Pill that opens a native picker. */
function PickerPill({ label, placeholder, onPress, accessibilityLabel }: { label: string; placeholder: string; onPress: () => void; accessibilityLabel: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: label ? t.border : withAlpha(t.amber, 0.6),
        backgroundColor: t.bg,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      <Ionicons name="time-outline" size={15} color={t.textFaint} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        className="font-sans-semibold text-sm"
        style={{ flexShrink: 1, color: label ? t.text : t.amber }}
      >
        {label || placeholder}
      </Text>
    </Pressable>
  );
}

/** Two-choice pill group (Yes / No). Tapping the selected one clears it. */
function YesNo({ value, onChange, label }: { value: boolean | undefined; onChange: (v: boolean | undefined) => void; label: string }) {
  const t = useTheme();
  return (
    <View className="flex-row gap-1.5" accessibilityLabel={label}>
      {([true, false] as const).map((v) => {
        const selected = value === v;
        return (
          <Pressable
            key={String(v)}
            onPress={() => onChange(selected ? undefined : v)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={{
              flexGrow: 1,
              minWidth: 56,
              minHeight: 40,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              borderWidth: 1,
              borderColor: selected ? t.brand : t.border,
              backgroundColor: selected ? t.brand : 'transparent',
              paddingHorizontal: 12,
            }}
          >
            <Text className={`font-sans-semibold text-sm ${selected ? 'text-on-brand' : 'text-zinc-400'}`}>{v ? 'Yes' : 'No'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ProfileOptimizationScreen() {
  const t = useTheme();
  const router = useRouter();
  const compact = useCompact();
  const { activeBusinessId } = useBusiness();
  const query = useQuery({
    queryKey: ['profile-optimization', activeBusinessId],
    queryFn: fetchProfileOptimization,
    enabled: !!activeBusinessId,
  });
  const confirmSheet = useConfirmSheet();
  const info = useInfoSheet();
  const picker = useTimeDatePicker();

  // Which button is working — it shows the spinner; every other one is disabled.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = busyKey !== null;
  const [hours, setHours] = useState<Record<string, DayHours>>({});
  // What Google has now, per day — only days that differ from it are proposed.
  const [googleHours, setGoogleHours] = useState<Record<string, DayHours>>({});
  const [specialDate, setSpecialDate] = useState('');
  const [specialClosed, setSpecialClosed] = useState(true);
  const [specialOpen, setSpecialOpen] = useState('09:00');
  const [specialClose, setSpecialClose] = useState('17:00');
  const [areaQuery, setAreaQuery] = useState('');
  const [areaHits, setAreaHits] = useState<Array<{ placeId: string; placeName: string; address: string | null }>>([]);
  const [pickedAreas, setPickedAreas] = useState<Array<{ placeId: string; placeName: string }>>([]);
  const [removedAreas, setRemovedAreas] = useState<string[]>([]);
  const [pickedHolidays, setPickedHolidays] = useState<string[]>([]);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [bulkBool, setBulkBool] = useState<Record<string, boolean | undefined>>({});

  const recs = query.data?.recs ?? null;
  const changes = query.data?.changes ?? [];
  const googleReviewPending = query.data?.googleReviewPending ?? null;

  // Re-seed the forms from Google after every load, as the web page does.
  useEffect(() => {
    if (!recs || recs.connected === false) return;
    const links: Record<string, string> = {};
    for (const key of ['appointment', 'menu', 'order']) {
      const attr = recs.links?.attributes?.[key];
      const uri = recs.links?.current?.[key];
      if (attr?.name && uri) links[attr.name] = withoutUtm(String(uri));
    }
    setAttrValues((prev) => ({ ...links, ...prev }));
    setPickedHolidays([]);
    setRemovedAreas([]);
    const week = weekFromGoogle(recs.hours?.currentRegularHours);
    setGoogleHours(week);
    setHours(week);
  }, [recs]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/more'));

  /** Result sheet + haptic. `ok` false = nothing was saved/sent. */
  const notify = (title: string, text: string, ok: boolean) => {
    void Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
    info.show(title, text);
  };

  /** One request at a time: buttons stay disabled until the list reloads. */
  const run = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusyKey(key);
    try {
      await task();
    } catch (err) {
      notify('Something went wrong', getApiErrorMessage(err, 'Nothing was changed on Google. Please try again.'), false);
    } finally {
      setBusyKey(null);
    }
  };

  const reload = async () => { await query.refetch(); };

  const attributeNames: Record<string, string> = Object.fromEntries(
    (recs?.attributes?.suggestions || []).map((a) => [a.name, a.displayName || a.name]),
  );

  const showProposeResult = (json: ActionResult) => {
    if (json.error) notify('Not saved', json.error, false);
    else if (json.reused && json.change?.status !== 'BLOCKED') notify('Already waiting', 'This exact change is already in “Ready to apply”, so no duplicate was added. Nothing was sent to Google.', true);
    else if (json.change?.status === 'PROPOSED') notify('Saved — ready to apply', 'Find it under “Ready to apply” at the top. Check what changes, then tap “Apply to Google”. Nothing was sent yet.', true);
    else notify('Didn’t pass our checks', `This change was saved as “Not applied”.${json.change?.error ? ` ${json.change.error}` : ''}`, false);
  };

  const propose = (key: string, body: object) => run(key, async () => {
    showProposeResult(await proposeChange(body));
    await reload();
  });

  const proposeSelectedAttributes = () => run('attributes', async () => {
    const suggestions = recs?.attributes?.suggestions || [];
    const items = suggestions.flatMap((attribute): Array<{ name: string; value: unknown }> => {
      if (attribute.valueType === 'BOOL') {
        return typeof bulkBool[attribute.name] === 'boolean' ? [{ name: attribute.name, value: bulkBool[attribute.name] }] : [];
      }
      const value = (attrValues[attribute.name] || '').trim();
      return value ? [{ name: attribute.name, value }] : [];
    });
    if (!items.length) {
      notify('Nothing to save', 'Choose Yes or No (or enter a value) for at least one attribute first.', false);
      return;
    }
    const json = await proposeAttributes(items);
    const results = Array.isArray(json.results) ? json.results : [];
    const stored = results.filter((row) => row.stored);
    const failed = results.filter((row) => !row.stored);
    const reusedCount = stored.filter((row) => row.reused).length;
    const reusedText = reusedCount ? ` ${reusedCount} of them ${reusedCount === 1 ? 'was' : 'were'} already waiting, so no duplicate was added.` : '';
    const failureText = failed
      .map((row) => `${attributeNames[row.name || ''] || 'attribute'}: ${row.error || row.violations?.[0]?.message || 'not accepted'}`)
      .join('; ');
    if (json.error && !results.length) notify('Not saved', json.error, false);
    else if (failed.length) notify('Partly saved', `${stored.length} of ${results.length} answers were saved.${reusedText} Not saved — ${failureText}. Nothing was sent to Google.`, stored.length > 0);
    else notify('Saved — ready to apply', `${plural(stored.length, 'answer')} ${stored.length === 1 ? 'is' : 'are'} under “Ready to apply” at the top.${reusedText} Nothing was sent to Google yet.`, true);
    setBulkBool({});
    await reload();
  });

  const act = (change: ChangeRow, action: 'execute' | 'rollback' | 'discard') => run(`${change._id}:${action}`, async () => {
    const res = await changeAction(change._id, action);
    const title = !res.success ? 'Not done' : action === 'discard' ? 'Discarded' : action === 'rollback' ? 'Rolled back' : 'Checked';
    notify(title, actionResultText(action, res), !!res.success);
    await reload();
  });

  /** One step for the owner: approve (if still waiting) and send to Google. */
  const applyNow = (change: ChangeRow) => run(`${change._id}:apply`, async () => {
    if (change.status === 'PROPOSED') {
      const approved = await changeAction(change._id, 'approve', { confirmSensitive: true });
      if (!approved.success) {
        notify('Not applied', actionResultText('approve', approved), false);
        await reload();
        return;
      }
    }
    const res = await changeAction(change._id, 'execute');
    notify(res.success ? 'Sent to Google' : 'Not applied', actionResultText('execute', res), !!res.success);
    await reload();
  });

  const pickTime = (current: string, fallback: string, title: string, onPick: (hhmm: string) => void) =>
    picker.open('time', timeToDate(current, fallback), (d) => onPick(dateToTime(d)), title);

  const proposeHours = () => {
    const changed = DAYS.filter((d) => !sameDay(hours[d], googleHours[d]));
    const missing = changed.filter((d) => !hours[d]?.closed && !(TIME.test(hours[d]?.open) && TIME.test(hours[d]?.close)));
    if (missing.length) {
      notify('Times missing', `Pick both an opening and a closing time for ${missing.map(dayLabel).join(', ')}, or switch the day to Closed.`, false);
      return;
    }
    const backwards = changed.filter((d) => !hours[d]?.closed && hours[d].open >= hours[d].close);
    if (backwards.length) {
      notify('Check the times', `${backwards.map(dayLabel).join(', ')}: the closing time must be after the opening time.`, false);
      return;
    }
    if (specialDate && !specialClosed && specialOpen >= specialClose) {
      notify('Check the times', 'On the special date, the closing time must be after the opening time.', false);
      return;
    }
    if (!changed.length && !specialDate) {
      notify('Nothing changed yet', 'Change a day or add a special date first.', false);
      return;
    }
    const open = changed.filter((d) => !hours[d].closed);
    propose('hours', {
      kind: 'hours',
      source: 'owner',
      proposed: {
        regularHours: { periods: open.map((d) => ({ openDay: d, closeDay: d, openTime: hours[d].open, closeTime: hours[d].close })) },
        closedDays: changed.filter((d) => hours[d].closed),
        specialHours: specialDate
          ? { specialHourPeriods: [{ startDate: specialDate, closed: specialClosed, openTime: specialClosed ? null : specialOpen, closeTime: specialClosed ? null : specialClose }] }
          : { specialHourPeriods: [] },
      },
    });
  };

  const resolveAreas = () => run('find-areas', async () => {
    const queries = areaQuery.split(/[\n,]/).map((q) => q.trim()).filter((q) => q.length >= 2);
    const json = await resolveServiceAreas(queries);
    const places = (json.results || []).flatMap((r) => r.places || []);
    setAreaHits(places);
    if (json.error) notify('Couldn’t search', json.error, false);
    else if (!places.length) notify('No places found', 'Try a city name or a PIN code.', false);
  });

  const renderCard = ({ change, duplicates }: { change: ChangeRow; duplicates: ChangeRow[] }) => {
    const review = validationReview(change.validation);
    const recent = change.verifiedAt ? Date.now() - new Date(change.verifiedAt).getTime() < 14 * 86_400_000 : false;
    const inReview = change.status === 'VERIFIED' && recent && googleReviewPending === true;
    const status = inReview
      ? { ...statusInfo(change.status), label: 'Google is reviewing', explain: 'Accepted — Google is reviewing it. It can take a few hours to show.' }
      : statusInfo(change.status);
    const before = formatValue(change.kind, change.before, attributeNames);
    const after = formatValue(change.kind, change.proposed, attributeNames);
    const prose = usesWordDiff(change.kind);
    const diff = prose ? wordDiff(before, after) : [];
    const rows = prose ? [] : changedLines(before, after);
    const changed = prose ? diff.some((part) => part.type !== 'equal') : rows.length > 0;
    const pending = change.status === 'PROPOSED' || change.status === 'APPROVED';
    const canApply = pending && changed && (!change.validation || review.passed);
    const tone = status.group === 'live' ? 'positive' : status.group === 'closed' ? 'neutral' : 'warning';
    const working = (action: string) => busyKey === `${change._id}:${action}`;
    return (
      <Card key={change._id} className="mb-3 gap-3">
        {/* Status on its own line: labels like "Not applied — profile changed"
            would otherwise squeeze the title on a narrow phone. */}
        <View className="gap-1.5">
          <Text className="font-sans-bold text-base text-white">{kindLabel(change.kind)}</Text>
          <Badge label={status.label} tone={tone} />
          <Hint>
            {sourceLabel(change.source)}
            {change.createdAt ? ` · ${new Date(change.createdAt).toLocaleDateString()}` : ''}
            {' · '}Ref {shortReference(change._id)}
          </Hint>
        </View>
        {duplicates.length > 0 && <Hint>Proposed {duplicates.length + 1} times — only the newest is shown.</Hint>}

        <View className="gap-1.5 rounded-xl px-3 py-2.5" style={{ backgroundColor: t.bg }}>
          {!changed ? (
            <Hint>No change — this is already on your Google profile.</Hint>
          ) : prose ? (
            <>
              <Hint>New text — <Text style={{ color: t.emerald }}>green is added</Text>, <Text style={{ color: t.rose }}>red is removed</Text></Hint>
              <Text className="font-sans text-sm leading-5 text-white">
                {diff.map((part, index) => part.type === 'equal'
                  ? <Text key={index}>{part.value}</Text>
                  : part.type === 'insert'
                    ? <Text key={index} style={{ color: t.emerald, fontWeight: '700' }}>{part.value}</Text>
                    : <Text key={index} style={{ color: t.rose, textDecorationLine: 'line-through' }}>{part.value}</Text>)}
              </Text>
            </>
          ) : (
            <>
              <Hint>What changes</Hint>
              {rows.map((row, index) => (
                <View key={index} className="gap-0.5">
                  {!!row.label && <Text className="font-sans-semibold text-sm text-white">{row.label}</Text>}
                  {/* One nested Text so long values (links, lists) wrap inside the card instead of overflowing a row. */}
                  <Text className="font-sans text-sm leading-5">
                    <Text style={{ color: t.textDim, textDecorationLine: 'line-through' }}>{row.from ?? 'Not set'}</Text>
                    <Text style={{ color: t.textFaint }}>{'  →  '}</Text>
                    <Text className="font-sans-bold" style={{ color: t.brandBright }}>{row.to ?? 'Removed'}</Text>
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>

        {review.violations.map((text, index) => <Hint key={`violation-${index}`} error>{text}</Hint>)}
        {review.warnings.map((text, index) => <Hint key={`warning-${index}`}>Note: {text}</Hint>)}
        {!pending && !!status.explain && <Hint>{status.explain}</Hint>}
        {!!change.error && !pending && change.error !== review.violations.join(' ') && <Hint error>{change.error}</Hint>}

        {pending && (
          <View className="gap-2">
            {canApply && (
              <PrimaryButton
                title="Apply to Google"
                loading={working('apply')}
                disabled={busy}
                onPress={() => confirmSheet.confirm({
                  title: 'Apply to Google?',
                  message: 'This sends the change to your Google profile. You can roll it back later.',
                  confirmLabel: 'Yes, apply',
                  onConfirm: () => applyNow(change),
                })}
              />
            )}
            <SecondaryButton
              title={working('discard') ? 'Discarding…' : 'Discard'}
              disabled={busy}
              onPress={() => confirmSheet.confirm({
                title: 'Discard this change?',
                message: 'Nothing is sent to Google.',
                confirmLabel: 'Yes, discard',
                destructive: true,
                onConfirm: () => act(change, 'discard'),
              })}
            />
          </View>
        )}

        {change.status === 'VERIFIED' && (
          <SecondaryButton
            title={working('rollback') ? 'Rolling back…' : 'Roll back'}
            disabled={busy}
            onPress={() => confirmSheet.confirm({
              title: 'Roll back?',
              message: ROLLBACK_CONFIRM,
              confirmLabel: 'Yes, roll back',
              destructive: true,
              onConfirm: () => act(change, 'rollback'),
            })}
          />
        )}

        {change.status === 'UNRESOLVED' && (
          <View className="gap-2">
            <Hint>Checking only reads your Google profile. Nothing is sent again.</Hint>
            <SecondaryButton title={working('execute') ? 'Checking…' : 'Check Google again'} disabled={busy} onPress={() => act(change, 'execute')} />
          </View>
        )}
      </Card>
    );
  };

  const header = (
    <View className="border-b border-surface-border">
      <View className="flex-row items-center gap-3 px-4 pb-3 pt-2" style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={{ minHeight: 40, justifyContent: 'center' }}>
          <BackChevron />
        </Pressable>
        <Text className="flex-1 font-display-bold text-lg text-white" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} accessibilityRole="header">
          Profile optimization
        </Text>
        {query.isFetching && !query.isLoading && <ActivityIndicator size="small" color={t.brandBright} />}
      </View>
    </View>
  );

  if (query.isLoading || !activeBusinessId) {
    return (
      <Screen>
        {header}
        <View className="gap-3 px-4 pt-4" style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}>
          <Skeleton className="h-20" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </View>
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen>
        {header}
        <EmptyState
          title="Couldn't load profile optimization"
          hint={getApiErrorMessage(query.error, 'Check your connection and try again.')}
          action={<View className="mt-2"><SecondaryButton title="Try again" onPress={() => void query.refetch()} /></View>}
        />
      </Screen>
    );
  }

  const description = recs?.description;
  const categories = recs?.categories;
  const suggestions = recs?.attributes?.suggestions || [];
  const selectedCount = suggestions.filter((a) => (a.valueType === 'BOOL' ? typeof bulkBool[a.name] === 'boolean' : !!(attrValues[a.name] || '').trim())).length;
  const reminders = Object.entries((recs?.hours?.reminders || []).reduce((groups: Record<string, string[]>, reminder) => {
    if (reminder.covered) return groups;
    groups[reminder.date] = [...(groups[reminder.date] || []), reminder.name];
    return groups;
  }, {}));
  const grouped = groupDuplicates(changes);
  const ready = grouped.filter((g) => ['waiting', 'approved'].includes(statusInfo(g.change.status).group));
  const history = grouped.filter((g) => !ready.includes(g));
  const addable: CategoryRec[] = (categories?.additional || []).filter((c) => c.executable && c.categoryName);
  const notAddable = (categories?.additional || []).length - addable.length;
  const linkKeys = (['appointment', 'menu', 'order'] as const).filter((key) => recs?.links?.attributes?.[key]?.name);
  const linksSet = linkKeys.filter((key) => recs?.links?.current?.[key]).length;
  const changedDays = DAYS.filter((d) => !sameDay(hours[d], googleHours[d])).length;
  // Google accepts service areas only on a service-area profile.
  const canSetArea = ['CUSTOMER_LOCATION_ONLY', 'CUSTOMER_AND_BUSINESS_LOCATION'].includes(recs?.serviceArea?.businessType || '');
  const currentAreas = (recs?.serviceArea?.places || [])
    .filter((p): p is { placeId: string; placeName?: string | null } => !!p?.placeId)
    .map((p) => ({ placeId: p.placeId, placeName: p.placeName || 'Area' }));
  const serviceItems = recs?.services?.items || [];
  const firstOpen = DAYS.find((d) => !hours[d]?.closed && TIME.test(hours[d]?.open) && TIME.test(hours[d]?.close));
  const setDay = (day: string, next: Partial<DayHours>) => {
    const row = hours[day] || { open: '', close: '', closed: false };
    setHours({ ...hours, [day]: { ...row, ...next, split: false } });
  };

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerClassName="px-4 pb-16 pt-4"
          contentContainerStyle={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={t.brandBright} colors={[t.brand]} />}
        >
          <View className="flex-row gap-3 rounded-card px-4 py-3.5" style={{ backgroundColor: withAlpha(t.brand, 0.12) }}>
            <Ionicons name="shield-checkmark" size={20} color={t.brandBright} />
            <View className="flex-1 gap-1">
              <Text className="font-sans-semibold text-sm text-white">Nothing changes on Google until you tap “Apply to Google”.</Text>
              <Hint>Open a section, pick what you want, then apply it from “Ready to apply”. Google can take a few hours to show changes.</Hint>
            </View>
          </View>

          {recs?.connected === false && (
            <Card className="mt-4 gap-3">
              <View className="flex-row items-center gap-2">
                <Ionicons name="link" size={18} color={t.amber} />
                <Text className="flex-1 font-sans-bold text-base text-white">Connect your Google profile</Text>
              </View>
              <Hint>Your Google profile isn’t connected or hasn’t synced yet. Connect it, then pull down to refresh in a few minutes.</Hint>
              <PrimaryButton
                title="Connect Google"
                onPress={() => openGoogleConnect().catch((err) => notify('Couldn’t open Google', getApiErrorMessage(err, 'Please try again.'), false))}
              />
            </Card>
          )}

          {ready.length > 0 && (
            <>
              <SectionLabel>{`Ready to apply · ${ready.length}`}</SectionLabel>
              {ready.map(renderCard)}
            </>
          )}

          {recs && recs.connected !== false && (
            <>
              <SectionLabel>Improve your profile</SectionLabel>

              {!!description?.text && (
                <Panel title="Business description" icon="document-text" hint="A new description written for you" count={1}>
                  <View className="rounded-xl px-3 py-2.5" style={{ backgroundColor: t.bg }}>
                    <Text className="font-sans text-sm leading-5 text-white">{description.text}</Text>
                  </View>
                  {description.validation?.valid ? (
                    <PrimaryButton
                      title="Use this description"
                      loading={busyKey === 'description'}
                      disabled={busy}
                      onPress={() => propose('description', { kind: 'description', proposed: description.text, source: 'recommendation', context: { tokens: description.tokens || [], competitorNames: description.competitorNames || [] } })}
                    />
                  ) : (
                    <Hint error>This draft didn’t pass our checks.</Hint>
                  )}
                </Panel>
              )}

              {Boolean(categories?.primary || categories?.additional?.length) && (
                <Panel title="Categories" icon="pricetags" hint={addable.length ? `${plural(addable.length, 'category', 'categories')} to add` : 'Nothing to add'} count={addable.length}>
                  {!!categories?.primary && (
                    <View className="gap-2">
                      <Hint>Main category</Hint>
                      <Text className="font-sans-bold text-base text-white">{categories.primary.displayName}</Text>
                      {categories.primary.risk === 'high' && <Hint>Changing the main category can change where you appear in search.</Hint>}
                      {categories.primary.executable && !!categories.primary.categoryName && (
                        <SecondaryButton
                          title={busyKey === 'primary' ? 'Saving…' : 'Use as main category'}
                          disabled={busy}
                          onPress={() => propose('primary', { kind: 'primary_category', proposed: { primaryCategory: { name: categories.primary!.categoryName } }, source: 'recommendation' })}
                        />
                      )}
                    </View>
                  )}
                  {addable.length > 0 && (
                    <>
                      <Hint>Extra categories to add</Hint>
                      <View className="flex-row flex-wrap gap-2">
                        {addable.map((c) => (
                          <View key={c.displayName} className="rounded-2xl border border-surface-border px-3 py-1.5" style={{ maxWidth: '100%' }}>
                            <Text className="font-sans text-sm text-white">{c.displayName}</Text>
                            {!!c.competitors?.length && <Text className="font-sans text-[11px] text-zinc-400">used by competitors</Text>}
                          </View>
                        ))}
                      </View>
                      <PrimaryButton
                        title={`Add ${plural(addable.length, 'category', 'categories')}`}
                        loading={busyKey === 'categories'}
                        disabled={busy}
                        onPress={() => propose('categories', { kind: 'categories', source: 'recommendation', proposed: { additionalCategories: addable.map((c) => ({ name: c.categoryName })) } })}
                      />
                    </>
                  )}
                  {notAddable > 0 && <Hint>{plural(notAddable, 'other category', 'other categories')} used by competitors can’t be added through Google right now.</Hint>}
                </Panel>
              )}

              <Panel title="Attributes" icon="list" hint={suggestions.length ? `${suggestions.length} not set yet` : 'All set'} count={suggestions.length}>
                {suggestions.length === 0 ? (
                  <Hint>{recs.attributes?.available === false ? 'Not available for your category right now.' : 'Nothing missing.'}</Hint>
                ) : (
                  <>
                    <Hint>Answer the ones that apply to you. Skip the rest.</Hint>
                    {suggestions.map((a, index) => (
                      <View
                        key={a.name}
                        className={`gap-2 pb-3 ${index < suggestions.length - 1 ? 'border-b border-surface-border' : ''}`}
                        style={a.valueType === 'BOOL' && !compact ? { flexDirection: 'row', alignItems: 'center' } : undefined}
                      >
                        <Text className="font-sans text-sm text-white" style={a.valueType === 'BOOL' && !compact ? { flex: 1 } : undefined}>
                          {a.displayName || attributeNames[a.name]}
                        </Text>
                        {a.valueType === 'BOOL' ? (
                          <YesNo
                            label={a.displayName || attributeNames[a.name]}
                            value={bulkBool[a.name]}
                            onChange={(v) => setBulkBool({ ...bulkBool, [a.name]: v })}
                          />
                        ) : (
                          <Field
                            placeholder={a.valueType === 'URL' ? 'https://' : 'Value'}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType={a.valueType === 'URL' ? 'url' : 'default'}
                            value={attrValues[a.name] || ''}
                            onChangeText={(text) => setAttrValues({ ...attrValues, [a.name]: text })}
                          />
                        )}
                      </View>
                    ))}
                    <PrimaryButton
                      title={selectedCount ? `Save ${plural(selectedCount, 'answer')}` : 'Answer at least one'}
                      loading={busyKey === 'attributes'}
                      disabled={busy || selectedCount === 0}
                      onPress={proposeSelectedAttributes}
                    />
                  </>
                )}
              </Panel>

              {linkKeys.length > 0 && (
                <Panel title="Booking & order links" icon="link" hint={linksSet ? `${linksSet} of ${linkKeys.length} set` : `${linkKeys.length} available`}>
                  <Hint>Customers tap these on your Google listing. We add tracking tags so you can see visits from Google.</Hint>
                  {linkKeys.map((key) => {
                    const link = recs.links!.attributes![key]!;
                    const current = recs.links?.current?.[key];
                    const label = `${key.charAt(0).toUpperCase()}${key.slice(1)} link`;
                    const value = (attrValues[link.name] || '').trim();
                    const unchanged = !!current && value !== '' && withoutUtm(current) === withoutUtm(value);
                    return (
                      <View key={key} className="gap-2">
                        <View className="flex-row items-center gap-2">
                          <Text className="flex-1 font-sans-semibold text-sm text-white">{label}</Text>
                          {!!current && <Badge label="On Google" tone="positive" />}
                        </View>
                        <Field
                          placeholder="https://"
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                          value={attrValues[link.name] || ''}
                          onChangeText={(text) => setAttrValues({ ...attrValues, [link.name]: text })}
                        />
                        {!!value && !unchanged && (
                          <SecondaryButton
                            title={busyKey === `link:${key}` ? 'Saving…' : current ? 'Update link' : 'Save link'}
                            disabled={busy}
                            onPress={() => propose(`link:${key}`, { kind: 'attribute', proposed: { name: link.name, value }, source: 'owner' })}
                          />
                        )}
                      </View>
                    );
                  })}
                </Panel>
              )}

              {(serviceItems.length > 0 || recs.services?.blocked) && (
                <Panel title="Services" icon="construct" hint={serviceItems.length ? `${plural(serviceItems.length, 'service')} to add` : 'Can’t be changed'} count={serviceItems.length}>
                  {serviceItems.length > 0 && (
                    <>
                      <View className="gap-1.5">
                        {serviceItems.map((s) => (
                          <View key={s.name} className="flex-row items-center gap-2">
                            <Ionicons name="add-circle" size={16} color={t.brandBright} />
                            <Text className="flex-1 font-sans text-sm text-white">{s.name}</Text>
                          </View>
                        ))}
                      </View>
                      <PrimaryButton
                        title="Add these services"
                        loading={busyKey === 'services'}
                        disabled={busy}
                        onPress={() => propose('services', { kind: 'services', proposed: { additions: serviceItems.map((s) => ({ name: s.name, description: s.description })) }, source: 'recommendation' })}
                      />
                    </>
                  )}
                  {recs.services?.blocked && <Hint>{recs.services.reason}</Hint>}
                </Panel>
              )}

              <Panel
                title="Opening hours"
                icon="time"
                hint={changedDays ? `${plural(changedDays, 'day')} changed — not saved yet` : reminders.length ? `${plural(reminders.length, 'holiday')} to set` : 'Your hours on Google'}
                count={reminders.length}
              >
                <Hint>These are your hours on Google now. Tap a time to change it, or switch a day off. Days you don’t touch stay as they are.</Hint>
                {DAYS.map((day) => {
                  const row = hours[day] || { open: '', close: '', closed: false };
                  const dirty = !sameDay(row, googleHours[day]);
                  return (
                    <View key={day} className="gap-2">
                      <View className="flex-row items-center gap-2">
                        <Text className="flex-1 font-sans-semibold text-sm text-white">
                          {dayLabel(day)}
                          {dirty && <Text style={{ color: t.amber }}>  • changed</Text>}
                        </Text>
                        {/* The switch itself says open/closed to screen readers; the word is dropped when space is tight. */}
                        {!compact && <Text className="font-sans text-xs text-zinc-400">{row.closed ? 'Closed' : 'Open'}</Text>}
                        <Switch
                          value={!row.closed}
                          onValueChange={(open) => setDay(day, { closed: !open })}
                          trackColor={{ false: t.border, true: t.brand }}
                          thumbColor="#ffffff"
                          accessibilityLabel={`${dayLabel(day)} open`}
                        />
                      </View>
                      {!row.closed && (
                        <View className="flex-row items-center gap-2">
                          <PickerPill
                            label={timeLabel(row.open)}
                            placeholder="Opens"
                            accessibilityLabel={`${dayLabel(day)} opens`}
                            onPress={() => pickTime(row.open, '09:00', `${dayLabel(day)} opens`, (v) => setDay(day, { open: v }))}
                          />
                          <Text className="font-sans text-xs text-zinc-400">to</Text>
                          <PickerPill
                            label={timeLabel(row.close)}
                            placeholder="Closes"
                            accessibilityLabel={`${dayLabel(day)} closes`}
                            onPress={() => pickTime(row.close, '18:00', `${dayLabel(day)} closes`, (v) => setDay(day, { close: v }))}
                          />
                        </View>
                      )}
                      {row.split && <Hint>Has a break or overnight hours on Google — only replaced if you change this day.</Hint>}
                    </View>
                  );
                })}
                {!!firstOpen && (
                  <Pressable
                    onPress={() => setHours(Object.fromEntries(DAYS.map((d) => [d, hours[d]?.closed ? hours[d] : { open: hours[firstOpen].open, close: hours[firstOpen].close, closed: false }])))}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }}
                  >
                    <Ionicons name="copy-outline" size={15} color={t.brandBright} />
                    <Text className="font-sans-semibold text-sm" style={{ color: t.brandBright }}>
                      Use {dayLabel(firstOpen)}’s hours for all open days
                    </Text>
                  </Pressable>
                )}

                <View className="gap-2.5 border-t border-surface-border pt-3.5">
                  <Text className="font-sans-semibold text-sm text-white">Special date (optional)</Text>
                  <Hint>A one-off day with different hours, like a festival or a staff day.</Hint>
                  <View className="flex-row items-center gap-2">
                    <Pressable
                      onPress={() => picker.open('date', specialDate ? new Date(`${specialDate}T12:00:00`) : new Date(), (d) => setSpecialDate(dateToYmd(d)), 'Special date')}
                      accessibilityRole="button"
                      accessibilityLabel="Pick a special date"
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, paddingHorizontal: 12 }}
                    >
                      <Ionicons name="calendar-outline" size={16} color={t.textFaint} />
                      <Text numberOfLines={1} className="font-sans-semibold text-sm" style={{ flexShrink: 1, color: specialDate ? t.text : t.textFaint }}>
                        {specialDate ? ymdLabel(specialDate) : 'Pick a date'}
                      </Text>
                    </Pressable>
                    {!!specialDate && (
                      <Pressable onPress={() => setSpecialDate('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear special date">
                        <Ionicons name="close-circle" size={22} color={t.textFaint} />
                      </Pressable>
                    )}
                  </View>
                  {!!specialDate && (
                    <>
                      <View className="flex-row items-center gap-2">
                        <Text className="flex-1 font-sans text-sm text-white">Open that day</Text>
                        <Switch
                          value={!specialClosed}
                          onValueChange={(open) => setSpecialClosed(!open)}
                          trackColor={{ false: t.border, true: t.brand }}
                          thumbColor="#ffffff"
                        />
                      </View>
                      {!specialClosed && (
                        <View className="flex-row items-center gap-2">
                          <PickerPill label={timeLabel(specialOpen)} placeholder="Opens" accessibilityLabel="Special date opens" onPress={() => pickTime(specialOpen, '09:00', 'Opens', setSpecialOpen)} />
                          <Text className="font-sans text-xs text-zinc-400">to</Text>
                          <PickerPill label={timeLabel(specialClose)} placeholder="Closes" accessibilityLabel="Special date closes" onPress={() => pickTime(specialClose, '17:00', 'Closes', setSpecialClose)} />
                        </View>
                      )}
                    </>
                  )}
                </View>

                <PrimaryButton title="Save hours" loading={busyKey === 'hours'} disabled={busy || (!changedDays && !specialDate)} onPress={proposeHours} />
                {changedDays > 0 && <SecondaryButton title="Undo my changes" disabled={busy} onPress={() => setHours(googleHours)} />}

                {recs.hours?.status === 'READY' && reminders.length > 0 && (
                  <View className="gap-2 border-t border-surface-border pt-3.5">
                    <Text className="font-sans-semibold text-sm text-white">Upcoming holidays</Text>
                    <Hint>These have no hours on Google. Tick the days you’ll be closed.</Hint>
                    {reminders.map(([date, names]) => (
                      <CheckRow
                        key={date}
                        label={`${ymdLabel(date)} — ${names.join(', ')}`}
                        checked={pickedHolidays.includes(date)}
                        onPress={() => setPickedHolidays(pickedHolidays.includes(date) ? pickedHolidays.filter((d) => d !== date) : [...pickedHolidays, date])}
                      />
                    ))}
                    {/* One proposal for all ticked days, so they can't block each other. */}
                    <SecondaryButton
                      title={busyKey === 'holidays' ? 'Saving…' : pickedHolidays.length ? `Mark ${plural(pickedHolidays.length, 'day')} closed` : 'Tick a holiday first'}
                      disabled={busy || pickedHolidays.length === 0}
                      onPress={() => propose('holidays', {
                        kind: 'hours',
                        source: 'recommendation',
                        proposed: { regularHours: { periods: [] }, specialHours: { specialHourPeriods: pickedHolidays.map((date) => ({ startDate: date, closed: true })) } },
                      })}
                    />
                  </View>
                )}
              </Panel>

              <Panel title="Service area" icon="map" hint={canSetArea ? (currentAreas.length ? `${plural(currentAreas.length, 'area')} on Google` : businessTypeText(recs.serviceArea?.businessType)) : 'Storefront only'}>
                {canSetArea ? (
                  <>
                    {currentAreas.length > 0 && (
                      <View className="gap-2">
                        <Hint>On Google now — tap one to remove it</Hint>
                        <View className="flex-row flex-wrap gap-2">
                          {currentAreas.map((area) => {
                            const removing = removedAreas.includes(area.placeId);
                            return (
                              <Pressable
                                key={area.placeId}
                                onPress={() => setRemovedAreas(removing ? removedAreas.filter((id) => id !== area.placeId) : [...removedAreas, area.placeId])}
                                accessibilityRole="button"
                                accessibilityLabel={removing ? `Keep ${area.placeName}` : `Remove ${area.placeName}`}
                                style={{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, borderRadius: 999, borderWidth: 1, borderColor: removing ? t.rose : t.border, paddingHorizontal: 12, paddingVertical: 6 }}
                              >
                                <Text numberOfLines={1} className="font-sans text-sm" style={{ flexShrink: 1, color: removing ? t.rose : t.text, textDecorationLine: removing ? 'line-through' : 'none' }}>
                                  {area.placeName}
                                </Text>
                                <Ionicons name={removing ? 'arrow-undo' : 'close'} size={14} color={removing ? t.rose : t.textFaint} />
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}
                    <Hint>Add places where you visit customers — a city or PIN code. Separate several with commas.</Hint>
                    <View className="flex-row gap-2" style={{ alignItems: 'stretch' }}>
                      <View className="flex-1">
                        <Field
                          placeholder="e.g. Nashik, 422001"
                          value={areaQuery}
                          onChangeText={setAreaQuery}
                          returnKeyType="search"
                          onSubmitEditing={() => areaQuery.trim() && resolveAreas()}
                        />
                      </View>
                      <Pressable
                        onPress={resolveAreas}
                        disabled={busy || areaQuery.trim().length < 2}
                        accessibilityRole="button"
                        accessibilityLabel="Find places"
                        // Stretches to the field's height, which grows with the system text size.
                        style={{ minHeight: 48, width: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: t.brand, opacity: busy || areaQuery.trim().length < 2 ? 0.5 : 1 }}
                      >
                        {busyKey === 'find-areas' ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="search" size={20} color="#ffffff" />}
                      </Pressable>
                    </View>
                    {areaHits.map((p) => {
                      const picked = pickedAreas.some((x) => x.placeId === p.placeId);
                      return (
                        <CheckRow
                          key={p.placeId}
                          label={`${p.placeName}${p.address ? ` — ${p.address}` : ''}`}
                          checked={picked}
                          onPress={() => setPickedAreas(picked ? pickedAreas.filter((x) => x.placeId !== p.placeId) : [...pickedAreas, { placeId: p.placeId, placeName: p.placeName }])}
                        />
                      );
                    })}
                    {(pickedAreas.length > 0 || removedAreas.length > 0) && (
                      <PrimaryButton
                        title={`Save areas (${[pickedAreas.length && `+${pickedAreas.length}`, removedAreas.length && `−${removedAreas.length}`].filter(Boolean).join(', ')})`}
                        loading={busyKey === 'areas'}
                        disabled={busy}
                        onPress={() => propose('areas', { kind: 'service_area', source: 'owner', proposed: { places: { placeInfos: pickedAreas }, removePlaceIds: removedAreas } })}
                      />
                    )}
                  </>
                ) : (
                  <Hint>
                    Your profile is set up as a shop or office customers visit, so Google doesn’t allow service areas on it. If you also travel to customers, turn on “service area” in Google Business Profile first, then add areas here.
                  </Hint>
                )}
              </Panel>

              <View className="mt-1 flex-row items-start gap-2 px-1">
                <Ionicons name="location" size={14} color={t.textFaint} style={{ marginTop: 2 }} />
                <View className="flex-1"><Hint>{pinText(recs.pin?.status)}</Hint></View>
              </View>
            </>
          )}

          {history.length > 0 && (
            <>
              <SectionLabel>{`History · ${history.length}`}</SectionLabel>
              {history.map(renderCard)}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {picker.element}
      {confirmSheet.node}
      {info.node}
    </Screen>
  );
}
