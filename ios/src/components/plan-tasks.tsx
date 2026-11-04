import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/api/client';
import { dismissTaskPopup, fetchTasks, isOpenTask, markTaskDone, type PlanTask, type TaskStatus } from '@/api/endpoints/tasks';
import { useBusiness } from '@/business/BusinessContext';
import { Badge, BottomSheet, Card, PrimaryButton, ProgressBar, SecondaryButton, useConfirmSheet, useInfoSheet } from '@/components/ui';
import { useTheme, withAlpha } from '@/lib/theme';

/**
 * Audit → fix → proof in the app: the latest report's fixes with live status,
 * each opening the screen that fixes it (target.mobile from the server).
 * Dashboard checklist + "fixes ready" sheet, and the audit screen's list.
 */

export function usePlanTasks(enabled = true) {
  const { activeBusinessId } = useBusiness();
  return useQuery({
    queryKey: ['plan-tasks', activeBusinessId],
    queryFn: fetchTasks,
    enabled: enabled && !!activeBusinessId,
  });
}

const STATUS: Record<TaskStatus, { label: string; tone: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' }> = {
  open: { label: 'To do', tone: 'neutral' },
  waiting_approval: { label: 'Waiting for approval', tone: 'info' },
  done: { label: 'Done', tone: 'positive' },
  confirmed: { label: 'Confirmed', tone: 'positive' },
  reopened: { label: 'Found again', tone: 'negative' },
  blocked: { label: 'Blocked', tone: 'warning' },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge label={STATUS[status].label} tone={STATUS[status].tone} />;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/** Small inline button — no className on Pressable (react-native-css-interop can swallow onPress). */
function SmallButton({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: t.brand, minHeight: 36 }}
    >
      <Text className="font-sans-bold text-xs text-on-brand">{title}</Text>
      <Ionicons name="arrow-forward" size={14} color="#ffffff" />
    </Pressable>
  );
}

/** "Fix now" → the screen; or the steps + "I've done this" for work outside the app. */
export function TaskFixAction({ task }: { task: PlanTask }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirmSheet();
  const info = useInfoSheet();
  const done = useMutation({
    mutationFn: () => markTaskDone(task.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan-tasks'] }),
    onError: (err) => info.show('Couldn’t save that', getApiErrorMessage(err, 'Please try again.')),
  });

  if (task.status === 'done' || task.status === 'confirmed') {
    const when = day(task.status === 'confirmed' ? task.confirmedAt : task.doneAt);
    return <Text className="font-sans text-xs text-zinc-400">{task.status === 'confirmed' ? 'Confirmed' : 'Done'}{when ? ` on ${when}` : ''}</Text>;
  }
  if (task.status === 'blocked') return <Text className="font-sans text-xs text-zinc-400">{task.statusReason}</Text>;

  if (task.target.mobile) {
    const mobile = task.target.mobile;
    const title = task.status === 'waiting_approval' ? 'Approve now' : task.actor === 'automatic' ? 'View' : 'Fix now';
    return <SmallButton title={title} onPress={() => router.push(mobile as never)} />;
  }
  const steps = task.ownerAction || task.title;
  return (
    <>
      <SmallButton
        title={task.target.label}
        onPress={() =>
          task.canMarkDone
            ? confirm.confirm({ title: task.title, message: steps, confirmLabel: 'I’ve done this', cancelLabel: 'Not yet', onConfirm: () => done.mutate() })
            : info.show(task.title, steps)
        }
      />
      {confirm.node}
      {info.node}
    </>
  );
}

export function TaskRow({ task }: { task: PlanTask }) {
  return (
    <View className="gap-2 border-t border-surface-border py-3">
      <TaskStatusBadge status={task.status} />
      <Text className="font-sans-semibold text-sm text-white">{task.title}</Text>
      {!!task.statusReason && <Text className="font-sans text-xs text-zinc-400">{task.statusReason}</Text>}
      <TaskFixAction task={task} />
    </View>
  );
}

/** Audit screen: the fixes for the issues in THIS report, with today's status. */
export function ReportFixList({ findingIds }: { findingIds: string[] }) {
  const query = usePlanTasks(findingIds.length > 0);
  const ids = new Set(findingIds);
  const tasks = (query.data?.tasks ?? []).filter((x) => ids.has(x.findingId));
  if (!tasks.length) return null;
  const completed = tasks.filter((x) => x.status === 'done' || x.status === 'confirmed').length;
  return (
    <Card className="gap-1">
      <Text className="font-sans-bold text-base text-white">Fix these issues</Text>
      <Text className="font-sans text-xs text-zinc-400">{completed} of {tasks.length} done · status is live, the numbers below are from this report’s date</Text>
      <View className="mt-2">{tasks.map((x) => <TaskRow key={x.id} task={x} />)}</View>
    </Card>
  );
}

/** Dashboard: "Your checklist" + the once-per-report "fixes ready" sheet. Hidden when nothing is left. */
export function TaskChecklistCard() {
  const t = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = usePlanTasks();
  const data = query.data;
  const [sheetOpen, setSheetOpen] = useState(false);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (data?.showPopup && data.report && shownFor.current !== data.report.auditId) {
      shownFor.current = data.report.auditId;
      setSheetOpen(true);
    }
  }, [data]);

  if (!data || data.summary.total === 0) return null;
  const open = data.tasks.filter(isOpenTask);
  const approvals = open.filter((x) => x.actor === 'approve').length;

  const closeSheet = () => {
    setSheetOpen(false);
    if (data.report) {
      dismissTaskPopup(data.report.auditId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['plan-tasks'] }))
        .catch(() => {});
    }
  };
  const start = () => {
    closeSheet();
    const first = open.find((x) => x.target.mobile);
    if (first?.target.mobile) router.push(first.target.mobile as never);
  };

  return (
    <>
      {open.length > 0 && (
        <Card className="mx-4 mt-4 gap-2">
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: withAlpha(t.brand, 0.15) }}>
              <Ionicons name="checkmark-done-circle" size={20} color={t.brandBright} />
            </View>
            <View className="flex-1">
              <Text className="font-sans-bold text-base text-white">Your checklist</Text>
              <Text className="font-sans text-xs text-zinc-400">{data.summary.completed} of {data.summary.total} done · from your latest report</Text>
            </View>
          </View>
          <ProgressBar used={data.summary.completed} limit={data.summary.total} />
          <View className="mt-1">{open.slice(0, 3).map((x) => <TaskRow key={x.id} task={x} />)}</View>
          {open.length > 3 && <Text className="font-sans text-xs text-zinc-400">+{open.length - 3} more</Text>}
        </Card>
      )}
      <BottomSheet visible={sheetOpen} onClose={closeSheet}>
        <View className="gap-3">
          <Text className="font-sans-bold text-lg text-white">
            Your report found {open.length} thing{open.length === 1 ? '' : 's'} to fix
          </Text>
          <Text className="font-sans text-sm leading-5 text-zinc-400">
            {approvals > 0
              ? `${approvals} ${approvals === 1 ? 'is' : 'are'} ready — you just approve and we update Google. It takes a couple of minutes.`
              : 'We’ll take you to each one in turn.'}
          </Text>
          {open.slice(0, 4).map((x) => (
            <View key={x.id} className="flex-row items-center gap-2">
              <Ionicons name={x.actor === 'approve' ? 'checkmark-circle-outline' : 'person-outline'} size={16} color={t.brandBright} />
              <Text className="flex-1 font-sans text-sm text-white">{x.title}</Text>
            </View>
          ))}
          {open.length > 4 && <Text className="font-sans text-xs text-zinc-400">+{open.length - 4} more</Text>}
          <PrimaryButton title="Start" onPress={start} />
          <SecondaryButton title="Later" onPress={closeSheet} />
        </View>
      </BottomSheet>
    </>
  );
}
