'use client';

import { CRM_STAGES, CRM_STAGE_GROUPS } from '@/lib/admin/platformCrm';

/** The CRM stage picker — grouped like the pipeline; "With a human" is shown but only set from the Inbox. */
export function StageSelect({
  value,
  onChange,
  disabled,
  className = '',
  includeAll,
}: {
  value: string;
  onChange: (stage: string) => void;
  disabled?: boolean;
  className?: string;
  includeAll?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`px-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs text-on-surface disabled:opacity-60 ${className}`}
    >
      {includeAll !== undefined && <option value="">{includeAll}</option>}
      {CRM_STAGE_GROUPS.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {CRM_STAGES.filter((s) => s.group === g.key && (s.settable || s.value === value)).map((s) => (
            <option key={s.value} value={s.value} disabled={!s.settable}>
              {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
