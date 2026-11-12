"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, Select, TextInput, api, timeAgo } from "@/components/studio/ui";
import { STATUS_LABEL, STATUS_TONE, blogPostPath, type BlogLanguage } from "@/lib/blog/shared";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  title: string;
  language: BlogLanguage;
  status: keyof typeof STATUS_LABEL;
  liveState: string;
  liveSlug: string | null;
  hasUnpublishedChanges: boolean;
  category: string | null;
  coverUrl: string | null;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
  reviewNote: string | null;
}

const FILTERS = [
  { id: "", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "in_review", label: "Waiting" },
  { id: "changes_requested", label: "Changes requested" },
  { id: "live", label: "Live" },
  { id: "scheduled", label: "Scheduled" },
  { id: "archived", label: "Taken down" },
];

export function PostList() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") || "");
  const [lang, setLang] = useState("");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (lang) sp.set("lang", lang);
    if (q.trim()) sp.set("q", q.trim());
    if (mine) sp.set("mine", "1");
    try {
      const d = await api<{ data: Row[] }>(`/api/studio/blog/posts?${sp}`);
      setRows(d.data);
    } catch (e: any) {
      setError(e.message);
      setRows([]);
    }
  }, [status, lang, q, mine]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div>
      <PageHeader
        title="Blog posts"
        description="Every post the team is working on. Click one to edit it."
        actions={
          <LinkButton href="/studio/blog/new" variant="primary" icon="edit_square">
            Write a new post
          </LinkButton>
        }
      />

      <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={cn(
                "min-h-10 whitespace-nowrap rounded-full px-4 text-sm font-semibold",
                status === f.id ? "bg-primary text-white" : "border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <div className="relative">
          <MaterialIcon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title" className="pl-9" />
        </div>
        <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
          <option value="">All languages</option>
          <option value="en">English</option>
          <option value="hi">Hindi</option>
        </Select>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-sm font-medium">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-[#06b34c]" />
          Only mine
        </label>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {rows === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-container" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="edit_note"
          title={status || q || lang || mine ? "No posts match" : "No posts yet"}
          text={status || q || lang || mine ? "Try another filter." : "Start with a template — the structure is already set up for Google."}
          action={
            <LinkButton href="/studio/blog/new" variant="primary" icon="edit_square">
              Write your first post
            </LinkButton>
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <a
                href={`/studio/blog/${r.id}`}
                className="flex gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 transition-colors hover:border-primary sm:items-center sm:p-4"
              >
                <div className="relative hidden h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-surface-container sm:block">
                  {r.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <MaterialIcon name="image" size={24} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-outline" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-on-surface line-clamp-2 sm:truncate">{r.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.hasUnpublishedChanges && <Badge tone="green" icon="public">Live (older version)</Badge>}
                    <Badge>{r.language === "hi" ? "हिन्दी" : "English"}</Badge>
                    {r.category && <span className="text-xs text-on-surface-variant">{r.category}</span>}
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Edited {timeAgo(r.updatedAt)}
                    {r.updatedBy ? ` by ${r.updatedBy}` : ""} · Started by {r.createdBy}
                  </p>
                </div>
                {r.liveState === "live" && r.liveSlug && (
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(blogPostPath(r.language, r.liveSlug!), "_blank", "noopener");
                    }}
                    className="hidden shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-fixed sm:inline-flex"
                  >
                    <MaterialIcon name="open_in_new" size={14} /> View
                  </span>
                )}
                <MaterialIcon name="chevron_right" size={22} className="shrink-0 self-center text-outline" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
