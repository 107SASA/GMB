"use client";

import { useEffect, useId, useRef } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { cn } from "@/lib/utils";

/**
 * Small Content Studio UI kit. Big tap targets (≥44px), plain-language
 * labels and inline help — the people using this are marketers, not devs.
 */

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <a href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-on-surface-variant hover:text-primary">
            <MaterialIcon name="arrow_back" size={16} />
            {back.label}
          </a>
        )}
        <h1 className="font-heading text-2xl font-bold text-on-surface sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-on-surface-variant sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "warning";

export function Button({
  variant = "secondary",
  icon,
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; icon?: string; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-primary text-white hover:bg-primary-container shadow-sm",
        variant === "secondary" && "border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container",
        variant === "ghost" && "text-on-surface-variant hover:bg-surface-container",
        variant === "danger" && "border border-error/30 bg-surface-container-lowest text-error hover:bg-error-container/40",
        variant === "warning" && "bg-[#f59e0b] text-[#1f1300] hover:bg-[#fbbf24]",
        className
      )}
    >
      {loading ? <MaterialIcon name="progress_activity" size={18} className="animate-spin" /> : icon ? <MaterialIcon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "secondary",
  icon,
  children,
  className,
  external,
}: {
  href: string;
  variant?: BtnVariant;
  icon?: string;
  children: React.ReactNode;
  className?: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
        variant === "primary" && "bg-primary text-white hover:bg-primary-container shadow-sm",
        variant === "secondary" && "border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container",
        variant === "ghost" && "text-on-surface-variant hover:bg-surface-container",
        className
      )}
    >
      {icon && <MaterialIcon name={icon} size={18} />}
      {children}
    </a>
  );
}

export function Card({ className, children, title, description, icon }: { className?: string; children: React.ReactNode; title?: string; description?: string; icon?: string }) {
  return (
    <section className={cn("rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 sm:p-5", className)}>
      {title && (
        <div className="mb-4">
          <h2 className="flex items-center gap-2 font-semibold text-on-surface">
            {icon && <MaterialIcon name={icon} size={20} className="text-primary" />}
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-on-surface-variant">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  grey: "bg-surface-container text-on-surface-variant",
  amber: "bg-[#fef3c7] text-[#92400e]",
  red: "bg-error-container text-on-error-container",
  blue: "bg-[#dbeafe] text-[#1e40af]",
  green: "bg-[#dcfce7] text-[#166534]",
} as const;

export function Badge({ tone = "grey", icon, children }: { tone?: keyof typeof TONES; icon?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", TONES[tone])}>
      {icon && <MaterialIcon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** Character counter: green inside the ideal range, amber outside, red over the max. */
function Counter({ length, ideal, max }: { length: number; ideal?: readonly [number, number]; max?: number }) {
  if (!ideal && !max) return null;
  const tone =
    max && length > max ? "text-error" : ideal && length >= ideal[0] && length <= ideal[1] ? "text-[#166534]" : "text-[#b45309]";
  return (
    <span className={cn("text-xs font-semibold tabular-nums", tone)}>
      {length}
      {ideal ? ` / ${ideal[1]}` : max ? ` / ${max}` : ""}
    </span>
  );
}

export function Field({
  label,
  help,
  children,
  counter,
  htmlFor,
  optional,
}: {
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
  counter?: { length: number; ideal?: readonly [number, number]; max?: number };
  htmlFor?: string;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-on-surface">
          {label} {optional && <span className="font-normal text-on-surface-variant">(optional)</span>}
        </label>
        {counter && <Counter {...counter} />}
      </div>
      {children}
      {help && <p className="text-xs leading-relaxed text-on-surface-variant">{help}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 text-[16px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 sm:text-sm";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, "min-h-11", props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, "min-h-24 resize-y leading-relaxed", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, "min-h-11 pr-8", props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  help,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-on-surface">
          {label}
        </label>
        {help && <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{help}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-primary" : "bg-outline-variant"
        )}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
      </button>
    </div>
  );
}

export function Notice({ tone = "info", icon, title, children }: { tone?: "info" | "warn" | "error" | "success"; icon?: string; title?: string; children?: React.ReactNode }) {
  const map = {
    info: "border-[#bfdbfe] bg-[#eff6ff] text-[#1e3a8a]",
    warn: "border-[#fde68a] bg-[#fffbeb] text-[#78350f]",
    error: "border-error/30 bg-error-container/50 text-on-error-container",
    success: "border-[#bbf7d0] bg-[#f0fdf4] text-[#14532d]",
  };
  const defIcon = { info: "info", warn: "warning", error: "error", success: "check_circle" }[tone];
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", map[tone])}>
      <MaterialIcon name={icon || defIcon} size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-12 text-center">
      <MaterialIcon name={icon} size={44} className="mx-auto mb-3 text-outline" />
      <p className="font-semibold text-on-surface">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-md text-sm text-on-surface-variant">{text}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** Accessible modal. Closes on Escape and backdrop click. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,textarea,button")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={ref}
        className={cn(
          "relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest shadow-2xl sm:rounded-2xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        )}
      >
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
          <h2 className="font-heading text-lg font-bold text-on-surface">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-container">
            <MaterialIcon name="close" size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-outline-variant px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

export function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" | "dirty" }) {
  const map = {
    idle: { icon: "cloud_done", text: "All changes saved", cls: "text-on-surface-variant" },
    saved: { icon: "cloud_done", text: "Saved", cls: "text-[#166534]" },
    saving: { icon: "progress_activity", text: "Saving…", cls: "text-on-surface-variant" },
    dirty: { icon: "edit", text: "Unsaved changes", cls: "text-[#b45309]" },
    error: { icon: "cloud_off", text: "Not saved", cls: "text-error" },
  }[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", map.cls)} aria-live="polite">
      <MaterialIcon name={map.icon} size={16} className={state === "saving" ? "animate-spin" : ""} />
      {map.text}
    </span>
  );
}

/** fetch + JSON with the API's friendly error message thrown as an Error. */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const err = new Error(data?.error || "Something went wrong. Please try again.") as Error & { code?: string; status?: number };
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
