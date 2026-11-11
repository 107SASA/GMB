'use client';

import { CRM_STAGES, CRM_STAGE_GROUPS } from '@/lib/admin/platformCrm';
import { PARTNER_STAGES } from '@/lib/partners/partnerCrmRules';

/**
 * Stage picker for a partner's lead. "Payment verified" and "Customer" are
 * shown when the lead is in them, but can't be picked — only a payment sets
 * them. A customer's stage is locked.
 */
export function PartnerStageSelect({
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
  const settable = new Set(PARTNER_STAGES.map((s) => s.value as string));
  const locked = value === 'CUSTOMER';
  return (
    <select
      value={value}
      disabled={disabled || (locked && includeAll === undefined)}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Stage"
      className={`px-2 py-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs text-on-surface disabled:opacity-60 ${className}`}
    >
      {includeAll !== undefined && <option value="">{includeAll}</option>}
      {CRM_STAGE_GROUPS.map((g) => {
        const stages = CRM_STAGES.filter(
          (s) => s.group === g.key && (settable.has(s.value) || s.value === value || (includeAll !== undefined && s.value === 'CUSTOMER'))
        );
        if (!stages.length) return null;
        return (
          <optgroup key={g.key} label={g.label}>
            {stages.map((s) => (
              <option key={s.value} value={s.value} disabled={includeAll === undefined && !settable.has(s.value)}>
                {s.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
