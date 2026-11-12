"use client";

/**
 * Shrinks a photo in the browser (≤ maxWidth px, WebP) before uploading, so
 * a 6 MB phone photo becomes ~150 KB and the public pages stay fast — no
 * server-side image processing needed. GIFs are uploaded as-is (animation).
 */
async function resize(file: File, maxWidth: number): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === "image/gif") {
    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = URL.createObjectURL(file);
    });
    return { blob: file, ...dims };
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("This file is not an image we can read. Try a JPG or PNG.");
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process this image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  // Safari < 14 can't encode WebP — fall back to JPEG.
  const out = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!out) throw new Error("Your browser could not process this image.");
  return { blob: out, width, height };
}

export async function uploadStudioImage(
  file: File,
  opts: { purpose?: "blog" | "page"; maxWidth?: number } = {}
): Promise<{ url: string; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file (JPG, PNG, WebP or GIF).");
  if (file.size > 25 * 1024 * 1024) throw new Error("This image is too large. Please use one under 25 MB.");
  const { blob, width, height } = await resize(file, opts.maxWidth || 1600);
  if (blob.size > 5 * 1024 * 1024) throw new Error("This image is still over 5 MB after resizing. Try a smaller one.");
  const form = new FormData();
  const ext = blob.type === "image/gif" ? "gif" : blob.type === "image/jpeg" ? "jpg" : "webp";
  form.append("file", blob, `image.${ext}`);
  form.append("purpose", opts.purpose || "blog");
  const res = await fetch("/api/studio/upload", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Upload failed. Please try again.");
  return { url: data.data.url, width, height };
}
