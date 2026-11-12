"use client";

import { useCallback, useEffect, useState } from "react";
import { useStudioViewer } from "@/components/studio/StudioShell";
import { Button, Card, EmptyState, Field, Modal, Notice, PageHeader, TextArea, TextInput, api } from "@/components/studio/ui";
import { slugify } from "@/lib/blog/shared";

interface Topic {
  id: string;
  slug: string;
  name: { en: string; hi?: string };
  description: { en?: string; hi?: string };
  posts: number;
}

const empty = { nameEn: "", nameHi: "", descriptionEn: "", descriptionHi: "" };

export function TopicsManager() {
  const viewer = useStudioViewer();
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Topic | "new" | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ data: Topic[] }>("/api/studio/blog/categories")
      .then((d) => setTopics(d.data))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const open = (t: Topic | "new") => {
    setError("");
    setEditing(t);
    setForm(
      t === "new"
        ? empty
        : { nameEn: t.name.en, nameHi: t.name.hi || "", descriptionEn: t.description.en || "", descriptionHi: t.description.hi || "" }
    );
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (editing === "new") await api("/api/studio/blog/categories", { method: "POST", json: form });
      else if (editing) await api(`/api/studio/blog/categories/${editing.id}`, { method: "PATCH", json: form });
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: Topic) => {
    if (!confirm(`Delete the topic “${t.name.en}”?`)) return;
    try {
      await api(`/api/studio/blog/categories/${t.id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Topics"
        description="Topics group similar posts on the blog (e.g. “Google Reviews”, “Local SEO”). Each topic gets its own page."
        back={{ href: "/studio/blog", label: "All posts" }}
        actions={
          <Button variant="primary" icon="add" onClick={() => open("new")}>
            New topic
          </Button>
        }
      />
      {error && !editing && <Notice tone="error">{error}</Notice>}
      {topics === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface-container" />
      ) : topics.length === 0 ? (
        <EmptyState icon="label" title="No topics yet" text="Create 4–6 topics that match what your customers search for." action={<Button variant="primary" icon="add" onClick={() => open("new")}>Create a topic</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {topics.map((t) => (
            <Card key={t.id}>
              <p className="font-semibold text-on-surface">{t.name.en}</p>
              {t.name.hi && <p className="text-sm text-on-surface-variant">{t.name.hi}</p>}
              <p className="mt-1 text-xs text-outline">/blog/category/{t.slug} · {t.posts} post{t.posts === 1 ? "" : "s"}</p>
              {t.description.en && <p className="mt-2 text-sm text-on-surface-variant line-clamp-2">{t.description.en}</p>}
              <div className="mt-3 flex gap-2">
                {viewer.isSuperAdmin && (
                  <Button icon="edit" onClick={() => open(t)}>
                    Edit
                  </Button>
                )}
                {t.posts === 0 && (
                  <Button variant="danger" icon="delete" onClick={() => remove(t)}>
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {!viewer.isSuperAdmin && topics && topics.length > 0 && (
        <p className="mt-4 text-xs text-on-surface-variant">Topic names show on the website straight away, so only a Super Admin can rename them.</p>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New topic" : "Edit topic"}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save} disabled={!form.nameEn.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Name (English)" help={editing === "new" && form.nameEn ? `Web address: /blog/category/${slugify(form.nameEn) || "…"}` : undefined}>
            <TextInput value={form.nameEn} maxLength={80} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} placeholder="e.g. Google Reviews" />
          </Field>
          <Field label="Name (Hindi)" optional>
            <TextInput value={form.nameHi} maxLength={80} onChange={(e) => setForm({ ...form, nameHi: e.target.value })} placeholder="जैसे: Google रिव्यू" />
          </Field>
          <Field label="Short description (English)" optional help="Shown at the top of the topic page.">
            <TextArea value={form.descriptionEn} maxLength={300} rows={2} onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })} />
          </Field>
          <Field label="Short description (Hindi)" optional>
            <TextArea value={form.descriptionHi} maxLength={300} rows={2} onChange={(e) => setForm({ ...form, descriptionHi: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
