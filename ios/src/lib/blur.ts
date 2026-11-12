import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

import { BLUR_WARN_BELOW, base64ToBytes, rgbaToGray, tiledSharpness } from '@/lib/sharpness';

/**
 * Instant, offline blur check of a card photo (no network, ~100 ms): shrink
 * to 640px wide, decode, measure edge sharpness in the centre. Only a
 * WARNING — the owner can always "Use anyway". Returns null if the check
 * itself fails (never blocks a capture).
 */
export async function checkPhotoBlur(uri: string): Promise<{ blurry: boolean; score: number } | null> {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: 640 }).renderAsync();
    const out = await ref.saveAsync({ base64: true, compress: 0.9, format: SaveFormat.JPEG });
    if (!out.base64) return null;
    const img = decode(base64ToBytes(out.base64), { useTArray: true, formatAsRGBA: true });
    const score = tiledSharpness(rgbaToGray(img.data, img.width, img.height), img.width, img.height);
    return { blurry: score < BLUR_WARN_BELOW, score: Math.round(score) };
  } catch {
    return null;
  }
}
