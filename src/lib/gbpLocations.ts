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
        locations.push({ locationId: l.name, accountId, title: l.title ?? '', storefrontAddress: l.storefrontAddress, placeId: l.metadata?.placeId });
      }
      locToken = data.nextPageToken || '';
      if (!locToken) break;
    }
  }
  if (!anyAccountRead && lastError) return { ok: false, reason: 'locations_failed', ...lastError };
  return { ok: true, locations, accountsChecked: Math.min(accounts.length, MAX_ACCOUNTS) };
}
