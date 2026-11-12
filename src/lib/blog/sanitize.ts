import sanitizeHtml from "sanitize-html";
import { countWords, readingMinutes, type BlogLanguage } from "@/lib/blog/shared";
import type { IBlogTocItem } from "@/models/BlogPost";

/**
 * Cleans blog HTML on the SERVER before it is stored. Content Studio writers
 * are trusted less than Super Admins, and this HTML is rendered on the public
 * site with dangerouslySetInnerHTML — so only plain article markup survives:
 * no <script>/<style>, no on* handlers, no javascript: links, no inline
 * styles, and iframes only from YouTube.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "mark", "a",
    "ul", "ol", "li", "blockquote", "code", "pre", "hr", "br", "img",
    "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
    "figure", "figcaption", "div", "iframe",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    iframe: ["src", "width", "height", "allowfullscreen", "allow", "title", "loading"],
    div: ["data-youtube-video"],
    ol: ["start"],
  },
  allowedSchemes: ["https", "http", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com"],
  // Drop the CONTENTS of these, not just the tags.
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  transformTags: {
    // The post title is the page's only <h1>.
    h1: "h2",
    a: (tagName, attribs) => {
      const href = attribs.href || "";
      const external = /^https?:\/\//i.test(href) && !/^https:\/\/(www\.)?growwmatics\.com/i.test(href);
      const out: Record<string, string> = { href };
      if (external) {
        out.target = "_blank";
        out.rel = "noopener noreferrer";
      }
      return { tagName, attribs: out };
    },
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: "lazy", decoding: "async", alt: attribs.alt || "" },
    }),
    iframe: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: "lazy", allowfullscreen: "true", title: attribs.title || "YouTube video" },
    }),
  },
  // Images only from https:// (scheme rules don't cover relative "src=x"),
  // and iframes only as https YouTube embeds.
  exclusiveFilter: (frame) =>
    (frame.tag === "img" && !/^https:\/\//i.test(frame.attribs.src || "")) ||
    (frame.tag === "iframe" && !/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//i.test(frame.attribs.src || "")),
};

function headingId(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9ऀ-ॿ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section";
  let id = `s-${base}`;
  let n = 2;
  while (used.has(id)) id = `s-${base}-${n++}`;
  used.add(id);
  return id;
}

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export interface CleanContent {
  html: string;
  toc: IBlogTocItem[];
  wordCount: number;
  readingMinutes: number;
}

/** Sanitize + add heading anchors + measure. Safe to call on already-clean HTML. */
export function cleanBlogHtml(raw: string, lang: BlogLanguage): CleanContent {
  const safe = sanitizeHtml(String(raw || "").slice(0, 400_000), OPTIONS);
  const used = new Set<string>();
  const toc: IBlogTocItem[] = [];
  const html = safe.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, lvl: string, inner: string) => {
    const text = decode(inner.replace(/<[^>]+>/g, "")).trim();
    if (!text) return "";
    const id = headingId(text, used);
    toc.push({ id, text: text.slice(0, 140), level: Number(lvl) as 2 | 3 });
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  const wordCount = countWords(html);
  return { html, toc, wordCount, readingMinutes: readingMinutes(wordCount, lang) };
}

/** Plain-text clean for short fields (titles, FAQ answers, CTA text). */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  // Tags stripped, entities decoded back to plain characters: these fields are
  // always rendered by React as text (auto-escaped), never as HTML.
  return decode(sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A link a writer typed for a custom CTA button: our own path or an https URL. */
export function cleanLink(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim();
  if (/^\/(?!\/)[^\s]*$/.test(v)) return v.slice(0, 500);
  if (/^https:\/\/[^\s]+$/i.test(v)) return v.slice(0, 500);
  return "";
}

/** Image URL we accept on a post: https only. */
export function cleanImageUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v.slice(0, 1000) : "";
}
