import { NextResponse } from "next/server";
import { requireStudioApi } from "@/lib/studioAuth";
import { uploadPublicObject, isStorageConfigured } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rateLimit";
import { studioError, logStudioAction } from "@/lib/studio/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/** Real file type from the first bytes — never trust the browser's label alone. */
function sniff(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/**
 * Image upload for blog posts and page share images (Studio only). The editor
 * already shrinks photos to ≤1600px WebP in the browser; this checks the real
 * type and size, then stores it on the public CDN bucket under blog/.
 * Form field: file. Optional: purpose = 'blog' | 'page'.
 */
export async function POST(req: Request) {
  const auth = await requireStudioApi("any");
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`studio-upload:${auth.viewer.userId}`, 60, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: "Too many uploads. Please wait a few minutes." }, { status: 429 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ success: false, error: "Image storage is not set up on this server." }, { status: 500 });
  }

  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "No image received." }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: "Images must be 5 MB or smaller." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniff(buf);
    if (!type) return NextResponse.json({ success: false, error: "Only JPG, PNG, WebP or GIF images are allowed." }, { status: 400 });

    const purpose = form?.get("purpose") === "page" ? "pages" : "blog";
    const url = await uploadPublicObject(buf, type, `site/${purpose}`);
    await logStudioAction(auth.viewer, "upload", { url, bytes: buf.length, type });
    return NextResponse.json({ success: true, data: { url } });
  } catch (err) {
    return studioError(err, "upload");
  }
}
