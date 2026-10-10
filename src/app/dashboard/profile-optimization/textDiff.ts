/**
 * Word-level comparison for profile proposals. Pure. No I/O.
 * Tokens keep whitespace and punctuation so a review can see the real edit.
 */

export type DiffPart = { type: 'equal' | 'insert' | 'delete'; value: string };

export const APPROVAL_DOES_NOT_PUBLISH = 'Approve records this proposal. It does not publish the change to Google.';
export const APPLY_REQUIRES_BOTH_FLAGS = 'Apply to Google is a separate operation. It runs only when both GBP_LIVE_WRITES_ENABLED and GBP_FR5_LIVE_WRITES_ENABLED are exactly "true".';
export const VALIDATION_PASSED = 'Validation passed.';
export const VALIDATION_LIMIT = 'Passing validation does not prove this change is safe, and it does not mean Google will accept it.';
export const SENSITIVE_CONFIRM = 'This field needs a separate confirmation before it can be approved. Confirmation does not publish the change.';

export interface ValidationInput {
  valid?: boolean;
  violations?: Array<{ message?: string }>;
  warnings?: Array<{ message?: string }>;
}

export function validationReview(validation: ValidationInput | null | undefined): {
  passed: boolean;
  violations: string[];
  warnings: string[];
} {
  const violations = (validation?.violations || []).map((item) => item.message).filter((message): message is string => Boolean(message));
  const warnings = (validation?.warnings || []).map((item) => item.message).filter((message): message is string => Boolean(message));
  return {
    passed: Boolean(validation) && validation?.valid === true && violations.length === 0,
    violations,
    warnings,
  };
}

export function proposalText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value, null, 2);
}

/** Words, whitespace runs, and punctuation stay as separate tokens. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[A-Za-z0-9]+|[^\sA-Za-z0-9]+/g) || [];
}

export function wordDiff(before: string, after: string): DiffPart[] {
  const left = tokenize(before);
  const right = tokenize(after);
  const n = left.length;
  const m = right.length;
  const scores: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      scores[i][j] = left[i] === right[j] ? scores[i + 1][j + 1] + 1 : Math.max(scores[i + 1][j], scores[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], value: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.value += value;
    else parts.push({ type, value });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      push('equal', left[i]);
      i += 1;
      j += 1;
    } else if (scores[i + 1][j] >= scores[i][j + 1]) {
      push('delete', left[i]);
      i += 1;
    } else {
      push('insert', right[j]);
      j += 1;
    }
  }
  while (i < n) push('delete', left[i++]);
  while (j < m) push('insert', right[j++]);
  return parts;
}
