import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Directory, File, Paths } from 'expo-file-system';

import type { CardPhoto } from '@/api/endpoints/leads';

/**
 * Offline queue for visiting cards. Conference halls often have no signal:
 * the photos are copied into the app's document folder (the system never
 * clears it, unlike the camera's cache) and listed as "waiting". Nothing is
 * sent anywhere until the owner taps "Read now" with a connection — the card
 * then goes through the normal scan → check → save flow.
 */

const QUEUE_KEY = 'cardScan.queue';
const MAX_QUEUED = 100;

export type QueuedCard = {
  id: string;
  front: CardPhoto;
  back: CardPhoto | null;
  metAt: string;
  createdAt: string;
};

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

export async function listQueuedCards(): Promise<QueuedCard[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const items: QueuedCard[] = raw ? JSON.parse(raw) : [];
    // Drop entries whose photo is gone (e.g. app data cleared).
    return items.filter((c) => {
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

async function writeQueue(items: QueuedCard[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function enqueueCard(front: CardPhoto, back: CardPhoto | null, metAt: string): Promise<QueuedCard> {
  const items = await listQueuedCards();
  if (items.length >= MAX_QUEUED) throw new Error(`You already have ${MAX_QUEUED} cards waiting. Read some of them first.`);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const card: QueuedCard = {
    id,
    front: await keep(front, id, 'front'),
    back: back ? await keep(back, id, 'back') : null,
    metAt,
    createdAt: new Date().toISOString(),
  };
  await writeQueue([...items, card]);
  return card;
}

export async function removeQueuedCard(id: string): Promise<void> {
  const items = await listQueuedCards();
  const card = items.find((c) => c.id === id);
  await writeQueue(items.filter((c) => c.id !== id));
  for (const p of [card?.front, card?.back]) {
    if (!p) continue;
    try {
      const f = new File(p.uri);
      if (f.exists) f.delete();
    } catch {
      // Best effort — an orphan file is harmless.
    }
  }
}

/** True when the request never reached the server (no signal / timeout). */
export function isOfflineError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}
