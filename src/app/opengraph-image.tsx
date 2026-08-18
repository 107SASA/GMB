import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

// Default share/search-preview image for the whole site — every route that
// doesn't define its own opengraph-image.tsx falls back to this one.
// Previously there was NO og:image anywhere, so a link to any page (search
// result rich preview, WhatsApp/social share) rendered with no thumbnail at
// all — this generates one at request time from real design tokens instead
// of shipping a static asset that drifts from the brand colors.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori (the renderer behind ImageResponse) can't fetch local /public files
// by URL at request time, so the brand mark is inlined as a data URI —
// read once at module load rather than on every request.
const iconDataUri = `data:image/png;base64,${fs
  .readFileSync(path.join(process.cwd(), "public/brand/icon.png"))
  .toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #00386c 0%, #1a4f8b 55%, #006c45 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- ImageResponse (Satori) requires a plain <img>, not next/image; this renders to a static raster image, not real DOM */}
            <img src={iconDataUri} alt="" width={44} height={44} style={{ objectFit: "contain" }} />
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, color: "#ffffff" }}>GrowwMatics AI</div>
        </div>
        <div
          style={{
            fontSize: 30,
            color: "#d5e3ff",
            maxWidth: 900,
            textAlign: "center",
            lineHeight: 1.4,
          }}
        >
          AI-Powered Google Business Profile Growth Platform
        </div>
      </div>
    ),
    { ...size }
  );
}
