import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

/**
 * DigitalOcean Spaces (S3-compatible) object storage.
 *
 * Used to host user-uploaded media (GBP logo/cover/photos) and generated
 * thumbnails at PUBLIC URLs — required because Google Business Profile's media
 * API fetches images by URL (a base64 data-URL can't be pushed).
 *
 * Env:
 *   DO_SPACES_KEY, DO_SPACES_SECRET   – Spaces access key/secret
 *   DO_SPACES_REGION                  – e.g. "blr1"
 *   DO_SPACES_BUCKET                  – Space (bucket) name
 *   DO_SPACES_ENDPOINT                – optional, defaults to https://<region>.digitaloceanspaces.com
 *   DO_SPACES_CDN                     – optional CDN base, e.g. https://<bucket>.<region>.cdn.digitaloceanspaces.com
 */

const region = process.env.DO_SPACES_REGION || 'blr1';
const bucket = process.env.DO_SPACES_BUCKET || '';
const cdnBase = process.env.DO_SPACES_CDN || '';

/**
 * Region-level endpoint (NO bucket prefix) for virtual-hosted addressing — the
 * SDK prepends the bucket itself. If DO_SPACES_ENDPOINT was set to the
 * bucket-specific URL (https://<bucket>.<region>.digitaloceanspaces.com), strip
 * the bucket so the host isn't doubled into <bucket>.<bucket>.<region>…
 */
function regionEndpoint(): string {
  const raw = process.env.DO_SPACES_ENDPOINT;
  if (raw) {
    try {
      const u = new URL(raw);
      let host = u.host;
      if (bucket && host.startsWith(`${bucket}.`)) host = host.slice(bucket.length + 1);
      return `${u.protocol}//${host}`;
    } catch {
      /* malformed — fall back to the region default below */
    }
  }
  return `https://${region}.digitaloceanspaces.com`;
}

let _client: S3Client | null = null;

export function isStorageConfigured(): boolean {
  return !!(process.env.DO_SPACES_KEY && process.env.DO_SPACES_SECRET && bucket);
}

function getClient(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error('DigitalOcean Spaces is not configured (set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_BUCKET).');
  }
  if (!_client) {
    _client = new S3Client({
      region,
      endpoint: regionEndpoint(),
      // DO Spaces uses virtual-hosted-style URLs (bucket.<region>.digitaloceanspaces.com).
      forcePathStyle: false,
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY!,
        secretAccessKey: process.env.DO_SPACES_SECRET!,
      },
    });
  }
  return _client;
}

/** The public URL for a stored key (prefers the CDN base when configured). */
function publicUrl(key: string): string {
  if (cdnBase) return `${cdnBase.replace(/\/$/, '')}/${key}`;
  // Virtual-hosted style: https://<bucket>.<region>.digitaloceanspaces.com/<key>
  const host = regionEndpoint().replace(/^https?:\/\//, '');
  return `https://${bucket}.${host}/${key}`;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Uploads a public-read object and returns its public URL.
 * @param keyPrefix folder-like prefix, e.g. "gbp-media/<businessId>".
 */
export async function uploadPublicObject(
  body: Buffer | Uint8Array,
  contentType: string,
  keyPrefix = 'uploads',
): Promise<string> {
  const client = getClient();
  const ext = EXT_BY_TYPE[contentType.toLowerCase()] || contentType.split('/')[1]?.split('+')[0] || 'bin';
  const key = `${keyPrefix.replace(/^\/|\/$/g, '')}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'public-read',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return publicUrl(key);
}

/** Fetches a remote image (e.g. a generated thumbnail URL/data-URL) and re-hosts it publicly. */
export async function rehostImageFromUrl(sourceUrl: string, keyPrefix = 'uploads'): Promise<string> {
  // Data-URL: decode inline.
  const dataMatch = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(sourceUrl);
  if (dataMatch) {
    return uploadPublicObject(Buffer.from(dataMatch[2], 'base64'), dataMatch[1], keyPrefix);
  }
  // The URL comes from a third-party image API — refuse internal targets and
  // never follow a redirect off the checked host.
  const { checkUrlShape } = await import('@/lib/ssrfGuard');
  const shape = checkUrlShape(sourceUrl);
  if (!shape.ok || shape.url.protocol !== 'https:') throw new Error(`Refusing to re-host image from ${sourceUrl.slice(0, 80)}`);
  const res = await fetch(shape.url.toString(), { redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Failed to fetch image for re-hosting: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return uploadPublicObject(buf, contentType, keyPrefix);
}

// ── Deletion (account hard-purge only) ─────────────────────────────────────

/** The object key for a URL this bucket served (CDN or origin host), or null for any other URL. */
export function keyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url || !/^https:\/\//i.test(url) || !bucket) return null;
  for (const base of [cdnBase, publicUrl('')].filter(Boolean)) {
    const b = base.replace(/\/$/, '') + '/';
    if (url.startsWith(b)) {
      const key = decodeURIComponent(url.slice(b.length).split('?')[0]);
      return key && !key.includes('..') ? key : null;
    }
  }
  return null;
}

/** Every object key under a prefix (e.g. "gbp-media/<businessId>/"). */
export async function listKeysUnderPrefix(prefix: string): Promise<string[]> {
  if (!isStorageConfigured()) return [];
  const client = getClient();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r: any = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Delete exact keys (batches of 1000). Returns how many were deleted. */
export async function deleteKeys(keys: string[]): Promise<number> {
  if (!isStorageConfigured() || keys.length === 0) return 0;
  const client = getClient();
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const r: any = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
    if (r.Errors?.length) throw new Error(`storage delete failed for ${r.Errors.length} object(s): ${r.Errors[0]?.Message ?? ''}`);
    deleted += batch.length;
  }
  return deleted;
}
