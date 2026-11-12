"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Youtube from "@tiptap/extension-youtube";
import { Placeholder } from "@tiptap/extensions";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { uploadStudioImage } from "@/components/studio/imageUpload";
import { Button, Field, Modal, TextInput, Notice } from "@/components/studio/ui";
import { cn } from "@/lib/utils";

/**
 * The article editor (Tiptap). Output is plain HTML that the server cleans
 * again (lib/blog/sanitize.ts) — so the toolbar only offers what the public
 * article supports: headings, lists, links, images, tables, quotes, YouTube.
 */

function ToolBtn({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg px-2 transition-colors disabled:opacity-40",
        active ? "bg-primary text-white" : "text-on-surface hover:bg-surface-container"
      )}
    >
      <MaterialIcon name={icon} size={20} />
    </button>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px shrink-0 bg-outline-variant" aria-hidden />;

function Toolbar({ editor, onLink, onImage, onVideo, disabled }: { editor: Editor; onLink: () => void; onImage: () => void; onVideo: () => void; disabled?: boolean }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const blockValue = s.h2 ? "h2" : s.h3 ? "h3" : "p";

  // Below the Studio top bar (69px) + the editor's tab bar (57px) on phones; top of the page on desktop.
  return (
    <div className="sticky top-[126px] z-20 rounded-t-2xl border-b border-outline-variant bg-surface-container-lowest/95 backdrop-blur lg:top-0">
      <div className="flex items-center gap-0.5 overflow-x-auto px-2 py-1.5">
        <select
          aria-label="Text style"
          disabled={disabled}
          value={blockValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "p") c().setParagraph().run();
            else c().toggleHeading({ level: v === "h2" ? 2 : 3 }).run();
          }}
          className="h-10 shrink-0 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 text-sm font-medium"
        >
          <option value="p">Normal text</option>
          <option value="h2">Heading</option>
          <option value="h3">Sub-heading</option>
        </select>
        <Sep />
        <ToolBtn icon="format_bold" label="Bold" active={s.bold} onClick={() => c().toggleBold().run()} disabled={disabled} />
        <ToolBtn icon="format_italic" label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()} disabled={disabled} />
        <ToolBtn icon="format_underlined" label="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()} disabled={disabled} />
        <ToolBtn icon="strikethrough_s" label="Strike-through" active={s.strike} onClick={() => c().toggleStrike().run()} disabled={disabled} />
        <Sep />
        <ToolBtn icon="format_list_bulleted" label="Bullet list" active={s.bullet} onClick={() => c().toggleBulletList().run()} disabled={disabled} />
        <ToolBtn icon="format_list_numbered" label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()} disabled={disabled} />
        <ToolBtn icon="format_quote" label="Quote / highlight box" active={s.quote} onClick={() => c().toggleBlockquote().run()} disabled={disabled} />
        <Sep />
        <ToolBtn icon="link" label="Add link" active={s.link} onClick={onLink} disabled={disabled} />
        <ToolBtn icon="image" label="Add image" onClick={onImage} disabled={disabled} />
        <ToolBtn icon="smart_display" label="Add YouTube video" onClick={onVideo} disabled={disabled} />
        <ToolBtn
          icon="table"
          label="Add table"
          active={s.table}
          onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          disabled={disabled}
        />
        <ToolBtn icon="horizontal_rule" label="Divider line" onClick={() => c().setHorizontalRule().run()} disabled={disabled} />
        <Sep />
        <ToolBtn icon="undo" label="Undo" onClick={() => c().undo().run()} disabled={disabled || !s.canUndo} />
        <ToolBtn icon="redo" label="Redo" onClick={() => c().redo().run()} disabled={disabled || !s.canRedo} />
      </div>
      {s.table && !disabled && (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-outline-variant bg-surface-container-low px-2 py-1.5 text-xs">
          <span className="mr-1 shrink-0 font-semibold text-on-surface-variant">Table:</span>
          {[
            ["Add row", () => c().addRowAfter().run()],
            ["Add column", () => c().addColumnAfter().run()],
            ["Remove row", () => c().deleteRow().run()],
            ["Remove column", () => c().deleteColumn().run()],
            ["Delete table", () => c().deleteTable().run()],
          ].map(([label, fn]) => (
            <button
              key={label as string}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={fn as () => void}
              className="shrink-0 rounded-md border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 font-medium hover:bg-surface-container"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RichEditor({
  value,
  onChange,
  disabled,
  placeholder = "Start writing your article here…",
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [imgOpen, setImgOpen] = useState(false);
  const [imgAlt, setImgAlt] = useState("");
  const [imgBusy, setImgBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: null, target: null } },
      }),
      Image.configure({ HTMLAttributes: { loading: "lazy" } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Youtube.configure({ nocookie: true, width: 640, height: 360 }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
    editorProps: { attributes: { class: "blog-prose px-4 py-5 sm:px-8 sm:py-8", spellcheck: "true" } },
  });

  // Outside changes (version restore, discard) replace the content.
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value;
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return <div className="min-h-[420px] animate-pulse rounded-2xl border border-outline-variant bg-surface-container-low" />;
  }

  const openLink = () => {
    setLinkUrl(editor.getAttributes("link").href || "");
    setLinkOpen(true);
  };
  const saveLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^(https?:\/\/|\/|mailto:|tel:)/i.test(url) ? url : `https://${url}`;
      if (editor.state.selection.empty && !editor.isActive("link")) {
        editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] }).run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    }
    setLinkOpen(false);
  };

  const pickImage = async (file?: File | null) => {
    if (!file) return;
    setImgBusy(true);
    setError("");
    try {
      const up = await uploadStudioImage(file, { purpose: "blog" });
      editor.chain().focus().setImage({ src: up.url, alt: imgAlt.trim() }).run();
      setImgOpen(false);
      setImgAlt("");
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setImgBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveVideo = () => {
    const ok = editor.chain().focus().setYoutubeVideo({ src: videoUrl.trim() }).run();
    if (!ok) {
      setError("That doesn't look like a YouTube link. Copy it from the YouTube “Share” button.");
      return;
    }
    setVideoOpen(false);
    setVideoUrl("");
  };

  // Click an image → edit its description.
  const selectedImage = editor.isActive("image") ? (editor.getAttributes("image") as { src?: string; alt?: string }) : null;

  return (
    <div className="studio-editor rounded-2xl border border-outline-variant bg-surface-container-lowest">
      <Toolbar editor={editor} onLink={openLink} onImage={() => setImgOpen(true)} onVideo={() => setVideoOpen(true)} disabled={disabled} />
      {selectedImage && !disabled && (
        <div className="flex flex-col gap-2 border-b border-outline-variant bg-[#f0fdf4] px-3 py-2 sm:flex-row sm:items-center">
          <span className="shrink-0 text-xs font-semibold text-[#14532d]">Image description:</span>
          <input
            value={selectedImage.alt || ""}
            onChange={(e) => editor.chain().updateAttributes("image", { alt: e.target.value }).run()}
            placeholder="What does this image show?"
            className="min-h-10 flex-1 rounded-lg border border-[#bbf7d0] bg-white px-3 text-[16px] sm:text-sm"
          />
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteSelection().run()}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-error hover:bg-error-container/40"
          >
            Remove image
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      {error && (
        <div className="border-t border-outline-variant p-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Add a link"
        footer={
          <>
            <Button onClick={() => setLinkOpen(false)}>Cancel</Button>
            {editor.isActive("link") && (
              <Button
                variant="danger"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </Button>
            )}
            <Button variant="primary" onClick={saveLink}>
              Save link
            </Button>
          </>
        }
      >
        <Field
          label="Web address"
          help={
            <>
              For our own pages just type the path, e.g. <b>/free-report</b> or <b>/blog/another-post</b>. Links to other
              websites open in a new tab automatically.
            </>
          }
        >
          <TextInput
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveLink()}
            placeholder="/free-report or https://…"
            inputMode="url"
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {["/free-report", "/book-demo", "/pricing", "/blog"].map((p) => (
            <button key={p} type="button" onClick={() => setLinkUrl(p)} className="rounded-full border border-outline-variant px-3 py-1.5 text-xs font-medium hover:bg-surface-container">
              {p}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={imgOpen}
        onClose={() => setImgOpen(false)}
        title="Add an image"
        footer={
          <>
            <Button onClick={() => setImgOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="upload" loading={imgBusy} onClick={() => fileRef.current?.click()}>
              Choose image
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Describe the image first" help="A few words about what it shows. Helps Google and people using screen readers.">
            <TextInput value={imgAlt} onChange={(e) => setImgAlt(e.target.value)} placeholder="e.g. Google Maps listing with 5-star reviews" maxLength={200} />
          </Field>
          <p className="text-xs text-on-surface-variant">JPG, PNG, WebP or GIF. Large photos are shrunk automatically.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
      </Modal>

      <Modal
        open={videoOpen}
        onClose={() => setVideoOpen(false)}
        title="Add a YouTube video"
        footer={
          <>
            <Button onClick={() => setVideoOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveVideo} disabled={!videoUrl.trim()}>
              Add video
            </Button>
          </>
        }
      >
        <Field label="YouTube link" help="Open the video on YouTube, click Share, and paste the link here.">
          <TextInput value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtu.be/…" inputMode="url" />
        </Field>
      </Modal>
    </div>
  );
}
