"use client";

import { useCallback, useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { ImagePicker } from "@/components/studio/ImagePicker";
import { FaqListEditor, type FaqItem } from "@/components/studio/FaqListEditor";
import { GooglePreview, SocialPreview } from "@/components/studio/Previews";
import { Badge, Button, Card, Field, LinkButton, Modal, Notice, PageHeader, TextArea, TextInput, Toggle, api, timeAgo } from "@/components/studio/ui";
import { LIMITS } from "@/lib/blog/shared";

interface Fields {
  seoTitle: string;
  seoDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  noindex: boolean;
  faqs: FaqItem[] | null;
}

interface PageState {
  page: {
    key: string;
    label: string;
    help: string;
    path: string;
    absoluteTitle: boolean;
    defaults: { seoTitle: string; seoDescription: string; ogTitle: string; ogDescription: string; faqs: FaqItem[] | null };
  };
  draft: Partial<Fields> | null;
  live: Partial<Fields> | null;
  status: "default" | "draft" | "in_review" | "changes_requested" | "published";
  reviewNote: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  liveUpdatedAt: string | null;
  canPublish?: boolean;
}

/** Fields the editor starts from: the saved draft, else what's live, else the built-in text. */
function initial(s: PageState): Fields {
  const src = s.draft || s.live || {};
  return {
    seoTitle: src.seoTitle || "",
    seoDescription: src.seoDescription || "",
    ogTitle: src.ogTitle || "",
    ogDescription: src.ogDescription || "",
    ogImageUrl: src.ogImageUrl || "",
    noindex: Boolean(src.noindex),
    faqs: s.page.defaults.faqs ? (src.faqs && src.faqs.length ? src.faqs : s.page.defaults.faqs) : null,
  };
}

export function PageEditor({ pageKey }: { pageKey: string }) {
  const [state, setState] = useState<PageState | null>(null);
  const [f, setF] = useState<Fields | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [modal, setModal] = useState<null | "changes" | "reset">(null);
  const [note, setNote] = useState("");

  const apply = (s: PageState) => {
    setState((prev) => ({ ...s, canPublish: s.canPublish ?? prev?.canPublish }));
    setF(initial(s));
    setDirty(false);
  };

  const load = useCallback(() => {
    api<{ data: PageState }>(`/api/studio/pages/${pageKey}`)
      .then((d) => apply(d.data))
      .catch((e) => setError(e.message));
  }, [pageKey]);
  useEffect(load, [load]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (error && !state) return <Notice tone="error" title="Could not open this page">{error}</Notice>;
  if (!state || !f) return <div className="h-96 animate-pulse rounded-2xl bg-surface-container" />;

  const d = state.page.defaults;
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setF({ ...f, [k]: v });
    setDirty(true);
    setOk("");
  };
  const locked = state.status === "in_review" && !state.canPublish;
  const title = f.seoTitle || d.seoTitle;
  const desc = f.seoDescription || d.seoDescription;
  const googleTitle = state.page.absoluteTitle ? title : `${title} | Growwmatics AI`;

  const done = (msg: string) => {
    setOk(msg);
    setTimeout(() => setOk(""), 5000);
  };

  const saveDraft = async (publish = false) => {
    setBusy(publish ? "publish" : "save");
    setError("");
    try {
      const r = await api<{ data: PageState }>(`/api/studio/pages/${pageKey}`, { method: "PUT", json: { ...f, faqs: f.faqs ?? undefined, publish } });
      apply(r.data);
      done(publish ? "Published — the website shows your changes now." : "Draft saved.");
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: string, extra: Record<string, unknown> = {}, msg = "") => {
    setBusy(action);
    setError("");
    try {
      if (dirty && ["submit", "approve"].includes(action) && !(await saveDraft(false))) return;
      const r = await api<{ data: PageState }>(`/api/studio/pages/${pageKey}`, { method: "POST", json: { action, ...extra } });
      apply(r.data);
      setModal(null);
      if (msg) done(msg);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const statusBadge =
    state.status === "in_review" ? (
      <Badge tone="amber" icon="hourglass_top">Waiting for approval</Badge>
    ) : state.status === "changes_requested" ? (
      <Badge tone="red" icon="assignment_return">Changes requested</Badge>
    ) : state.status === "draft" ? (
      <Badge icon="edit">Draft — not sent yet</Badge>
    ) : state.live ? (
      <Badge tone="green" icon="check">Live</Badge>
    ) : (
      <Badge>Original text</Badge>
    );

  const buttons = (
    <>
      <LinkButton href={state.page.path} external icon="open_in_new" variant="ghost" className="max-lg:hidden">
        View page
      </LinkButton>
      {state.status === "in_review" && state.canPublish && (
        <Button variant="warning" icon="undo" onClick={() => setModal("changes")} disabled={!!busy}>
          Request changes
        </Button>
      )}
      {state.status === "in_review" && !state.canPublish ? (
        <Button icon="undo" loading={busy === "withdraw"} onClick={() => act("withdraw", {}, "Withdrawn — you can edit again.")}>
          Withdraw to edit
        </Button>
      ) : state.canPublish ? (
        <>
          <Button icon="save" loading={busy === "save"} onClick={() => saveDraft(false)} disabled={!dirty}>
            Save draft
          </Button>
          <Button
            variant="primary"
            icon="rocket_launch"
            loading={busy === "publish" || busy === "approve"}
            onClick={() => (dirty ? saveDraft(true) : act("approve", {}, "Published — the website shows your changes now."))}
            disabled={!dirty && !state.draft}
          >
            {state.status === "in_review" ? "Approve & publish" : "Publish"}
          </Button>
        </>
      ) : (
        <>
          <Button icon="save" loading={busy === "save"} onClick={() => saveDraft(false)} disabled={!dirty}>
            Save draft
          </Button>
          <Button
            variant="primary"
            icon="send"
            loading={busy === "submit"}
            onClick={() => act("submit", {}, "Sent for approval. We'll email you when it's reviewed.")}
            disabled={!dirty && (state.status === "default" || state.status === "published")}
          >
            Submit for approval
          </Button>
        </>
      )}
    </>
  );

  return (
    <div className="pb-24 lg:pb-0">
      <PageHeader
        title={state.page.label}
        description={state.page.help}
        back={{ href: "/studio/pages", label: "All website pages" }}
        actions={
          <LinkButton href={state.page.path} external icon="open_in_new" variant="ghost" className="lg:hidden">
            View page
          </LinkButton>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {statusBadge}
          {dirty && <Badge tone="amber" icon="edit">Unsaved changes</Badge>}
          {state.liveUpdatedAt && <span className="text-xs text-on-surface-variant">Last published {timeAgo(state.liveUpdatedAt)}</span>}
        </div>
        <div className="hidden flex-wrap gap-2 lg:flex">{buttons}</div>
      </div>

      <div className="mb-4 space-y-3">
        {ok && <Notice tone="success">{ok}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {state.status === "changes_requested" && state.reviewNote && (
          <Notice tone="warn" title="Changes requested by the Super Admin">
            <p className="whitespace-pre-line">{state.reviewNote}</p>
          </Notice>
        )}
        {state.status === "in_review" && (
          <Notice tone="info">
            {state.canPublish
              ? `Submitted by ${state.submittedBy || "a team member"} ${timeAgo(state.submittedAt)}. Check the previews below, then approve or request changes.`
              : "A Super Admin is reviewing these changes. Click “Withdraw to edit” to change them again."}
          </Notice>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="Google search listing" icon="search" description="Leave a box empty to keep the original text (shown in grey).">
            <div className="space-y-4">
              <Field label="Title in Google" counter={{ length: title.length, ideal: LIMITS.seoTitle.ideal, max: LIMITS.seoTitle.max }}>
                <TextInput value={f.seoTitle} disabled={locked} maxLength={120} placeholder={d.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
              </Field>
              <Field label="Description in Google" counter={{ length: desc.length, ideal: LIMITS.seoDescription.ideal, max: LIMITS.seoDescription.max }} help="One or two sentences that make people want to click.">
                <TextArea value={f.seoDescription} disabled={locked} maxLength={320} rows={3} placeholder={d.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
              </Field>
              <GooglePreview title={googleTitle} description={desc} path={state.page.path} />
            </div>
          </Card>

          <Card title="Sharing on WhatsApp & social" icon="share" description="Optional. If empty, the Google title and description are used.">
            <div className="space-y-4">
              <Field label="Share title" optional>
                <TextInput value={f.ogTitle} disabled={locked} maxLength={120} placeholder={d.ogTitle || googleTitle} onChange={(e) => set("ogTitle", e.target.value)} />
              </Field>
              <Field label="Share description" optional>
                <TextArea value={f.ogDescription} disabled={locked} maxLength={320} rows={2} placeholder={d.ogDescription || desc} onChange={(e) => set("ogDescription", e.target.value)} />
              </Field>
              <ImagePicker
                value={f.ogImageUrl ? { url: f.ogImageUrl } : null}
                disabled={locked}
                withAlt={false}
                purpose="page"
                aspect="aspect-[1.91/1]"
                label="Share image (optional)"
                help="Best size 1200 × 630. Empty = the standard Growwmatics AI image."
                onChange={(v) => set("ogImageUrl", v?.url || "")}
              />
              <SocialPreview title={f.ogTitle || d.ogTitle || googleTitle} description={f.ogDescription || d.ogDescription || desc} image={f.ogImageUrl || undefined} path={state.page.path} />
            </div>
          </Card>

          <Card>
            <Toggle
              checked={f.noindex}
              disabled={locked}
              onChange={(v) => set("noindex", v)}
              label="Hide this page from Google"
              help="Careful: the page will disappear from Google search. Only use this for pages that should not be found."
            />
            {f.noindex && (
              <div className="mt-3">
                <Notice tone="warn">This page will be removed from Google after approval.</Notice>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {f.faqs ? (
            <Card
              title="Questions & answers"
              icon="quiz"
              description={
                pageKey === "faq"
                  ? "Extra questions shown on the FAQ page, after the Home page questions."
                  : "Shown on the page and in Google results. The order here is the order on the page."
              }
            >
              <FaqListEditor items={f.faqs} disabled={locked} onChange={(v) => set("faqs", v)} />
              <button
                type="button"
                disabled={locked}
                onClick={() => d.faqs && confirm("Put back the original questions? Your edits in this list will be lost.") && set("faqs", d.faqs)}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-on-surface-variant hover:text-primary disabled:opacity-40"
              >
                <MaterialIcon name="restart_alt" size={14} /> Use the original questions
              </button>
            </Card>
          ) : (
            <Card title="Page text" icon="article">
              <p className="text-sm text-on-surface-variant">
                This page has no questions & answers section. You can change how it appears in Google and when shared.
              </p>
            </Card>
          )}

          {(state.draft || state.live) && (
            <Card title="Undo" icon="history">
              <div className="flex flex-wrap gap-2">
                {state.draft && state.status !== "published" && state.status !== "in_review" && (
                  <Button icon="undo" onClick={() => act("discard", {}, "Draft thrown away.")} loading={busy === "discard"}>
                    Throw away draft
                  </Button>
                )}
                {state.canPublish && state.live && (
                  <Button variant="danger" icon="restart_alt" onClick={() => setModal("reset")}>
                    Reset page to original text
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-outline-variant bg-surface-container-lowest/95 px-4 py-3 backdrop-blur lg:hidden [&>button]:flex-1 [&>button]:px-2"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {buttons}
      </div>

      <Modal
        open={modal === "changes"}
        onClose={() => setModal(null)}
        title="Request changes"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="warning" icon="send" disabled={!note.trim()} loading={busy === "request_changes"} onClick={() => act("request_changes", { note }, "Sent back to the editor.")}>
              Send
            </Button>
          </>
        }
      >
        <Field label="What should be changed?">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} />
        </Field>
      </Modal>
      <Modal
        open={modal === "reset"}
        onClose={() => setModal(null)}
        title="Reset to the original text?"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Cancel</Button>
            <Button variant="danger" icon="restart_alt" loading={busy === "reset"} onClick={() => act("reset", {}, "Page reset to its original text.")}>
              Reset
            </Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">All edits to this page (live and draft) are removed and the website shows the original text again.</p>
      </Modal>
    </div>
  );
}
