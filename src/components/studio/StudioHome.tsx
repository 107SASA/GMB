"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useStudioViewer } from "@/components/studio/StudioShell";
import { Card, LinkButton, Notice, PageHeader, api, timeAgo } from "@/components/studio/ui";

interface Summary {
  queue: { kind: "post" | "page"; id: string; title: string; language: string | null; by: string; submittedAt: string; href: string }[];
  changesRequested: { id: string; title: string; note: string; updatedAt: string }[];
  stats: { livePosts: number; drafts: number; scheduled: number; waiting: number };
}

export function StudioHome() {
  const viewer = useStudioViewer();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const canBlog = viewer.permissions.includes("blog");
  const canCms = viewer.permissions.includes("cms");

  useEffect(() => {
    api<{ data: Summary }>("/api/studio/summary").then((d) => setData(d.data)).catch((e) => setError(e.message));
  }, []);

  const first = viewer.name.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={`Hi ${first} 👋`}
        description={
          viewer.isSuperAdmin
            ? "Write posts, edit website pages and approve what your team sends in."
            : "Write blog posts and edit website pages. Nothing goes live until a Super Admin approves it."
        }
        actions={
          canBlog ? (
            <LinkButton href="/studio/blog/new" variant="primary" icon="edit_square">
              Write a new post
            </LinkButton>
          ) : undefined
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      {canBlog && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Live posts", value: data?.stats.livePosts, icon: "public", href: "/studio/blog?status=live" },
            { label: "Drafts", value: data?.stats.drafts, icon: "edit_note", href: "/studio/blog?status=draft" },
            { label: "Waiting for approval", value: data?.stats.waiting, icon: "hourglass_top", href: "/studio/review" },
            { label: "Scheduled", value: data?.stats.scheduled, icon: "schedule", href: "/studio/blog?status=scheduled" },
          ].map((s) => (
            <a key={s.label} href={s.href} className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 transition-colors hover:border-primary">
              <MaterialIcon name={s.icon} size={22} className="text-primary" />
              <p className="mt-2 text-2xl font-bold text-on-surface">{s.value ?? "–"}</p>
              <p className="text-sm text-on-surface-variant">{s.label}</p>
            </a>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={viewer.isSuperAdmin ? "Waiting for your approval" : "Waiting for approval"}
          icon="fact_check"
          description={viewer.isSuperAdmin ? "Oldest first. Open one to preview, approve or send back." : "What the team has sent to the Super Admin."}
        >
          {!data ? (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          ) : data.queue.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Nothing waiting. 🎉</p>
          ) : (
            <ul className="divide-y divide-outline-variant">
              {data.queue.slice(0, 8).map((q) => (
                <li key={`${q.kind}-${q.id}`}>
                  <a href={q.href} className="flex items-center gap-3 py-3 hover:text-primary">
                    <MaterialIcon name={q.kind === "post" ? "article" : "web"} size={20} className="shrink-0 text-on-surface-variant" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{q.title}</span>
                      <span className="block text-xs text-on-surface-variant">
                        {q.kind === "post" ? "Blog post" : "Website page"} · {q.by} · {timeAgo(q.submittedAt)}
                      </span>
                    </span>
                    <MaterialIcon name="chevron_right" size={20} className="shrink-0 text-outline" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canBlog && (
          <Card title="Sent back to you" icon="assignment_return" description="Posts the Super Admin asked you to change.">
            {!data ? (
              <p className="text-sm text-on-surface-variant">Loading…</p>
            ) : data.changesRequested.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Nothing to fix right now.</p>
            ) : (
              <ul className="divide-y divide-outline-variant">
                {data.changesRequested.map((p) => (
                  <li key={p.id}>
                    <a href={`/studio/blog/${p.id}`} className="block py-3 hover:text-primary">
                      <span className="block truncate text-sm font-semibold">{p.title}</span>
                      <span className="block text-xs text-on-surface-variant line-clamp-2">“{p.note}”</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="How it works" icon="help" className="lg:col-span-2">
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: "edit_square", title: "1. Write", text: "Pick a template, write your post, and follow the SEO checklist on the right until it's green." },
              { icon: "send", title: "2. Submit", text: "Click “Submit for approval”. A Super Admin gets an email and reviews it." },
              { icon: "rocket_launch", title: "3. Goes live", text: "Once approved it appears on growwmatics.com/blog — or on the date it was scheduled for." },
            ].map((s) => (
              <li key={s.title} className="rounded-xl bg-surface-container-low p-4">
                <MaterialIcon name={s.icon} size={24} className="text-primary" />
                <p className="mt-2 font-semibold">{s.title}</p>
                <p className="mt-1 text-sm text-on-surface-variant">{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            {canBlog && <LinkButton href="/studio/blog" icon="article">All blog posts</LinkButton>}
            {canCms && <LinkButton href="/studio/pages" icon="web">Edit website pages</LinkButton>}
            <LinkButton href="/blog" external icon="open_in_new" variant="ghost">
              Open the live blog
            </LinkButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
