import axios from 'axios';
import { api } from '../client';

/**
 * Profile optimization — mirrors the web page
 * (src/app/dashboard/profile-optimization/page.tsx) and the same routes:
 * GET /api/gbp/optimize (recommendations, read-only), /api/gbp/changes
 * (proposals) and /api/gbp/changes/[id]/{approve,execute,rollback,discard}.
 * Nothing reaches Google until a proposal is executed.
 */

export interface ChangeRow {
  _id: string;
  kind: string;
  status: string;
  sensitive: boolean;
  source: string;
  before: unknown;
  proposed: unknown;
  error?: string | null;
  createdAt?: string;
  verifiedAt?: string | null;
  validation?: { valid?: boolean; violations?: Array<{ message?: string }>; warnings?: Array<{ message?: string }> };
}

export interface CategoryRec {
  displayName: string;
  categoryName: string | null;
  reason: string;
  executable: boolean;
  role?: string;
  competitors?: string[];
  services?: string[];
  risk?: string;
}

export interface HoursPeriod {
  openDay: string;
  closeDay: string;
  openTime: string;
  closeTime: string;
}

/** The GET /api/gbp/optimize body — loosely typed, like the web page. */
export interface Recommendations {
  success: boolean;
  connected?: boolean;
  categories?: { primary?: CategoryRec | null; additional?: CategoryRec[] };
  attributes?: { available?: boolean; suggestions?: Array<{ name: string; displayName?: string; valueType: string }> };
  services?: {
    items?: Array<{
      name: string;
      description?: string;
      /** 'google' = one of Google's own services for the category; 'custom' = the owner's wording. */
      kind?: 'google' | 'custom';
      serviceTypeId?: string;
      /** Ticked by default (backed by what the owner / their website offer). False = Google's other services, unticked. */
      preselected?: boolean;
      keywordRationale?: string;
    }>;
    blocked?: boolean;
    reason?: string;
  };
  /** Food menu (only when Google allows one on this listing). */
  foodMenu?: { allowed: boolean; readable: boolean; current: MenuDraft | null } | null;
  /** Hotel details (lodging listings only). */
  lodging?: {
    allowed: boolean;
    readable: boolean;
    fields: Array<{ path: string; label: string; group: string; type: 'bool' | 'time' }>;
    current: Record<string, boolean | string | null>;
    suggested: string[];
  } | null;
  /** Booking / order buttons Google offers for this listing. */
  buttons?: {
    readable: boolean;
    types: Array<{ placeActionType: string; label: string; current: string | null; partner: string | null; suggested: string | null }>;
  } | null;
  /** What Google allows on this listing. Null = not known yet. */
  capabilities?: { services: boolean | null; foodMenu: boolean | null; lodging: boolean | null; health: boolean | null };
  description?: { current?: string | null; text?: string; validation?: { valid?: boolean }; tokens?: string[]; competitorNames?: string[] };
  hours?: {
    status?: string;
    reminders?: Array<{ date: string; name: string; covered: boolean }>;
    currentRegularHours?: HoursPeriod[] | null;
  };
  links?: {
    attributes?: Record<string, { name: string } | null>;
    current?: Record<string, string | null>;
  };
  serviceArea?: { businessType?: string | null; places?: Array<{ placeId?: string | null; placeName?: string | null }> };
  pin?: { status?: string };
}

/** Result body of any proposal/action call; error bodies come back as data, as on the web. */
export interface ActionResult {
  success?: boolean;
  error?: string | null;
  liveWriteApplied?: boolean;
  reused?: boolean;
  change?: { status?: string; error?: string | null };
  results?: Array<{ name?: string; stored?: boolean; reused?: boolean; error?: string; violations?: Array<{ message?: string }> }>;
}

/**
 * POST that resolves with the server's `{ success: false, error }` body on a
 * 4xx (the web page reads it the same way). A session/plan error still
 * rejects, after the client interceptors have handled it.
 */
async function post<T = ActionResult>(url: string, body: object = {}): Promise<T> {
  try {
    const { data } = await api.post<T>(url, body);
    return data;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const data = axios.isAxiosError(err) ? (err.response?.data as { error?: unknown } | undefined) : undefined;
    if (status && status < 500 && status !== 401 && typeof data?.error === 'string') {
      return data as T;
    }
    throw err;
  }
}

export async function fetchProfileOptimization(): Promise<{
  changes: ChangeRow[];
  googleReviewPending: boolean | null;
  recs: Recommendations | null;
}> {
  const [list, opt] = await Promise.all([
    api.get<{ changes?: ChangeRow[]; googleReviewPending?: boolean }>('/api/gbp/changes').then((r) => r.data),
    api.get<Recommendations>('/api/gbp/optimize').then((r) => r.data),
  ]);
  return {
    changes: list.changes || [],
    googleReviewPending: typeof list.googleReviewPending === 'boolean' ? list.googleReviewPending : null,
    recs: opt.success ? opt : null,
  };
}

export function proposeChange(body: object): Promise<ActionResult> {
  return post('/api/gbp/changes', body);
}

export function proposeAttributes(items: Array<{ name: string; value: unknown }>): Promise<ActionResult> {
  // Identifies this submission only (see the web requestId.ts); identical
  // open proposals are merged on the server.
  const clientRequestId = `attr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return post('/api/gbp/changes/attributes', { clientRequestId, items });
}

export function changeAction(
  id: string,
  action: 'approve' | 'execute' | 'rollback' | 'discard',
  body: object = {},
): Promise<ActionResult> {
  return post(`/api/gbp/changes/${id}/${action}`, body);
}

export function resolveServiceAreas(
  queries: string[],
): Promise<{ error?: string; results?: Array<{ places?: Array<{ placeId: string; placeName: string; address: string | null }> }> }> {
  return post('/api/gbp/service-area/resolve', { queries });
}

// ─── Menu, products ──────────────────────────────────────────────────────────

export interface MenuItem { name: string; description?: string; price: number | null; veg?: boolean | null; spice?: 'MILD' | 'MEDIUM' | 'HOT' | null; serves?: number | null }
export interface MenuDraft { currency: string; sections: Array<{ name: string; items: MenuItem[] }> }
export type UploadPhoto = { uri: string; mimeType: string; fileName: string };

function photoForm(photos: UploadPhoto[]): FormData {
  const form = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape in place of a Blob.
  for (const p of photos) form.append('photos', { uri: p.uri, name: p.fileName, type: p.mimeType } as unknown as Blob);
  return form;
}

async function postForm<T>(url: string, form: FormData, timeout: number): Promise<T> {
  try {
    const { data } = await api.post<T>(url, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout });
    return data;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const data = axios.isAxiosError(err) ? (err.response?.data as { error?: unknown } | undefined) : undefined;
    if (status && status !== 401 && typeof data?.error === 'string') return { success: false, error: data.error } as T;
    throw err;
  }
}

/** POST /api/gbp/menu/scan — AI reads the menu photos; returns the menu to check (nothing saved). */
export function scanMenu(photos: UploadPhoto[]) {
  return postForm<{ success: boolean; error?: string; draft?: MenuDraft; found?: number; added?: number; missingPrices?: number }>('/api/gbp/menu/scan', photoForm(photos), 120_000);
}

export type ProductButton = 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'CALL';
export interface ProductDraft { imageUrl: string | null; name: string; category: string; description: string; price: number | null; button: ProductButton; buttonUrl: string; source: string }
export interface ProductRow { _id: string; name: string; price: number | null; imageUrl?: string; lastPostedAt?: string; scheduledPostAt?: string }
export interface Posting { scheduled: number; skipped: number; first: string | null }

export async function fetchProducts(): Promise<{ products: ProductRow[]; autoPost: boolean; website: string | null }> {
  const { data } = await api.get('/api/products');
  return { products: data?.products || [], autoPost: !!data?.autoPost, website: data?.website || null };
}

/** POST /api/products/scan — uploads the photos and reads each product with AI. */
export function scanProducts(photos: UploadPhoto[]) {
  return postForm<{ success: boolean; error?: string; drafts?: Array<Omit<ProductDraft, 'button' | 'buttonUrl'>>; unread?: number }>('/api/products/scan', photoForm(photos), 120_000);
}

export function saveProducts(items: ProductDraft[], postToGoogle: boolean) {
  return post<{ success: boolean; error?: string; products?: ProductRow[]; posting?: Posting | null }>('/api/products', { items, post: postToGoogle });
}

export function postProducts(ids: string[] | 'all') {
  return post<{ success: boolean; error?: string; posting?: Posting }>('/api/products/post', { ids });
}

export function setProductAutoPost(autoPost: boolean) {
  return post<{ success: boolean }>('/api/products/post', { autoPost });
}

export async function removeProduct(id: string): Promise<void> {
  await api.delete(`/api/products/${id}`);
}
