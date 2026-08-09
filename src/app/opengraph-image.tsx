import { ImageResponse } from "next/og";

// Default share/search-preview image for the whole site — every route that
// doesn't define its own opengraph-image.tsx falls back to this one.
// Previously there was NO og:image anywhere, so a link to any page (search
// result rich preview, WhatsApp/social share) rendered with no thumbnail at
// all — this generates one at request time from real design tokens instead
// of shipping a static asset that drifts from the brand colors.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
            {/* Plain Unicode emoji here previously — Satori resolves those via
                a remote emoji-image fetch per render, which is slow (or hangs
                outright without outbound access) instead of an inline SVG. */}
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2c3 2 5 6 5 10 0 2-.5 4-1.5 5.5L12 22l-3.5-4.5C7.5 16 7 14 7 12c0-4 2-8 5-10z"
                fill="#ffffff"
              />
              <circle cx="12" cy="10" r="2" fill="#00386c" />
            </svg>
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
