'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useBusiness } from '@/context/BusinessContext';
import { usePlanTasks } from '@/hooks/usePlanTasks';
import { SECTION_FOCUS_EVENT } from '@/hooks/useSectionFocus';
import type { TaskDisplayStatus, TaskView } from '@/services/tasks/planTasks';

/**
 * Audit → fix → proof, web side: every open plan task links to the screen
 * that fixes it (planTasks.ts fixTargetFor). Used by the report, the
 * dashboard checklist, the "fixes ready" popup and the guided-fix bar.
 */

const STATUS_STYLE: Record<TaskDisplayStatus, { label: string; cls: string; icon: string }> = {
  open: { label: 'To do', cls: 'bg-surface-container text-on-surface-variant', icon: 'radio_button_unchecked' },
  waiting_approval: { label: 'Waiting for approval', cls: 'bg-primary-fixed text-on-primary-fixed', icon: 'pending' },
  done: { label: 'Done', cls: 'bg-secondary-container text-on-secondary-container', icon: 'check_circle' },
  confirmed: { label: 'Confirmed', cls: 'bg-secondary-container text-on-secondary-container', icon: 'verified' },
  reopened: { label: 'Found again', cls: 'bg-error-container text-on-error-container', icon: 'replay' },
  blocked: { label: 'Blocked', cls: 'bg-surface-container text-outline', icon: 'block' },
};

export function TaskStatusBadge({ status }: { status: TaskDisplayStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      <MaterialIcon name={s.icon} size={13} /> {s.label}
    </span>
  );
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/** "Fix now →" for a task, or how-to steps + "I've done this" for work outside GrowwMatics. */
export function TaskFixAction({ task, onMarkDone, compact = false }: { task: TaskView; onMarkDone?: (id: string) => Promise<string | null>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (task.status === 'done' || task.status === 'confirmed') {
    const when = day(task.status === 'confirmed' ? task.confirmedAt : task.doneAt);
    return <span className="text-xs text-on-surface-variant">{task.status === 'confirmed' ? 'Confirmed' : 'Done'}{when ? ` on ${when}` : ''}</span>;
  }
  if (task.status === 'blocked') return <span className="text-xs text-outline">{task.statusReason}</span>;

  if (task.target.web) {
    return (
      <Link
        href={task.target.web}
        className={`inline-flex items-center gap-1 rounded-lg bg-primary font-bold text-white transition-colors hover:bg-primary-container ${compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
      >
        {task.status === 'waiting_approval' ? 'Approve now' : task.actor === 'automatic' ? 'View' : 'Fix now'} <MaterialIcon name="arrow_forward" size={16} />
      </Link>
    );
  }

  const markDone = async () => {
    if (!onMarkDone) return;
    setBusy(true);
    setError(await onMarkDone(task.id));
    setBusy(false);
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-primary underline">
        {open ? 'Hide steps' : task.target.label}
      </button>
      {open && (
        <div className="space-y-2 rounded-lg bg-surface-container px-3 py-2 text-xs text-on-surface">
          <p>{task.ownerAction || task.title}</p>
          {task.canMarkDone && onMarkDone && (
            <button type="button" disabled={busy} onClick={markDone} className="rounded-lg border border-outline-variant px-3 py-1.5 font-semibold hover:bg-surface disabled:opacity-60">
              {busy ? 'Saving…' : 'I’ve done this'}
            </button>
          )}
          {error && <p className="text-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function TaskRow({ task, onMarkDone }: { task: TaskView; onMarkDone?: (id: string) => Promise<string | null> }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <span className="text-sm font-semibold text-on-surface">{task.title}</span>
        </div>
        <p className="text-xs text-on-surface-variant">{task.statusReason}</p>
      </div>
      <div className="shrink-0">
        <TaskFixAction task={task} onMarkDone={onMarkDone} compact />
      </div>
    </li>
  );
}

const isOpen = (t: TaskView) => t.status === 'open' || t.status === 'waiting_approval' || t.status === 'reopened';

// ── Guided walkthrough ──────────────────────────────────────────────────────

const GUIDE_KEY = 'gm.guidedFixes';
interface GuideState { ids: string[]; index: number }

function readGuide(): GuideState | null {
  try {
    const raw = window.sessionStorage.getItem(GUIDE_KEY);
    return raw ? (JSON.parse(raw) as GuideState) : null;
  } catch {
    return null;
  }
}
function writeGuide(g: GuideState | null) {
  try {
    if (g) window.sessionStorage.setItem(GUIDE_KEY, JSON.stringify(g));
    else window.sessionStorage.removeItem(GUIDE_KEY);
  } catch {
    // Private mode: the walkthrough still opens the first fix.
  }
  window.dispatchEvent(new Event(GUIDE_KEY));
}

/** Opens a task's screen; on the page already open, focuses the section instead. */
function goTo(router: ReturnType<typeof useRouter>, task: TaskView) {
  if (!task.target.web) return;
  router.push(task.target.web);
  if (task.target.section) window.dispatchEvent(new CustomEvent(SECTION_FOCUS_EVENT, { detail: task.target.section }));
}

/** Starts the step-by-step walkthrough over the open tasks, in list order. */
export function useStartGuidedFixes() {
  const router = useRouter();
  return (tasks: TaskView[]) => {
    const steps = tasks.filter(isOpen);
    if (!steps.length) return;
    writeGuide({ ids: steps.map((t) => t.id), index: 0 });
    if (steps[0].target.web) goTo(router, steps[0]);
  };
}

/** Bottom bar during the walkthrough: which fix, what to do, Next / Exit. Mounted in the dashboard layout. */
export function GuidedFixBar() {
  const { activeBusiness } = useBusiness();
  const router = useRouter();
  const pathname = usePathname();
  const [guide, setGuide] = useState<GuideState | null>(null);
  const { data, markDone, reload } = usePlanTasks(activeBusiness?._id, !!guide);

  useEffect(() => {
    const sync = () => setGuide(readGuide());
    sync();
    window.addEventListener(GUIDE_KEY, sync);
    return () => window.removeEventListener(GUIDE_KEY, sync);
  }, []);
  // A change applied on this page should show as done in the bar.
  useEffect(() => {
    if (guide) reload();
  }, [pathname, guide, reload]);

  if (!guide || !data) return null;
  const task = data.tasks.find((t) => t.id === guide.ids[guide.index]);
  const last = guide.index >= guide.ids.length - 1;

  const exit = () => writeGuide(null);
  const next = () => {
    if (last) {
      writeGuide(null);
      router.push('/dashboard');
      return;
    }
    const g = { ...guide, index: guide.index + 1 };
    writeGuide(g);
    const t = data.tasks.find((x) => x.id === g.ids[g.index]);
    if (t?.target.web) goTo(router, t);
  };

  const doneNow = task && !isOpen(task);
  const hint = !task ? 'This fix is no longer on your list.'
    : doneNow ? 'Done — nice work.'
    : task.actor === 'approve' ? 'Choose what’s true for your business, then press “Apply to Google”.'
    : task.target.web ? task.ownerAction || task.statusReason
    : task.ownerAction || task.title;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-60 lg:bottom-6 lg:left-auto lg:right-6 lg:w-[420px]" role="dialog" aria-label="Guided fixes">
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Fix {guide.index + 1} of {guide.ids.length}</p>
            <p className="text-sm font-semibold text-on-surface">{task?.title || 'Fix'}</p>
            <p className="mt-1 text-xs text-on-surface-variant">{hint}</p>
          </div>
          <button type="button" onClick={exit} className="text-xs font-semibold text-on-surface-variant hover:text-on-surface">Exit</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {task && !doneNow && !task.target.web && task.canMarkDone && (
            <button type="button" onClick={() => markDone(task.id)} className="rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold hover:bg-surface">I’ve done this</button>
          )}
          <button type="button" onClick={next} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary-container">
            {last ? 'Finish' : doneNow ? 'Next fix' : 'Skip for now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard: checklist card + "fixes ready" popup ─────────────────────────

/** "Your checklist: 3 of 6 done" on the dashboard home. Hidden when nothing is left to do. */
export function TaskChecklistCard() {
  const { activeBusiness } = useBusiness();
  const { data, markDone, dismissPopup } = usePlanTasks(activeBusiness?._id);
  const start = useStartGuidedFixes();
  if (!data || data.summary.total === 0) return null;

  const open = data.tasks.filter(isOpen);
  const pct = Math.round((data.summary.completed / data.summary.total) * 100);

  return (
    <>
      {data.showPopup && (
        <TaskFixesPopup
          openTasks={open}
          onStart={() => { dismissPopup(); start(data.tasks); }}
          onClose={dismissPopup}
        />
      )}
      {open.length > 0 && (
        <section className="mb-6 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm" aria-labelledby="checklist-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="checklist-title" className="font-heading text-base font-bold text-on-surface">Your checklist</h2>
              <p className="text-sm text-on-surface-variant">{data.summary.completed} of {data.summary.total} done · from your latest report</p>
            </div>
            <button type="button" onClick={() => start(data.tasks)} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-container">
              Fix them step by step
            </button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-2 divide-y divide-outline-variant">
            {open.slice(0, 5).map((t) => <TaskRow key={t.id} task={t} onMarkDone={markDone} />)}
          </ul>
          {open.length > 5 && <p className="pt-2 text-xs text-on-surface-variant">+{open.length - 5} more in the walkthrough</p>}
        </section>
      )}
    </>
  );
}

function TaskFixesPopup({ openTasks, onStart, onClose }: { openTasks: TaskView[]; onStart: () => void; onClose: () => void }) {
  const approvals = openTasks.filter((t) => t.actor === 'approve').length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="fixes-title">
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-xl">
        <h2 id="fixes-title" className="font-heading text-lg font-bold text-on-surface">
          Your report found {openTasks.length} thing{openTasks.length === 1 ? '' : 's'} to fix
        </h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          {approvals > 0
            ? `${approvals} ${approvals === 1 ? 'is' : 'are'} ready — you just approve and we update Google. It takes a couple of minutes.`
            : 'We’ll take you to each one in turn.'}
        </p>
        <ul className="mt-4 space-y-2">
          {openTasks.slice(0, 4).map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm text-on-surface">
              <MaterialIcon name={t.actor === 'approve' ? 'task_alt' : 'person'} size={16} className="text-primary" /> {t.title}
            </li>
          ))}
          {openTasks.length > 4 && <li className="text-xs text-on-surface-variant">+{openTasks.length - 4} more</li>}
        </ul>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-semibold text-on-surface hover:bg-surface">Later</button>
          <button type="button" onClick={onStart} className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-container">Start</button>
        </div>
      </div>
    </div>
  );
}

// ── Audit report: the fixes for the issues in THIS report ──────────────────

/** Tasks for this report's findings, with their live status (a report is a snapshot; the status is today's). */
export function ReportFixList({ tasks, onMarkDone }: { tasks: TaskView[]; onMarkDone: (id: string) => Promise<string | null> }) {
  const start = useStartGuidedFixes();
  if (!tasks.length) return null;
  const completed = tasks.filter((t) => t.status === 'done' || t.status === 'confirmed').length;
  const open = tasks.filter(isOpen);
  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm" aria-labelledby="report-fixes-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="report-fixes-title" className="text-base font-bold text-on-surface">Fix these issues</h2>
          <p className="text-sm text-on-surface-variant">
            {completed} of {tasks.length} done · status is live, the measurements below are from this report’s date
          </p>
        </div>
        {open.length > 0 && (
          <button type="button" onClick={() => start(tasks)} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-container">
            Fix them step by step
          </button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-outline-variant">
        {tasks.map((t) => <TaskRow key={t.id} task={t} onMarkDone={onMarkDone} />)}
      </ul>
    </section>
  );
}
