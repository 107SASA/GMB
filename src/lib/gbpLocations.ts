/**
 * Every Business Profile location a Google login can manage, across ALL of
 * its Business Profile accounts (and every page of each).
 *
 * Nov 2026 bug: both OAuth callbacks read only `accounts[0]`. A login with a
 * personal account AND a business / location-group account often lists the
 * personal one first, with no locations — the connection was then saved with
 * an empty location ("BNI Kolkata South": connected, nothing attached, every
 * sync "No GBP location linked").
 *
 * Each location carries the account it belongs to, which later API calls
 * (posts, reviews, media on the v4 API) need.
 */

export interface GbpLocationCandidate {
  /** "locations/{id}" */
  locationId: string;
  /** "accounts/{id}" that manages it */
  accountId: string;
  title: string;
  storefrontAddress: any;
  placeId?: string;
  /**
   * Google's `metadata.hasVoiceOfMerchant`: true when this login really
   * controls the listing. A second, unverified claim of an already-verified
   * listing (shares its placeId, ownership conflict) is false / missing.
   */
  hasVoiceOfMerchant?: boolean;
  /** Google's `metadata.duplicateLocation`: set when Google marks this profile as a copy of another one. */
  duplicateOf?: string;
}

export type ListLocationsResult =
  | { ok: true; locations: GbpLocationCandidate[]; accountsChecked: number }
  /** accounts.list itself failed (usually API access / permission) */
  | { ok: false; reason: 'accounts_failed'; status: number; body: string }
  | { ok: false; reason: 'no_accounts' }
  /** Every account's location list failed — not the same as "no locations". */
  | { ok: false; reason: 'locations_failed'; status: number; body: string };

const MAX_ACCOUNTS = 25;
const MAX_PAGES = 10;

export async function listAllGbpLocations(accessToken: string, fetchFn: typeof fetch = fetch): Promise<ListLocationsResult> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const accounts: any[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      if (page === 0) return { ok: false, reason: 'accounts_failed', status: res.status, body: await res.text() };
      break;
    }
    const data: any = await res.json();
    accounts.push(...(data.accounts ?? []));
    pageToken = data.nextPageToken || '';
    if (!pageToken || accounts.length >= MAX_ACCOUNTS) break;
  }
  if (accounts.length === 0) return { ok: false, reason: 'no_accounts' };

  const locations: GbpLocationCandidate[] = [];
  const seen = new Set<string>();
  let anyAccountRead = false;
  let lastError: { status: number; body: string } | null = null;
  for (const account of accounts.slice(0, MAX_ACCOUNTS)) {
    const accountId: string = account.name;
    let locToken = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations` +
        `?readMask=name,title,storefrontAddress,metadata&pageSize=100${locToken ? `&pageToken=${encodeURIComponent(locToken)}` : ''}`;
      const res = await fetchFn(url, { headers });
      if (!res.ok) {
        lastError = { status: res.status, body: await res.text() };
        console.warn(`[gbpLocations] ${accountId} locations.list failed: ${res.status}`);
        break;
      }
      anyAccountRead = true;
      const data: any = await res.json();
      for (const l of data.locations ?? []) {
        // A location shared through two accounts is listed once.
        if (!l?.name || seen.has(l.name)) continue;
        seen.add(l.name);
        locations.push({ locationId: l.name, accountId, title: l.title ?? '', storefrontAddress: l.storefrontAddress, placeId: l.metadata?.placeId, hasVoiceOfMerchant: l.metadata?.hasVoiceOfMerchant === true, duplicateOf: l.metadata?.duplicateLocation || undefined });
      }
      locToken = data.nextPageToken || '';
      if (!locToken) break;
    }
  }
  if (!anyAccountRead && lastError) return { ok: false, reason: 'locations_failed', ...lastError };
  return { ok: true, locations, accountsChecked: Math.min(accounts.length, MAX_ACCOUNTS) };
}

/**
 * The profile to connect automatically, or null when the owner has to pick
 * it on the location picker. Automatic only when the choice is clear:
 *   - the login holds exactly one profile and Google doesn't flag it as a
 *     duplicate, or
 *   - exactly one profile shares the workspace's placeId and isn't a
 *     duplicate (several such: only the single one Google confirms this login
 *     controls).
 *
 * Nov 2026 ("Michelle's Foods"): the login held two copies of the listing,
 * both sharing the workspace's placeId, and the first was connected
 * silently. Google then allowed reading but no posts or edits, and nobody
 * saw why. That case now goes to the picker, with the copies labelled.
 */
export function autoPickLocation(locations: GbpLocationCandidate[], placeId: string | null | undefined): GbpLocationCandidate | null {
  if (locations.length === 1) return locations[0].duplicateOf ? null : locations[0];
  if (!placeId) return null;
  const matches = locations.filter((l) => l.placeId === placeId);
  const clean = matches.filter((l) => !l.duplicateOf);
  if (matches.length === 1) return clean[0] ?? null;
  const verified = clean.filter((l) => l.hasVoiceOfMerchant === true);
  return verified.length === 1 ? verified[0] : null;
}

/**
 * Picker order: this workspace's own listing (placeId on file) first, the
 * one Google confirms this login controls first among those, and profiles
 * Google flags as duplicates last.
 */
export function rankLocationsForPlace(locations: GbpLocationCandidate[], placeId: string | null | undefined): GbpLocationCandidate[] {
  const score = (l: GbpLocationCandidate) =>
    (placeId && l.placeId === placeId ? 4 : 0) + (l.hasVoiceOfMerchant ? 2 : 0) + (l.duplicateOf ? 0 : 1);
  return locations.map((l, i) => ({ l, i })).sort((a, b) => score(b.l) - score(a.l) || a.i - b.i).map(({ l }) => l);
}
