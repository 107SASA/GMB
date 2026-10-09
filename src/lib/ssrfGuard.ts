/**
 * SSRF guard for server-side fetches of user-supplied URLs (the audit's
 * website check fetches whatever website a business profile lists).
 *
 * Blocks: non-http(s) schemes, non-standard ports, credentials in the URL,
 * and any hostname that resolves — at connect time, so DNS rebinding can't
 * slip past a pre-check — to a loopback, private, link-local (incl. the
 * cloud metadata service 169.254.169.254), CGNAT, multicast or reserved
 * address. Redirects are followed manually and every hop is re-checked.
 *
 * No `@/` imports so the pure checks run under `node --test`.
 */
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

const ALLOWED_PORTS = new Set(['', '80', '443']);

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** True when the address must never be fetched from the server. */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(addr)) {
    const n = ipv4ToInt(addr);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(addr)) {
    const g = expandIPv6(addr);
    if (!g) return true;
    const v4At = (i: number) => `${g[i] >> 8}.${g[i] & 255}.${g[i + 1] >> 8}.${g[i + 1] & 255}`;
    const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
    if (zeroUpTo(8)) return true; // ::
    if (zeroUpTo(7) && g[7] === 1) return true; // ::1
    // Embedded IPv4 in ANY notation — URL parsing turns [::ffff:127.0.0.1]
    // into [::ffff:7f00:1], which a dotted-only check misses.
    if (zeroUpTo(5) && g[5] === 0xffff) return isBlockedAddress(v4At(6)); // ::ffff:a.b.c.d (mapped)
    if (zeroUpTo(6)) return isBlockedAddress(v4At(6)); // ::a.b.c.d (compatible, deprecated)
    if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return isBlockedAddress(v4At(6)); // ::ffff:0:a.b.c.d (translated)
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and /48
    if (g[0] === 0x2002) return isBlockedAddress(v4At(1)); // 6to4 embeds a v4 address
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true; // not an IP at all → refuse
}

/** Eight 16-bit groups for any valid IPv6 text form (incl. "::" and a trailing dotted v4). */
function expandIPv6(addr: string): number[] | null {
  let s = addr.split('%')[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    s = s.slice(0, -dotted[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const parse = (part: string | undefined) => (part ? part.split(':').filter(Boolean).map((h) => parseInt(h, 16)) : []);
  const h = parse(head);
  const t = s.includes('::') ? parse(tail) : [];
  const missing = 8 - h.length - t.length;
  if (missing < 0 || (!s.includes('::') && missing !== 0)) return null;
  const groups = [...h, ...Array(missing).fill(0), ...t];
  return groups.length === 8 && groups.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? groups : null;
}

/** Shape check before any network activity. Returns the URL or a reason. */
export function checkUrlShape(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL not allowed' };
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: `port ${url.port} not allowed` };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: `host ${host} not allowed` };
  }
  if (net.isIP(host) && isBlockedAddress(host)) return { ok: false, reason: `address ${host} not allowed` };
  return { ok: true, url };
}

/** Public resolvers, asked only when the system resolver says a name does not
 *  exist — some ISP resolvers miss CNAME-hosted sites (a live Wix site was
 *  reported "unreachable" that way). Answers go through the same IP check. */
const fallbackResolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
fallbackResolver.setServers(['8.8.8.8', '1.1.1.1']);

async function resolveViaPublicDns(hostname: string): Promise<Array<{ address: string; family: number }>> {
  const [v4, v6] = await Promise.all([
    fallbackResolver.resolve4(hostname).catch(() => [] as string[]),
    fallbackResolver.resolve6(hostname).catch(() => [] as string[]),
  ]);
  return [...v4.map((address) => ({ address, family: 4 })), ...v6.map((address) => ({ address, family: 6 }))];
}

/** dns.lookup replacement used by the HTTP agents: refuses blocked addresses. */
function guardedLookup(hostname: string, options: any, callback: any) {
  dns.lookup(hostname, { ...options, all: true }, async (err: any, addresses: any) => {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
      const viaPublic = await resolveViaPublicDns(hostname).catch(() => []);
      if (!viaPublic.length) return callback(err);
      addresses = viaPublic;
      err = null;
    }
    if (err) return callback(err);
    const list: Array<{ address: string; family: number }> = Array.isArray(addresses) ? addresses : [addresses];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || list.length === 0) {
      return callback(new Error(`Refusing to connect to ${hostname}: resolves to a blocked address`));
    }
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

export const guardedHttpAgent = new http.Agent({ lookup: guardedLookup as any });
export const guardedHttpsAgent = new https.Agent({ lookup: guardedLookup as any });

/**
 * Fetch a user-supplied URL's text with the guard applied to every hop.
 * Returns null on any refusal or failure (callers treat it as unreachable).
 */
export async function guardedFetchText(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; maxBytes?: number; userAgent?: string } = {},
): Promise<{ finalUrl: string; body: string; xRobotsTag: string | null } | null> {
  const { default: axios } = await import('axios');
  let current = rawUrl;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    const shape = checkUrlShape(current);
    if (!shape.ok) {
      console.warn(`[ssrfGuard] blocked ${current}: ${shape.reason}`);
      return null;
    }
    try {
      const res = await axios.get(shape.url.toString(), {
        timeout: opts.timeoutMs ?? 8000,
        maxRedirects: 0,
        responseType: 'text',
        maxContentLength: opts.maxBytes ?? 2_000_000,
        headers: { 'User-Agent': opts.userAgent ?? 'Mozilla/5.0 (compatible; GrowwMaticsAudit/1.0)' },
        httpAgent: guardedHttpAgent,
        httpsAgent: guardedHttpsAgent,
        proxy: false,
        validateStatus: (st) => st >= 200 && st < 400,
      });
      if (res.status >= 300 && res.headers?.location) {
        current = new URL(String(res.headers.location), shape.url).toString();
        continue;
      }
      const tag = res.headers?.['x-robots-tag'];
      return {
        finalUrl: shape.url.toString(),
        body: typeof res.data === 'string' ? res.data : '',
        xRobotsTag: tag ? String(tag).slice(0, 200) : null,
      };
    } catch (err: any) {
      console.warn(`[ssrfGuard] fetch failed for ${current}: ${err?.message}`);
      return null;
    }
  }
  return null;
}

/** Same guards as guardedFetchText, for binary content (customer logo / photos). */
export async function guardedFetchBuffer(
  rawUrl: string,
  opts: { timeoutMs?: number; maxRedirects?: number; maxBytes?: number } = {},
): Promise<{ finalUrl: string; body: Buffer; contentType: string } | null> {
  const { default: axios } = await import('axios');
  let current = rawUrl;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const shape = checkUrlShape(current);
    if (!shape.ok) {
      console.warn(`[ssrfGuard] blocked ${current}: ${shape.reason}`);
      return null;
    }
    try {
      const res = await axios.get(shape.url.toString(), {
        timeout: opts.timeoutMs ?? 10_000,
        maxRedirects: 0,
        responseType: 'arraybuffer',
        maxContentLength: opts.maxBytes ?? 8_000_000,
        httpAgent: guardedHttpAgent,
        httpsAgent: guardedHttpsAgent,
        proxy: false,
        validateStatus: (st) => st >= 200 && st < 400,
      });
      if (res.status >= 300 && res.headers?.location) {
        current = new URL(String(res.headers.location), shape.url).toString();
        continue;
      }
      return { finalUrl: shape.url.toString(), body: Buffer.from(res.data), contentType: String(res.headers?.['content-type'] || '') };
    } catch (err: any) {
      console.warn(`[ssrfGuard] binary fetch failed for ${current}: ${err?.message}`);
      return null;
    }
  }
  return null;
}
