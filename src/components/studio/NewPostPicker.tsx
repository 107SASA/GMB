"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { Button, Notice, PageHeader, api } from "@/components/studio/ui";
import { BLOG_TEMPLATES } from "@/lib/blog/templates";
import type { BlogLanguage } from "@/lib/blog/shared";
import { cn } from "@/lib/utils";

/** Step 1 of a new post: choose the language and a template (or Custom). */
export function NewPostPicker() {
  const router = useRouter();
  const [lang, setLang] = useState<BlogLanguage>("en");
  const [picked, setPicked] = useState<string>("how_to");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await api<{ data: { id: string } }>("/api/studio/blog/posts", { method: "POST", json: { template: picked, language: lang } });
      router.push(`/studio/blog/${d.data.id}`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="pb-24 sm:pb-0">
      <PageHeader
        title="Write a new post"
        description="Pick the kind of article. Each template gives you a ready structure that Google likes — you just fill in your words."
        back={{ href: "/studio/blog", label: "All posts" }}
      />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-on-surface">Language</h2>
        <div className="grid max-w-md grid-cols-2 gap-2">
          {(["en", "hi"] as BlogLanguage[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={cn(
                "min-h-12 rounded-xl border-2 px-4 text-sm font-semibold",
                lang === l ? "border-primary bg-primary-fixed text-on-surface" : "border-outline-variant bg-surface-container-lowest"
              )}
            >
              {l === "en" ? "English" : "हिन्दी (Hindi)"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">Writing both? Start with one, then use “Write the Hindi/English version” inside the editor — they get linked automatically.</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-on-surface">Template</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {BLOG_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => setPicked(t.id)}
              className={cn(
                "flex flex-col rounded-2xl border-2 bg-surface-container-lowest p-4 text-left transition-colors",
                picked === t.id ? "border-primary ring-4 ring-primary/15" : "border-outline-variant hover:border-primary/50"
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", picked === t.id ? "bg-primary text-white" : "bg-primary-fixed text-primary")}>
                  <MaterialIcon name={t.icon} size={24} />
                </span>
                {picked === t.id && <MaterialIcon name="check_circle" size={24} className="text-primary" />}
              </div>
              <p className="mt-3 font-semibold text-on-surface">{lang === "hi" ? `${t.nameHi} · ${t.name}` : t.name}</p>
              <p className="mt-1 text-sm text-on-surface-variant">{t.description}</p>
              <p className="mt-3 text-xs text-outline">e.g. “{t.example}”</p>
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-outline-variant bg-surface-container-lowest/95 px-4 py-3 backdrop-blur sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0">
        <Button variant="primary" icon="arrow_forward" loading={busy} onClick={create} className="w-full sm:w-auto">
          Start writing
        </Button>
      </div>
    </div>
  );
}
