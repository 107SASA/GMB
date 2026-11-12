"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { Badge, Notice, PageHeader, api, timeAgo } from "@/components/studio/ui";
import { CMS_PAGE_GROUPS } from "@/lib/cms/pages";

interface PageRow {
  key: string;
  label: string;
  help: string;
  path: string;
  group: string;
  hasFaqs: boolean;
  status: "default" | "draft" | "in_review" | "changes_requested" | "published";
  customized: boolean;
  hidden: boolean;
  liveUpdatedAt: string | null;
  updatedAt: string | null;
}

function StatusBadge({ r }: { r: PageRow }) {
  if (r.status === "in_review") return <Badge tone="amber" icon="hourglass_top">Waiting for approval</Badge>;
  if (r.status === "changes_requested") return <Badge tone="red" icon="assignment_return">Changes requested</Badge>;
  if (r.status === "draft") return <Badge tone="grey" icon="edit">Unsent changes</Badge>;
  if (r.customized) return <Badge tone="green" icon="check">Edited · live</Badge>;
  return <Badge>Original text</Badge>;
}

export function PageList() {
  const [rows, setRows] = useState<PageRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ data: PageRow[] }>("/api/studio/pages").then((d) => setRows(d.data)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader
        title="Website pages"
        description="Change how each page appears in Google and when shared on WhatsApp, and edit the questions & answers. Changes go live after a Super Admin approves them."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {rows === null ? (
        <div className="h-64 animate-pulse rounded-2xl bg-surface-container" />
      ) : (
        <div className="space-y-8">
          {CMS_PAGE_GROUPS.map((g) => {
            const list = rows.filter((r) => r.group === g);
            if (!list.length) return null;
            return (
              <section key={g}>
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-on-surface-variant">{g}</h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {list.map((r) => (
                    <li key={r.key}>
                      <a
                        href={`/studio/pages/${r.key}`}
                        className="flex h-full items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary"
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
                          <MaterialIcon name={r.hasFaqs ? "quiz" : "web"} size={22} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-on-surface">{r.label}</span>
                          <span className="block truncate text-xs text-on-surface-variant">growwmatics.com{r.path === "/" ? "" : r.path}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <StatusBadge r={r} />
                            {r.hidden && <Badge tone="red" icon="visibility_off">Hidden from Google</Badge>}
                            {r.hasFaqs && <span className="text-xs text-on-surface-variant">Has Q&amp;A</span>}
                            {r.liveUpdatedAt && <span className="text-xs text-on-surface-variant">Updated {timeAgo(r.liveUpdatedAt)}</span>}
                          </span>
                        </span>
                        <MaterialIcon name="chevron_right" size={22} className="shrink-0 text-outline" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
