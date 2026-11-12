"use client";

import { MaterialIcon } from "@/components/ui/MaterialIcon";

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** How the page will look in Google search results. */
export function GooglePreview({ title, description, path }: { title: string; description: string; path: string }) {
  const crumbs = path === "/" ? "" : path.split("/").filter(Boolean).join(" › ");
  return (
    <div className="rounded-xl border border-outline-variant bg-white p-4" aria-label="Google search preview">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        <MaterialIcon name="search" size={14} /> Preview in Google
      </p>
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/icon.png" alt="" className="h-7 w-7 rounded-full border border-[#dadce0] bg-white object-contain p-0.5" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm text-[#202124]">Growwmatics AI</p>
          <p className="truncate text-xs text-[#4d5156]">
            https://growwmatics.com{crumbs ? ` › ${crumbs}` : ""}
          </p>
        </div>
      </div>
      <p className="mt-2 text-[19px] leading-snug text-[#1a0dab] break-words">{cut(title || "Your title appears here", 62)}</p>
      <p className="mt-1 text-sm leading-relaxed text-[#4d5156] break-words">
        {cut(description || "Your description appears here. Write one or two sentences about what the reader gets.", 160)}
      </p>
    </div>
  );
}

/** How the link will look when shared on WhatsApp / LinkedIn / Facebook. */
export function SocialPreview({ title, description, image, path }: { title: string; description: string; image?: string; path: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant bg-white" aria-label="Share preview">
      <p className="flex items-center gap-1.5 px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        <MaterialIcon name="share" size={14} /> Preview when shared on WhatsApp / LinkedIn
      </p>
      <div className="m-3 overflow-hidden rounded-lg border border-[#e4e6eb] bg-[#f0f2f5]">
        <div className="relative aspect-[1.91/1] bg-[#dfeae4]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image || "/opengraph-image"} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[11px] uppercase text-[#65676b]">growwmatics.com{path === "/" ? "" : path}</p>
          <p className="mt-0.5 font-semibold leading-snug text-[#050505] line-clamp-2">{title || "Title"}</p>
          <p className="mt-0.5 text-sm leading-snug text-[#65676b] line-clamp-2">{description || "Description"}</p>
        </div>
      </div>
    </div>
  );
}
