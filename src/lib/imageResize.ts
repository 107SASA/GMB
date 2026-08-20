/**
 * Client-side (browser-only, canvas-based) crop + resize for GBP photo
 * uploads. Google's Business Profile media API enforces fairly strict
 * dimension/aspect-ratio bounds per category — e.g. it rejected a
 * 1024x1536 portrait cover photo with "max: 2120px/1192px w/h" (roughly
 * 16:9). Rather than let a mismatched photo sail through staging and only
 * fail with a raw Google API error at publish time, LOGO/COVER uploads are
 * center-cropped to the right aspect ratio and resized to Google's own
 * recommended dimensions here, so every upload is compliant by construction.
 */

// Google's documented recommended sizes: cover ~1024x576 (16:9), logo/profile square.
export const COVER_TARGET = { width: 1024, height: 576 };
export const LOGO_TARGET = { width: 720, height: 720 };

/**
 * Center-crops `file` to the target aspect ratio (cover-fit — crops the
 * longer dimension rather than letterboxing) and resizes to exactly
 * targetWidth x targetHeight, re-encoding as JPEG.
 *
 * Best-effort: throws if the browser can't decode the image or canvas
 * export fails — callers should fall back to uploading the original file
 * rather than blocking the user entirely.
 */
export async function cropAndResizeImage(
  file: File,
  targetWidth: number,
  targetHeight: number
): Promise<File> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    const targetAspect = targetWidth / targetHeight;
    const srcAspect = img.width / img.height;

    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcAspect > targetAspect) {
      // Source is wider than target — crop the sides.
      sw = img.height * targetAspect;
      sx = (img.width - sw) / 2;
    } else if (srcAspect < targetAspect) {
      // Source is taller than target — crop top/bottom.
      sh = img.width / targetAspect;
      sy = (img.height - sh) / 2;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Could not encode resized image.');

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the selected image.'));
    img.src = src;
  });
}
