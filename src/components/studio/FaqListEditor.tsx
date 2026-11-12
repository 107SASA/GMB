"use client";

import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { Button, TextArea, TextInput } from "@/components/studio/ui";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Edit a list of questions & answers. Move up/down buttons instead of drag
 * and drop — works the same on a phone and needs no explanation.
 */
export function FaqListEditor({
  items,
  onChange,
  disabled,
  max = 30,
  addLabel = "Add a question",
}: {
  items: FaqItem[];
  onChange: (items: FaqItem[]) => void;
  disabled?: boolean;
  max?: number;
  addLabel?: string;
}) {
  const set = (i: number, patch: Partial<FaqItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-low p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">Question {i + 1}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={disabled || i === 0}
                aria-label="Move up"
                className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-container disabled:opacity-30"
              >
                <MaterialIcon name="arrow_upward" size={18} />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={disabled || i === items.length - 1}
                aria-label="Move down"
                className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-container disabled:opacity-30"
              >
                <MaterialIcon name="arrow_downward" size={18} />
              </button>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label="Delete question"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-error hover:bg-error-container/40 disabled:opacity-30"
              >
                <MaterialIcon name="delete" size={18} />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <TextInput
              value={it.question}
              disabled={disabled}
              maxLength={300}
              onChange={(e) => set(i, { question: e.target.value })}
              placeholder="The question, the way a customer would ask it"
              aria-label={`Question ${i + 1}`}
            />
            <TextArea
              value={it.answer}
              disabled={disabled}
              maxLength={2000}
              rows={3}
              onChange={(e) => set(i, { answer: e.target.value })}
              placeholder="A short, direct answer (2–4 sentences)"
              aria-label={`Answer ${i + 1}`}
            />
          </div>
        </div>
      ))}
      {items.length < max && (
        <Button type="button" icon="add" onClick={() => onChange([...items, { question: "", answer: "" }])} disabled={disabled}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}
