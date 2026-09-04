import { readFileSync } from 'fs';
import path from 'path';

/**
 * Server-only helpers for embedding the brand mark into generated artefacts
 * (watermarked AI images, PDF reports). Reads from /public/brand and caches
 * the bytes / data-URI in module scope so repeated calls are free.
 */

let logoBufferCache: Buffer | null | undefined;
let logoDataUriCache: string | null | undefined;

const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'icon.png');

/** Raw PNG bytes of the brand mark, or null if it can't be read. */
export function getBrandLogoBuffer(): Buffer | null {
  if (logoBufferCache !== undefined) return logoBufferCache;
  try {
    logoBufferCache = readFileSync(LOGO_PATH);
  } catch (err) {
    console.warn('[brandAsset] could not read brand logo:', (err as Error).message);
    logoBufferCache = null;
  }
  return logoBufferCache;
}

/** `data:image/png;base64,…` for use in HTML/CSS (PDF templates), or null. */
export function getBrandLogoDataUri(): string | null {
  if (logoDataUriCache !== undefined) return logoDataUriCache;
  const buf = getBrandLogoBuffer();
  logoDataUriCache = buf ? `data:image/png;base64,${buf.toString('base64')}` : null;
  return logoDataUriCache;
}
