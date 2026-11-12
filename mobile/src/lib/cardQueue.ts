import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { getApiErrorMessage } from '@/api/client';
import {
  saveBusinessCardLead,
  scanAndSaveCard,
  type BusinessCardLeadInput,
  type CardPhoto,
} from '@/api/endpoints/leads';

/**
 * Visiting cards captured on the phone and sent to the server in the
 * background — works with slow or no network (conference halls).
 *
 *  - "scan" items: photos (kept in the app's document folder, which the system
 *    never clears) + the event. Sent with autoSave=1: the server reads AND
 *    saves the lead in one call, no confirmation. The item id is sent as
 *    clientId, so a retry after a dropped connection never makes a second
 *    lead or a second charge.
 *  - "save" items: a form the owner already checked ("Read & check now") whose
 *    Save failed for lack of network.
 *
 * syncCardQueue() sends them one at a time, oldest first, and stops at the
 * first network failure (useCardSync runs it when the app opens, when the
 * network comes back, and every minute while anything is waiting).
 */

const QUEUE_KEY = 'cardScan.queue';
const MAX_QUEUED = 200;
const MAX_ATTEMPTS = 5;

/** Long side of the uploaded photo — plenty for the AI, ~10× smaller than the camera file. */
const UPLOAD_LONG_SIDE = 1280;

export type QueueStatus = 'waiting' | 'unreadable' | 'failed';

export type QueuedCard = {
  id: string;
  kind: 'scan';
  businessId: string | null;
  front: CardPhoto;
  back: CardPhoto | null;
  metAt: string;
  createdAt: string;
  status: QueueStatus;
  attempts: number;
  lastError?: string;
};

export type QueuedSave = {
  id: string;
  kind: 'save';
  businessId: string | null;
  payload: BusinessCardLeadInput;
  label: string;
  createdAt: string;
  status: QueueStatus;
  attempts: number;
  lastError?: string;
};

export type QueueItem = QueuedCard | QueuedSave;

export type SyncedResult = { leadId: string; name: string; existing: boolean; needsReview: boolean; at: string };

// ── Photos ───────────────────────────────────────────────────────────────

/** Shrinks a camera photo to ≤1280px JPEG before it is kept / uploaded. Falls back to the original. */
export async function shrinkPhoto(photo: CardPhoto, width?: number, height?: number): Promise<CardPhoto> {
  try {
    const landscape = !width || !height || width >= height;
    const long = landscape ? width : height;
    const ctx = ImageManipulator.manipulate(photo.uri);
    if (!long || long > UPLOAD_LONG_SIDE) ctx.resize(landscape ? { width: UPLOAD_LONG_SIDE } : { height: UPLOAD_LONG_SIDE });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { uri: out.uri, mimeType: 'image/jpeg', fileName: `card-${Date.now()}.jpg` };
  } catch {
    return photo;
  }
}

function queueDir(): Directory {
  const dir = new Directory(Paths.document, 'card-queue');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function keep(photo: CardPhoto, id: string, side: 'front' | 'back'): Promise<CardPhoto> {
  const dest = new File(queueDir(), `${id}-${side}.jpg`);
  await new File(photo.uri).copy(dest);
  return { uri: dest.uri, mimeType: photo.mimeType, fileName: `${id}-${side}.jpg` };
}

function deletePhotos(item: QueueItem | undefined) {
  if (!item || item.kind !== 'scan') return;
  for (const p of [item.front, item.back]) {
    if (!p) continue;
    try {
      const f = new File(p.uri);
      if (f.exists) f.delete();
    } catch {
      // Best effort — an orphan file is harmless.
    }
  }
}

// ── Storage ──────────────────────────────────────────────────────────────

/** Items saved by older builds had no kind/status — they are scan items waiting to be sent. */
function normalize(raw: any): QueueItem | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  if (raw.kind === 'save') return { attempts: 0, status: 'waiting', ...raw } as QueuedSave;
  if (!raw.front?.uri) return null;
  return { kind: 'scan', businessId: null, back: null, metAt: '', attempts: 0, status: 'waiting', ...raw } as QueuedCard;
}

export async function listQueue(): Promise<QueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const items = (raw ? (JSON.parse(raw) as unknown[]) : []).map(normalize).filter((i): i is QueueItem => !!i);
    // Drop scan items whose photo is gone (e.g. app data cleared).
    return items.filter((c) => {
      if (c.kind !== 'scan') return true;
      try {
        return new File(c.front.uri).exists;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Back-compat name used by older screens. */
export const listQueuedCards = listQueue;

let writeChain: Promise<void> = Promise.resolve();

/** Serialized read-modify-write so the sync loop and the screen never overwrite each other. */
function updateQueue(fn: (items: QueueItem[]) => QueueItem[]): Promise<void> {
  writeChain = writeChain.then(async () => {
    const next = fn(await listQueue());
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    emit();
  }).catch(() => {});
  return writeChain;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function enqueueCard(params: { businessId: string | null; front: CardPhoto; back: CardPhoto | null; metAt: string }): Promise<QueuedCard> {
  const items = await listQueue();
  if (items.length >= MAX_QUEUED) throw new Error(`You already have ${MAX_QUEUED} cards waiting. Connect to the internet so they can be sent.`);
  const id = newId();
  const card: QueuedCard = {
    id,
    kind: 'scan',
    businessId: params.businessId,
    front: await keep(params.front, id, 'front'),
    back: params.back ? await keep(params.back, id, 'back') : null,
    metAt: params.metAt.trim(),
    createdAt: new Date().toISOString(),
    status: 'waiting',
    attempts: 0,
  };
  await updateQueue((list) => [...list, card]);
  return card;
}

export async function enqueueSave(params: { businessId: string | null; payload: BusinessCardLeadInput; label: string }): Promise<void> {
  const item: QueuedSave = {
    id: newId(),
    kind: 'save',
    businessId: params.businessId,
    payload: params.payload,
    label: params.label,
    createdAt: new Date().toISOString(),
    status: 'waiting',
    attempts: 0,
  };
  await updateQueue((list) => [...list, item]);
}

export async function removeQueued(id: string): Promise<void> {
  let removed: QueueItem | undefined;
  await updateQueue((list) => {
    removed = list.find((i) => i.id === id);
    return list.filter((i) => i.id !== id);
  });
  deletePhotos(removed);
}

/** Back-compat name. */
export const removeQueuedCard = removeQueued;

/** Put an "unreadable" / "failed" item back in line. */
export async function retryQueued(id: string): Promise<void> {
  await updateQueue((list) => list.map((i) => (i.id === id ? { ...i, status: 'waiting', attempts: 0, lastError: undefined } : i)));
  void syncCardQueue();
}

// ── Change notifications (screens re-read the queue) ─────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn();
}

let lastResults: SyncedResult[] = [];
/** Leads saved in the background this app session, newest first. */
export function recentSyncedResults(): SyncedResult[] {
  return lastResults;
}

let syncState: { running: boolean; offline: boolean; message: string | null } = { running: false, offline: false, message: null };
export function getSyncState() {
  return syncState;
}
function setSyncState(s: Partial<typeof syncState>) {
  syncState = { ...syncState, ...s };
  emit();
}

// ── Sync ─────────────────────────────────────────────────────────────────

/** True when the request never reached the server (no signal / timeout / aborted). */
export function isOfflineError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}

let inflight: Promise<{ saved: number }> | null = null;

/**
 * Sends waiting items one by one. Stops at the first network failure (tried
 * again later) or a plan limit; a card the AI can't read is set aside as
 * "unreadable" for the owner, never retried on its own.
 */
export function syncCardQueue(): Promise<{ saved: number }> {
  if (inflight) return inflight;
  inflight = (async () => {
    let saved = 0;
    setSyncState({ running: true, offline: false, message: null });
    try {
      for (;;) {
        const next = (await listQueue()).find((i) => i.status === 'waiting');
        if (!next) break;
        try {
          if (next.kind === 'scan') {
            const r = await scanAndSaveCard({ clientId: next.id, businessId: next.businessId, front: next.front, back: next.back, metAt: next.metAt });
            lastResults = [
              { leadId: r.lead._id, name: r.lead.name, existing: r.existing, needsReview: r.needsReview, at: new Date().toISOString() },
              ...lastResults,
            ].slice(0, 20);
          } else {
            const r = await saveBusinessCardLead(next.payload, next.businessId);
            lastResults = [
              { leadId: r.lead._id, name: r.lead.name, existing: r.existing, needsReview: false, at: new Date().toISOString() },
              ...lastResults,
            ].slice(0, 20);
          }
          saved += 1;
          await removeQueued(next.id);
        } catch (err) {
          if (isOfflineError(err)) {
            setSyncState({ offline: true });
            break;
          }
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          const message = getApiErrorMessage(err, 'Could not send this card.');
          if (status === 422 || status === 400) {
            // The AI found no card details (blurry / not a card) or the data is invalid.
            await updateQueue((list) => list.map((i) => (i.id === next.id ? { ...i, status: 'unreadable', lastError: message } : i)));
            continue;
          }
          if (status === 403 || status === 429 || status === 401) {
            // Plan / daily limit or signed out — stop; the owner sees the message.
            setSyncState({ message });
            break;
          }
          const attempts = next.attempts + 1;
          await updateQueue((list) =>
            list.map((i) => (i.id === next.id ? { ...i, attempts, lastError: message, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'waiting' } : i)),
          );
          if (attempts < MAX_ATTEMPTS) break; // server trouble — try again on the next round
        }
      }
    } finally {
      setSyncState({ running: false });
      inflight = null;
    }
    return { saved };
  })();
  return inflight;
}
