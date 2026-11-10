import { cn } from '@/lib/utils';

export type ActivityStatus = 'active' | 'slipping' | 'inactive';

const STYLES: Record<ActivityStatus, { label: string; dot: string; chip: string }> = {
  active:   { label: 'Active',   dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900' },
  slipping: { label: 'Slipping', dot: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900' },
  inactive: { label: 'Inactive', dot: 'bg-red-500',     chip: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900' },
};

export function ActivityBadge({ status, className }: { status: ActivityStatus; className?: string }) {
  const s = STYLES[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-bold rounded-md border whitespace-nowrap', s.chip, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

/** "today" / "3 days ago" / "never" */
export function agoLabel(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 60) return `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const CALL_OUTCOME_LABELS: Record<string, string> = {
  reached: 'Reached them',
  no_answer: 'No answer',
  call_back: 'Asked to call back',
  not_interested: 'Not interested',
  whatsapp_sent: 'Sent WhatsApp',
};
