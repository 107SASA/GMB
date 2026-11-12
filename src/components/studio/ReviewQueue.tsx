"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useStudioViewer } from "@/components/studio/StudioShell";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, api, timeAgo } from "@/components/studio/ui";

interface Item {
  kind: "post" | "page";
  id: string;
  title: string;
  language: string | null;
  by: string;
  submittedAt: string;
  href: string;
}

export function ReviewQueue() {
  const viewer = useStudioViewer();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ data: { queue: Item[] } }>("/api/studio/summary")
      .then((d) => setItems(d.data.queue))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader
        title={viewer.isSuperAdmin ? "Approvals" : "Waiting for approval"}
        description={
          viewer.isSuperAdmin
            ? "Everything your team has submitted, oldest first. Open an item, check the preview, then approve it or request changes."
            : "Everything the team has sent to the Super Admin. You'll get an email when yours is reviewed."
        }
      />
      {error && <Notice tone="error">{error}</Notice>}
      {items === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-container" />
      ) : items.length === 0 ? (
        <EmptyState icon="task_alt" title="Nothing is waiting" text="When someone submits a post or a page change, it shows up here." />
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex flex-col gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 sm:flex-row sm:items-center">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fef3c7] text-[#92400e]">
                <MaterialIcon name={i.kind === "post" ? "article" : "web"} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-on-surface">{i.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant">
                  <Badge>{i.kind === "post" ? "Blog post" : "Website page"}</Badge>
                  {i.language && <Badge>{i.language === "hi" ? "हिन्दी" : "English"}</Badge>}
                  <span>
                    by {i.by} · {timeAgo(i.submittedAt)}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {i.kind === "post" && (
                  <LinkButton href={`/studio/preview/blog/${i.id}`} external icon="visibility">
                    Preview
                  </LinkButton>
                )}
                <LinkButton href={i.href} variant="primary" icon={viewer.isSuperAdmin ? "fact_check" : "open_in_new"}>
                  {viewer.isSuperAdmin ? "Review" : "Open"}
                </LinkButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
