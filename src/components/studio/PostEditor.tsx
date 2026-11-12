"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { RichEditor } from "@/components/studio/RichEditor";
import { ImagePicker } from "@/components/studio/ImagePicker";
import { FaqListEditor } from "@/components/studio/FaqListEditor";
import { GooglePreview, SocialPreview } from "@/components/studio/Previews";
import {
  Badge,
  Button,
  Card,
  Field,
  LinkButton,
  Modal,
  Notice,
  SaveIndicator,
  Select,
  TextArea,
  TextInput,
  Toggle,
  api,
  timeAgo,
} from "@/components/studio/ui";
import {
  LANGUAGE_LABEL,
  LIMITS,
  STATUS_LABEL,
  STATUS_TONE,
  blogPostPath,
  runSeoChecks,
  seoScore,
  slugify,
  type BlogLanguage,
} from "@/lib/blog/shared";
import { CTA_OPTIONS, LAYOUT_OPTIONS, getTemplate } from "@/lib/blog/templates";
import { cn } from "@/lib/utils";

type Panel = "write" | "details" | "seo" | "design" | "history";

interface PostData {
  id: string;
  language: BlogLanguage;
  template: string;
  status: keyof typeof STATUS_LABEL;
  liveState: "none" | "scheduled" | "live" | "archived";
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  coverImage: { url: string; alt?: string; width?: number; height?: number } | null;
  categoryId: string | null;
  tags: string[];
  seo: { title?: string; description?: string; focusKeyword?: string; ogImageUrl?: string; noindex?: boolean };
  faqs: { question: string; answer: string }[];
  design: { layout: "standard" | "wide" | "minimal"; showToc: boolean; cta: { type: string; heading?: string; text?: string; buttonLabel?: string; buttonUrl?: string } };
  live: { slug: string; title: string; publishedAt: string; updatedAt: string } | null;
  firstPublishedAt: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  submittedBy?: string | null;
  updatedBy?: string | null;
  editVersion: number;
  updatedAt: string;
  canEdit: boolean;
  canPublish: boolean;
  translation: { id: string; title: string; language: BlogLanguage; status: string } | null;
}

const EDITABLE: (keyof PostData)[] = ["title", "slug", "excerpt", "contentHtml", "coverImage", "categoryId", "tags", "seo", "faqs", "design"];

interface Category {
  id: string;
  slug: string;
  name: { en: string; hi?: string };
}

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 80 ? "#16a34a" : score >= 50 ? "#f59e0b" : "#dc2626";
  return (
    <div
      className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${tone} ${score * 3.6}deg, #e5e7eb 0deg)` }}
      aria-label={`SEO score ${score} out of 100`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-lowest text-sm font-bold text-on-surface">{score}</div>
    </div>
  );
}

export function PostEditor({ id }: { id: string }) {
  const router = useRouter();
  const [post, setPost] = useState<PostData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [panel, setPanel] = useState<Panel>("write");
  const [side, setSide] = useState<Exclude<Panel, "write">>("details");
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error" | "dirty">("idle");
  const [saveError, setSaveError] = useState("");
  const [stale, setStale] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [otherLangPosts, setOtherLangPosts] = useState<{ id: string; title: string }[]>([]);
  const [revisions, setRevisions] = useState<{ id: string; reason: string; createdAt: string; by: string; title: string; words: number }[] | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [modal, setModal] = useState<null | "publish" | "changes" | "takedown" | "delete" | "discard">(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [publishAt, setPublishAt] = useState("");
  const [note, setNote] = useState("");

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const dirtyKeys = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postRef = useRef<PostData | null>(null);
  postRef.current = post;
  const saving = useRef<Promise<boolean> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ data: PostData }>(`/api/studio/blog/posts/${id}`);
      setPost(d.data);
      setSlugTouched(Boolean(d.data.slug));
      setStale(false);
      dirtyKeys.current.clear();
      setSave("idle");
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
    api<{ data: Category[] }>("/api/studio/blog/categories").then((d) => setCategories(d.data)).catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!post) return;
    const other = post.language === "en" ? "hi" : "en";
    api<{ data: { id: string; title: string }[] }>(`/api/studio/blog/posts?lang=${other}`)
      .then((d) => setOtherLangPosts(d.data.map((p) => ({ id: p.id, title: p.title }))))
      .catch(() => {});
  }, [post?.language]);

  // Grow the title box to fit the whole title (on load, on typing, on resize).
  useEffect(() => {
    const fit = () => {
      const t = titleRef.current;
      if (!t) return;
      t.style.height = "auto";
      t.style.height = `${t.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [post?.title, panel]);

  // ---------- saving ----------
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) await saving.current;
    const p = postRef.current;
    if (!p || dirtyKeys.current.size === 0) return true;
    const keys = [...dirtyKeys.current];
    dirtyKeys.current.clear();
    const body: Record<string, unknown> = { editVersion: p.editVersion };
    for (const k of keys) body[k] = (p as any)[k];
    setSave("saving");
    const run = (async () => {
      try {
        const d = await api<{ data: PostData }>(`/api/studio/blog/posts/${p.id}`, { method: "PATCH", json: body });
        setPost((cur) =>
          cur
            ? {
                ...cur,
                editVersion: d.data.editVersion,
                status: d.data.status,
                liveState: d.data.liveState,
                updatedAt: d.data.updatedAt,
                canEdit: d.data.canEdit,
                // The server cleans the HTML; keep the writer's copy unless they stopped typing.
                ...(dirtyKeys.current.has("slug") ? {} : { slug: d.data.slug }),
              }
            : cur
        );
        setSave(dirtyKeys.current.size ? "dirty" : "saved");
        setSaveError("");
        return true;
      } catch (e: any) {
        keys.forEach((k) => dirtyKeys.current.add(k));
        setSave("error");
        setSaveError(e.message);
        if (e.code === "STALE") setStale(true);
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }, []);

  const update = useCallback(
    <K extends keyof PostData>(key: K, value: PostData[K]) => {
      setPost((cur) => (cur ? { ...cur, [key]: value } : cur));
      dirtyKeys.current.add(key as string);
      setSave("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), 2500);
    },
    [flush]
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyKeys.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Auto web address from the title until the writer edits it (English posts only, never after publishing).
  const onTitle = (v: string) => {
    update("title", v);
    if (post && !slugTouched && !post.live && post.language === "en") {
      const s = slugify(v);
      if (s) update("slug", s);
    }
  };

  // ---------- actions ----------
  const act = async (action: string, extra: Record<string, unknown> = {}, okMsg?: string) => {
    setActionError("");
    setActionBusy(action);
    try {
      if (!(await flush())) throw new Error("Your latest changes could not be saved. Fix the problem shown above, then try again.");
      await api(`/api/studio/blog/posts/${id}/action`, { method: "POST", json: { action, ...extra } });
      setModal(null);
      await load();
      if (okMsg) {
        setToast(okMsg);
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setActionBusy(null);
    }
  };

  const loadRevisions = useCallback(async () => {
    try {
      const d = await api<{ data: any[] }>(`/api/studio/blog/posts/${id}/revisions`);
      setRevisions(d.data);
    } catch {
      setRevisions([]);
    }
  }, [id]);

  useEffect(() => {
    if ((side === "history" || panel === "history") && revisions === null) loadRevisions();
  }, [side, panel, revisions, loadRevisions]);

  const restoreVersion = async (revisionId: string) => {
    if (!confirm("Copy this older version into the editor? Your current text will be replaced (you can restore it again from History).")) return;
    setActionBusy("restore_version");
    try {
      if (!(await flush())) throw new Error("Save your current changes first.");
      await api(`/api/studio/blog/posts/${id}/revisions`, { method: "POST", json: { revisionId } });
      await load();
      await loadRevisions();
      setToast("Older version restored into the editor.");
      setTimeout(() => setToast(""), 4000);
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setActionBusy(null);
    }
  };

  const createTranslation = async () => {
    if (!post) return;
    setActionBusy("translate");
    try {
      await flush();
      const lang = post.language === "en" ? "hi" : "en";
      const d = await api<{ data: { id: string } }>("/api/studio/blog/posts", {
        method: "POST",
        json: { template: post.template, language: lang, translationOf: post.id },
      });
      router.push(`/studio/blog/${d.data.id}`);
    } catch (e: any) {
      setActionError(e.message);
      setActionBusy(null);
    }
  };

  // Link / unlink the other-language version: save straight away, then reload to show it.
  const linkTranslation = async (translationOf: string) => {
    setActionBusy("link");
    setActionError("");
    try {
      if (!(await flush())) throw new Error("Save your current changes first.");
      const p = postRef.current!;
      await api(`/api/studio/blog/posts/${p.id}`, { method: "PATCH", json: { editVersion: p.editVersion, translationOf } });
      await load();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setActionBusy(null);
    }
  };

  const deletePost = async () => {
    setActionBusy("delete");
    try {
      await api(`/api/studio/blog/posts/${id}`, { method: "DELETE" });
      dirtyKeys.current.clear();
      router.push("/studio/blog");
    } catch (e: any) {
      setActionError(e.message);
      setActionBusy(null);
    }
  };

  const checks = useMemo(
    () => (post ? runSeoChecks({ ...post, coverImage: post.coverImage, seo: post.seo, language: post.language }) : []),
    [post]
  );
  const score = seoScore(checks);
  const blocking = checks.filter((c) => c.blocking && c.status === "bad");

  if (loadError) return <Notice tone="error" title="Could not open this post">{loadError}</Notice>;
  if (!post) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-surface-container" />
        <div className="h-[520px] animate-pulse rounded-2xl bg-surface-container" />
      </div>
    );
  }

  const locked = !post.canEdit;
  const cat = categories.find((c) => c.id === post.categoryId);
  const publicPath = blogPostPath(post.language, post.live?.slug || post.slug || "your-post");
  const liveUrl = post.live && post.liveState === "live" ? blogPostPath(post.language, post.live.slug) : null;
  const tpl = getTemplate(post.template);
  const isTeam = !post.canPublish;

  // ---------- primary actions ----------
  const primary = (() => {
    if (post.status === "in_review") {
      return post.canPublish ? (
        <>
          <Button variant="warning" icon="undo" onClick={() => setModal("changes")} disabled={!!actionBusy}>
            Request changes
          </Button>
          <Button variant="primary" icon="rocket_launch" onClick={() => setModal("publish")} disabled={!!actionBusy}>
            Approve & publish
          </Button>
        </>
      ) : (
        <Button icon="undo" loading={actionBusy === "withdraw"} onClick={() => act("withdraw", {}, "Withdrawn — you can edit again.")}>
          Withdraw to edit
        </Button>
      );
    }
    if (post.status === "archived") {
      return post.canPublish ? (
        <Button variant="primary" icon="restore" loading={actionBusy === "restore"} onClick={() => act("restore", {}, "The post is back on the website.")}>
          Put back on website
        </Button>
      ) : null;
    }
    const hasChanges = post.status === "draft" || post.status === "changes_requested";
    if (!hasChanges) return null;
    return post.canPublish ? (
      <Button variant="primary" icon="rocket_launch" onClick={() => setModal("publish")} disabled={!!actionBusy}>
        {post.live ? "Publish changes" : "Publish"}
      </Button>
    ) : (
      <Button
        variant="primary"
        icon="send"
        loading={actionBusy === "submit"}
        onClick={() => act("submit", {}, "Sent for approval. We'll email you when it's reviewed.")}
        disabled={blocking.length > 0}
        title={blocking.length ? "Finish the red items in “Google & SEO” first" : undefined}
      >
        Submit for approval
      </Button>
    );
  })();

  // ---------- panels ----------
  const detailsPanel = (
    <div className="space-y-5">
      <Card title="Basics" icon="tune">
        <div className="space-y-4">
          <Field label="Language" help={post.live || post.firstPublishedAt ? "The language can't be changed after publishing." : undefined}>
            <Select value={post.language} disabled={locked || Boolean(post.live || post.firstPublishedAt)} onChange={(e) => update("language", e.target.value as BlogLanguage)}>
              <option value="en">{LANGUAGE_LABEL.en}</option>
              <option value="hi">{LANGUAGE_LABEL.hi}</option>
            </Select>
          </Field>
          <Field
            label="Web address"
            help={
              post.language === "hi"
                ? "Use English words with dashes (e.g. google-reviews-kaise-badhaye). Hindi letters make very long links."
                : post.live
                  ? "Changing it after publishing is OK — the old link will automatically forward to the new one."
                  : "Filled in from the title. Short English words with dashes."
            }
          >
            <div className="flex items-stretch overflow-hidden rounded-xl border border-outline-variant focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
              <span className="hidden items-center bg-surface-container px-3 text-xs text-on-surface-variant sm:flex">
                {post.language === "hi" ? "/hi/blog/" : "/blog/"}
              </span>
              <input
                value={post.slug}
                disabled={locked}
                onChange={(e) => {
                  setSlugTouched(true);
                  update("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-{2,}/g, "-"));
                }}
                onBlur={() => update("slug", slugify(post.slug))}
                className="min-h-11 w-full min-w-0 bg-surface-container-lowest px-3 text-[16px] focus:outline-none sm:text-sm"
                placeholder="how-to-get-more-google-reviews"
              />
            </div>
          </Field>
          <Field label="Topic" help="Groups the post with similar ones on the blog." optional>
            <div className="flex gap-2">
              <Select value={post.categoryId || ""} disabled={locked} onChange={(e) => update("categoryId", e.target.value || null)}>
                <option value="">No topic</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {post.language === "hi" && c.name.hi ? `${c.name.hi} (${c.name.en})` : c.name.en}
                  </option>
                ))}
              </Select>
              <LinkButton href="/studio/blog/topics" icon="settings" className="shrink-0">
                <span className="sr-only sm:not-sr-only">Topics</span>
              </LinkButton>
            </div>
            {cat && <p className="mt-1 text-xs text-on-surface-variant">Shown at /{post.language === "hi" ? "hi/" : ""}blog/category/{cat.slug}</p>}
          </Field>
          <Field label="Tags" help="Short keywords, press Enter after each one. Up to 12." optional>
            <div className="flex flex-wrap gap-1.5">
              {post.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-1 text-xs font-medium">
                  {t}
                  {!locked && (
                    <button type="button" onClick={() => update("tags", post.tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="text-on-surface-variant hover:text-error">
                      <MaterialIcon name="close" size={14} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {post.tags.length < 12 && (
              <TextInput
                value={tagDraft}
                disabled={locked}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    const v = tagDraft.trim().replace(/,$/, "");
                    if (v && !post.tags.includes(v)) update("tags", [...post.tags, v.slice(0, 40)]);
                    setTagDraft("");
                  }
                }}
                placeholder="e.g. google reviews"
                className="mt-2"
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title="Cover image" icon="image" description="Shown at the top of the post and on the blog list.">
        <ImagePicker value={post.coverImage} disabled={locked} label="Cover image" onChange={(v) => update("coverImage", v as PostData["coverImage"])} />
      </Card>

      <Card title={post.language === "en" ? "Hindi version" : "English version"} icon="translate" description="Link the same article in the other language. Google then shows each reader the right one.">
        {post.translation ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{post.translation.title}</p>
                <p className="text-xs text-on-surface-variant">{LANGUAGE_LABEL[post.translation.language]} · {STATUS_LABEL[post.translation.status as keyof typeof STATUS_LABEL] || post.translation.status}</p>
              </div>
              <LinkButton href={`/studio/blog/${post.translation.id}`} icon="open_in_new" className="shrink-0">
                Open
              </LinkButton>
            </div>
            {!locked && (
              <Button variant="ghost" icon="link_off" loading={actionBusy === "link"} onClick={() => linkTranslation("")}>
                Unlink
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Button icon="add" onClick={createTranslation} loading={actionBusy === "translate"} disabled={locked}>
              Write the {post.language === "en" ? "Hindi" : "English"} version
            </Button>
            {otherLangPosts.length > 0 && (
              <Field label="…or link an existing post" optional>
                <Select value="" disabled={locked || actionBusy === "link"} onChange={(e) => e.target.value && linkTranslation(e.target.value)}>
                  <option value="">Choose a post</option>
                  {otherLangPosts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
      </Card>
    </div>
  );

  const seoTitle = post.seo.title || post.title;
  const seoDesc = post.seo.description || post.excerpt;
  const seoPanel = (
    <div className="space-y-5">
      <Card>
        <div className="flex items-center gap-4">
          <ScoreRing score={score} />
          <div>
            <p className="font-semibold text-on-surface">SEO score</p>
            <p className="text-sm text-on-surface-variant">
              {score >= 80 ? "Great — this post is well set up for Google." : score >= 50 ? "Good start. Fix the amber items to rank better." : "Fix the red items below before submitting."}
            </p>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {checks.map((c) => (
            <li key={c.id} className="flex gap-2.5 text-sm">
              <MaterialIcon
                name={c.status === "good" ? "check_circle" : c.status === "warn" ? "error" : "cancel"}
                size={20}
                className={cn("mt-0.5 shrink-0", c.status === "good" ? "text-[#16a34a]" : c.status === "warn" ? "text-[#f59e0b]" : "text-[#dc2626]")}
              />
              <div>
                <p className="font-medium text-on-surface">
                  {c.label}
                  {c.blocking && c.status === "bad" && <span className="ml-1 text-xs font-semibold text-error">(required)</span>}
                </p>
                {c.status !== "good" && <p className="text-xs text-on-surface-variant">{c.hint}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Google search listing" icon="search" description="What people see in Google before they click. Leave empty to use the post title and summary.">
        <div className="space-y-4">
          <Field label="Main keyword" help="The search phrase you want this post to be found for, e.g. “google reviews for restaurants”." optional>
            <TextInput value={post.seo.focusKeyword || ""} disabled={locked} maxLength={100} onChange={(e) => update("seo", { ...post.seo, focusKeyword: e.target.value })} />
          </Field>
          <Field label="Title in Google" counter={{ length: seoTitle.length, ideal: LIMITS.seoTitle.ideal, max: LIMITS.seoTitle.max }} optional>
            <TextInput value={post.seo.title || ""} disabled={locked} maxLength={120} placeholder={post.title} onChange={(e) => update("seo", { ...post.seo, title: e.target.value })} />
          </Field>
          <Field label="Description in Google" counter={{ length: seoDesc.length, ideal: LIMITS.seoDescription.ideal, max: LIMITS.seoDescription.max }} optional>
            <TextArea value={post.seo.description || ""} disabled={locked} maxLength={320} rows={3} placeholder={post.excerpt} onChange={(e) => update("seo", { ...post.seo, description: e.target.value })} />
          </Field>
          <GooglePreview title={`${seoTitle} | Growwmatics AI`} description={seoDesc} path={publicPath} />
        </div>
      </Card>

      <Card title="Sharing on WhatsApp & social" icon="share" description="The picture shown when someone shares this post. Leave empty to use the cover image.">
        <div className="space-y-4">
          <ImagePicker
            value={post.seo.ogImageUrl ? { url: post.seo.ogImageUrl } : null}
            disabled={locked}
            withAlt={false}
            aspect="aspect-[1.91/1]"
            label="Share image (optional)"
            help="Best size: 1200 × 630."
            onChange={(v) => update("seo", { ...post.seo, ogImageUrl: v?.url || "" })}
          />
          <SocialPreview title={seoTitle} description={seoDesc} image={post.seo.ogImageUrl || post.coverImage?.url} path={publicPath} />
        </div>
      </Card>

      <Card>
        <Toggle
          checked={Boolean(post.seo.noindex)}
          disabled={locked}
          onChange={(v) => update("seo", { ...post.seo, noindex: v })}
          label="Hide this post from Google"
          help="Only for special cases (e.g. a post just for customers). The post is still visible on the website."
        />
      </Card>
    </div>
  );

  const cta = post.design.cta;
  const designPanel = (
    <div className="space-y-5">
      <Card title="Page layout" icon="dashboard_customize">
        <div className="grid gap-2">
          {LAYOUT_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={locked}
              onClick={() => update("design", { ...post.design, layout: o.id })}
              className={cn(
                "flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-60",
                post.design.layout === o.id ? "border-primary bg-primary-fixed" : "border-outline-variant hover:border-primary/50"
              )}
            >
              <MaterialIcon name={o.icon} size={24} className="mt-0.5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold text-on-surface">{o.name}</span>
                <span className="block text-xs text-on-surface-variant">{o.description}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Toggle
            checked={post.design.showToc}
            disabled={locked}
            onChange={(v) => update("design", { ...post.design, showToc: v })}
            label="Show “On this page” list"
            help="A clickable list of your headings. Needs at least 2 headings."
          />
        </div>
      </Card>

      <Card title="Call-to-action at the end" icon="ads_click" description="What should the reader do after reading?">
        <div className="grid gap-2">
          {CTA_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={locked}
              onClick={() => update("design", { ...post.design, cta: { ...cta, type: o.id } })}
              className={cn(
                "rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-60",
                cta.type === o.id ? "border-primary bg-primary-fixed" : "border-outline-variant hover:border-primary/50"
              )}
            >
              <span className="block text-sm font-semibold text-on-surface">{o.name}</span>
              <span className="block text-xs text-on-surface-variant">{o.description}</span>
            </button>
          ))}
        </div>
        {cta.type === "custom" && (
          <div className="mt-4 space-y-3">
            <Field label="Heading">
              <TextInput value={cta.heading || ""} disabled={locked} maxLength={120} onChange={(e) => update("design", { ...post.design, cta: { ...cta, heading: e.target.value } })} />
            </Field>
            <Field label="Text" optional>
              <TextArea value={cta.text || ""} disabled={locked} maxLength={300} rows={2} onChange={(e) => update("design", { ...post.design, cta: { ...cta, text: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Button text">
                <TextInput value={cta.buttonLabel || ""} disabled={locked} maxLength={40} onChange={(e) => update("design", { ...post.design, cta: { ...cta, buttonLabel: e.target.value } })} />
              </Field>
              <Field label="Button link" help="e.g. /pricing or https://…">
                <TextInput value={cta.buttonUrl || ""} disabled={locked} maxLength={500} onChange={(e) => update("design", { ...post.design, cta: { ...cta, buttonUrl: e.target.value } })} />
              </Field>
            </div>
            {!(cta.heading && cta.buttonLabel && cta.buttonUrl) && (
              <p className="text-xs text-[#b45309]">Fill heading, button text and link — otherwise nothing is shown.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );

  const historyPanel = (
    <div className="space-y-5">
      <Card title="Version history" icon="history" description="A copy is saved every time the post is submitted or published. Restoring copies it into the editor — the website only changes after approval.">
        {revisions === null ? (
          <p className="text-sm text-on-surface-variant">Loading…</p>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No saved versions yet.</p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {revisions.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {r.reason === "published" ? "Published" : r.reason === "submitted" ? "Submitted" : "Restored"} · {timeAgo(r.createdAt)}
                  </p>
                  <p className="truncate text-xs text-on-surface-variant">
                    {r.by} · {r.words} words · {r.title}
                  </p>
                </div>
                {!locked && (
                  <Button variant="ghost" icon="restore" onClick={() => restoreVersion(r.id)} disabled={!!actionBusy} className="shrink-0">
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {post.live && post.status !== "archived" && post.status !== "published" && post.status !== "scheduled" && (
        <Card title="Unpublished changes" icon="undo">
          <p className="mb-3 text-sm text-on-surface-variant">Throw away your edits and go back to the version that is on the website now.</p>
          <Button variant="danger" icon="undo" onClick={() => setModal("discard")} disabled={locked}>
            Discard my changes
          </Button>
        </Card>
      )}

      <Card title="Danger zone" icon="warning">
        <div className="flex flex-wrap gap-2">
          {post.canPublish && post.live && post.status !== "archived" && (
            <Button variant="danger" icon="visibility_off" onClick={() => setModal("takedown")}>
              Take off website
            </Button>
          )}
          {(post.canPublish || !(post.live || post.firstPublishedAt)) && (
            <Button variant="danger" icon="delete" onClick={() => setModal("delete")}>
              Delete post
            </Button>
          )}
        </div>
        {isTeam && (post.live || post.firstPublishedAt) && <p className="mt-2 text-xs text-on-surface-variant">Only a Super Admin can delete a post that has been published.</p>}
      </Card>
    </div>
  );

  const sidePanels = { details: detailsPanel, seo: seoPanel, design: designPanel, history: historyPanel };
  const TABS: { id: Panel; label: string; icon: string }[] = [
    { id: "write", label: "Write", icon: "edit" },
    { id: "details", label: "Details", icon: "tune" },
    { id: "seo", label: "Google & SEO", icon: "travel_explore" },
    { id: "design", label: "Design", icon: "palette" },
    { id: "history", label: "History", icon: "history" },
  ];

  const writePanel = (
    <div className="space-y-5">
      <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 sm:p-6">
        <label htmlFor="post-title" className="sr-only">
          Post title
        </label>
        <textarea
          id="post-title"
          ref={titleRef}
          value={post.title}
          disabled={locked}
          rows={1}
          maxLength={200}
          onChange={(e) => onTitle(e.target.value.replace(/\n/g, " "))}
          placeholder={post.language === "hi" ? "लेख का शीर्षक लिखें" : `Post title — e.g. “${tpl.example}”`}
          className="w-full resize-none overflow-hidden bg-transparent font-heading text-2xl font-bold leading-tight text-on-surface placeholder:text-outline focus:outline-none sm:text-3xl"
        />
        <div className="mt-4 border-t border-outline-variant pt-4">
          <Field label="Short summary" counter={{ length: post.excerpt.length, ideal: LIMITS.excerpt.ideal, max: LIMITS.excerpt.max }} help="1–2 sentences shown under the title, on the blog list and in Google.">
            <TextArea value={post.excerpt} disabled={locked} rows={2} maxLength={400} onChange={(e) => update("excerpt", e.target.value)} placeholder="What will the reader learn?" />
          </Field>
        </div>
      </div>

      {tpl.id !== "custom" && post.contentHtml.includes("<em>[") && (
        <Notice tone="info" title={`Template: ${tpl.name}`}>
          Replace the grey text in [brackets] with your own words. Keep the headings — they are what Google uses to understand the article.
        </Notice>
      )}

      <RichEditor value={post.contentHtml} onChange={(html) => update("contentHtml", html)} disabled={locked} />

      <Card title="Questions & answers (optional)" icon="quiz" description="Shown at the end of the post. Google can show these right in the search results.">
        <FaqListEditor items={post.faqs} disabled={locked} max={20} onChange={(v) => update("faqs", v)} />
      </Card>
    </div>
  );

  return (
    <div className="pb-24 lg:pb-0">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link href="/studio/blog" className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-on-surface-variant hover:text-primary">
            <MaterialIcon name="arrow_back" size={16} /> All posts
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Badge>
            {post.liveState === "live" && post.status !== "published" && <Badge tone="green" icon="public">Live version on website</Badge>}
            {post.liveState === "scheduled" && post.live && (
              <Badge tone="blue" icon="schedule">
                Goes live {new Date(post.live.publishedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </Badge>
            )}
            <Badge>{LANGUAGE_LABEL[post.language]}</Badge>
            <SaveIndicator state={save} />
          </div>
        </div>
        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          {liveUrl && (
            <LinkButton href={liveUrl} external icon="public" variant="ghost">
              View live
            </LinkButton>
          )}
          <LinkButton href={`/studio/preview/blog/${post.id}`} external icon="visibility">
            Preview
          </LinkButton>
          {primary}
        </div>
      </div>

      {/* Banners */}
      <div className="mb-4 space-y-3">
        {toast && <Notice tone="success">{toast}</Notice>}
        {stale && (
          <Notice tone="error" title="Someone else changed this post">
            To avoid overwriting their work, reload to get the latest version.{" "}
            <button onClick={load} className="font-semibold underline">
              Reload now
            </button>
          </Notice>
        )}
        {!stale && saveError && <Notice tone="error" title="Your last change was not saved">{saveError}</Notice>}
        {actionError && <Notice tone="error">{actionError}</Notice>}
        {post.status === "changes_requested" && post.reviewNote && (
          <Notice tone="warn" title="Changes requested by the Super Admin">
            <p className="whitespace-pre-line">{post.reviewNote}</p>
            <p className="mt-1 text-xs">Make the changes, then click “Submit for approval” again.</p>
          </Notice>
        )}
        {post.status === "in_review" && (
          <Notice tone="info" title={post.canPublish ? "Waiting for your approval" : "Waiting for approval"}>
            {post.canPublish
              ? `Submitted by ${post.submittedBy || "a team member"} ${timeAgo(post.submittedAt)}. Check the Preview, then approve or request changes.`
              : "A Super Admin is reviewing this post. You'll get an email when it's approved or if changes are needed. To edit it now, click “Withdraw to edit”."}
          </Notice>
        )}
        {post.status === "archived" && <Notice tone="warn" title="Taken off the website">This post is not visible on the website.</Notice>}
        {post.live && ["draft", "changes_requested"].includes(post.status) && post.liveState === "live" && (
          <Notice tone="info">
            The website still shows the last approved version. Your edits go live after {post.canPublish ? "you publish them" : "approval"}.
          </Notice>
        )}
      </div>

      {/* Mobile / tablet tabs */}
      <div className="sticky top-[69px] z-30 -mx-4 mb-4 overflow-x-auto border-b border-outline-variant bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex gap-1 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                if (timer.current) flush();
                setPanel(t.id);
              }}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold",
                panel === t.id ? "bg-primary text-white" : "text-on-surface-variant hover:bg-surface-container"
              )}
            >
              <MaterialIcon name={t.icon} size={16} />
              {t.label}
              {t.id === "seo" && <span className={cn("rounded-full px-1.5 text-[11px]", panel === "seo" ? "bg-white/25" : "bg-surface-container")}>{score}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className={cn(panel === "write" ? "block" : "hidden", "lg:block")}>{writePanel}</div>

        <div className={cn(panel === "write" ? "hidden" : "block", "lg:block")}>
          <div className="lg:sticky lg:top-6">
            <div className="mb-4 hidden gap-1 rounded-2xl border border-outline-variant bg-surface-container-lowest p-1 lg:flex">
              {TABS.filter((t) => t.id !== "write").map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSide(t.id as Exclude<Panel, "write">)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold",
                    side === t.id ? "bg-primary text-white" : "text-on-surface-variant hover:bg-surface-container"
                  )}
                >
                  <MaterialIcon name={t.icon} size={16} />
                  {t.id === "seo" ? "SEO" : t.label}
                  {t.id === "seo" && <span className={cn("rounded-full px-1.5", side === "seo" ? "bg-white/25" : "bg-surface-container")}>{score}</span>}
                </button>
              ))}
            </div>
            <div className="lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-1 custom-scrollbar">
              <div className="hidden lg:block">{sidePanels[side]}</div>
              <div className="lg:hidden">{panel !== "write" && sidePanels[panel as Exclude<Panel, "write">]}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-outline-variant bg-surface-container-lowest/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <LinkButton href={`/studio/preview/blog/${post.id}`} external icon="visibility" className="shrink-0">
          <span className="sr-only">Preview</span>
        </LinkButton>
        <div className="flex flex-1 justify-end gap-2 [&>button]:flex-1">{primary}</div>
      </div>

      {/* Modals */}
      <Modal
        open={modal === "publish"}
        onClose={() => setModal(null)}
        title={post.live ? "Publish changes" : "Publish this post"}
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon="rocket_launch"
              loading={actionBusy === "approve"}
              disabled={when === "later" && !publishAt}
              onClick={() =>
                act(
                  "approve",
                  when === "later" && publishAt ? { publishAt: new Date(publishAt).toISOString() } : {},
                  when === "later" ? "Approved and scheduled." : "Published — it's on the website now."
                )
              }
            >
              {when === "later" ? "Schedule" : "Publish now"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {blocking.length > 0 && (
            <Notice tone="error" title="Fix these first">
              <ul className="list-disc pl-4">
                {blocking.map((b) => (
                  <li key={b.id}>{b.hint}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="grid gap-2">
            {[
              { id: "now" as const, title: "Publish now", text: "The post appears on the website straight away." },
              {
                id: "later" as const,
                title: "Schedule for later",
                text: post.liveState === "live" ? "Not available: this post is already live, so updates publish immediately." : "Pick a date and time (India time).",
              },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={o.id === "later" && post.liveState === "live"}
                onClick={() => setWhen(o.id)}
                className={cn(
                  "rounded-xl border-2 p-3 text-left disabled:opacity-50",
                  when === o.id ? "border-primary bg-primary-fixed" : "border-outline-variant"
                )}
              >
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-on-surface-variant">{o.text}</span>
              </button>
            ))}
          </div>
          {when === "later" && (
            <Field label="Date and time">
              <TextInput type="datetime-local" value={publishAt} min={new Date(Date.now() + 5 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(e) => setPublishAt(e.target.value)} />
            </Field>
          )}
          <p className="text-xs text-on-surface-variant">
            Web address: <b>growwmatics.com{blogPostPath(post.language, post.slug || "…")}</b>
          </p>
        </div>
      </Modal>

      <Modal
        open={modal === "changes"}
        onClose={() => setModal(null)}
        title="Request changes"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="warning" icon="send" loading={actionBusy === "request_changes"} disabled={!note.trim()} onClick={() => act("request_changes", { note }, "Sent back to the writer.")}>
              Send to writer
            </Button>
          </>
        }
      >
        <Field label="What should be changed?" help="The writer sees this note in the editor and by email.">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={2000} placeholder="e.g. Please add a section about pricing and use a brighter cover photo." />
        </Field>
      </Modal>

      <Modal
        open={modal === "takedown"}
        onClose={() => setModal(null)}
        title="Take this post off the website?"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="danger" icon="visibility_off" loading={actionBusy === "take_down"} onClick={() => act("take_down", {}, "The post was taken off the website.")}>
              Take it down
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">The post disappears from the blog and Google will drop it over time. You can put it back later.</p>
      </Modal>

      <Modal
        open={modal === "discard"}
        onClose={() => setModal(null)}
        title="Discard your changes?"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Keep editing</Button>
            <Button variant="danger" icon="undo" loading={actionBusy === "discard"} onClick={() => act("discard", {}, "Changes discarded.")}>
              Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">The editor goes back to the version that is on the website now.</p>
      </Modal>

      <Modal
        open={modal === "delete"}
        onClose={() => setModal(null)}
        title="Delete this post?"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="danger" icon="delete" loading={actionBusy === "delete"} onClick={deletePost}>
              Delete forever
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">
          This can't be undone.{post.live ? " The post is also removed from the website." : ""}
        </p>
      </Modal>
    </div>
  );
}
