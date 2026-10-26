import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { outboundSuppressed } from '@/lib/outboundSuppression';

/**
 * Expo push notifications — plain fetch against Expo's push API (no
 * expo-server-sdk dependency). Callers are background workers (Inngest
 * steps); never call this inline from a route handler.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100; // Expo's max messages per request

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link payload the app routes on (e.g. { leadId } or { reviewId }). */
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

interface ExpoRequestError {
  code?: string;
  message?: string;
  details?: unknown;
}

/**
 * Expo rejects a whole request whose tokens belong to more than one Expo
 * project — the Android app (mobile/) and the iOS app (ios/) are separate
 * projects, so a user signed in on both phones hits this on every push.
 */
const MIXED_PROJECTS = 'PUSH_TOO_MANY_EXPERIENCE_IDS';

/**
 * Splits a mixed-project chunk into single-project groups using the error's
 * `details` ({ "@owner/project": [tokens] }). Tokens Expo didn't list go one
 * per request, so a malformed `details` can never re-mix projects.
 */
export function groupByProject(chunk: string[], details: unknown): string[][] {
  const inChunk = new Set(chunk);
  const placed = new Set<string>();
  const groups: string[][] = [];
  if (details && typeof details === 'object') {
    for (const listed of Object.values(details as Record<string, unknown>)) {
      if (!Array.isArray(listed)) continue;
      const group: string[] = [];
      for (const t of listed) {
        if (typeof t !== 'string' || !inChunk.has(t) || placed.has(t)) continue;
        placed.add(t);
        group.push(t);
      }
      if (group.length > 0) groups.push(group);
    }
  }
  for (const token of chunk) if (!placed.has(token)) groups.push([token]);
  return groups;
}

/**
 * Posts one request (≤ CHUNK_SIZE tokens) and returns its DeviceNotRegistered
 * tokens. On a mixed-project rejection it re-sends per project; `splits`
 * bounds that to two levels (project groups, then single tokens).
 */
async function postChunk(chunk: string[], message: PushMessage, splits = 0): Promise<string[]> {
  const payload = chunk.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: 'default',
    priority: 'high',
  }));

  let res: Response;
  try {
    res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    // Push is always best-effort — a delivery failure must never fail the
    // calling workflow step.
    console.error('[push] Failed to reach Expo push API:', err.message);
    return [];
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: ExpoPushTicket[]; errors?: ExpoRequestError[] }
    | null;

  if (!res.ok) {
    const mixed = body?.errors?.find((e) => e?.code === MIXED_PROJECTS);
    if (mixed && chunk.length > 1 && splits < 2) {
      const groups = splits === 0 ? groupByProject(chunk, mixed.details) : chunk.map((t) => [t]);
      console.info(`[push] ${chunk.length} device(s) span several Expo projects — sending as ${groups.length} request(s)`);
      const dead: string[] = [];
      for (const group of groups) dead.push(...(await postChunk(group, message, splits + 1)));
      return dead;
    }
    console.error(`[push] Expo push API returned ${res.status}${body?.errors?.[0]?.code ? ` (${body.errors[0].code})` : ''}`);
    return [];
  }

  const dead: string[] = [];
  const tickets = body?.data ?? [];
  // Tickets come back in the same order as the messages sent.
  tickets.forEach((ticket, idx) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      dead.push(chunk[idx]);
    }
  });
  return dead;
}

/**
 * Sends one message to a list of tokens and returns the tokens Expo reported
 * as DeviceNotRegistered (uninstalled/expired), in ticket order.
 */
async function sendToTokens(tokens: string[], message: PushMessage): Promise<string[]> {
  const dead: string[] = [];
  // lib/outboundSuppression.ts — nothing reaches Expo; no token is reported dead.
  if (outboundSuppressed('push')) {
    console.info(`[push][suppressed] "${message.title}" to ${tokens.length} device(s) — not sent`);
    return dead;
  }

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    dead.push(...(await postChunk(tokens.slice(i, i + CHUNK_SIZE), message)));
  }

  return dead;
}

async function pruneDeadTokens(deadTokens: string[]): Promise<void> {
  if (deadTokens.length === 0) return;
  await User.updateMany(
    { pushTokens: { $in: deadTokens } },
    { $pull: { pushTokens: { $in: deadTokens } } }
  );
}

/** Sends a push to every registered device of one user. */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<void> {
  await dbConnect();
  const user = await User.findById(userId).select('pushTokens').lean() as any;
  const tokens: string[] = user?.pushTokens ?? [];
  if (tokens.length === 0) return;
  const dead = await sendToTokens(tokens, message);
  await pruneDeadTokens(dead);
}

/**
 * Resolves the users allowed to act on a business — mirroring the ownership
 * rules in requireBusinessContext (src/lib/tenant.ts): the business's owner
 * (userId), users whose businessIds contain it, and members of the same
 * organization. Anyone outside those relations never gets this business's
 * notifications.
 */
export async function sendPushToBusinessUsers(
  businessId: string,
  message: PushMessage
): Promise<void> {
  await dbConnect();
  const business = await Business.findById(businessId)
    .select('userId organizationId')
    .lean() as any;
  if (!business) return;

  const ownership: any[] = [{ businessIds: businessId }];
  if (business.userId) ownership.push({ _id: business.userId });
  if (business.organizationId) ownership.push({ organizationId: business.organizationId });

  const users = await User.find({
    $or: ownership,
    isDeleted: { $ne: true },
    pushTokens: { $exists: true, $ne: [] },
  })
    .select('pushTokens')
    .lean() as any[];

  const tokens = Array.from(new Set(users.flatMap((u) => u.pushTokens ?? [])));
  if (tokens.length === 0) return;

  const dead = await sendToTokens(tokens, message);
  await pruneDeadTokens(dead);
}

/**
 * Platform-side equivalent of sendPushToBusinessUsers, for the GrowwMatics
 * platform's own WhatsApp leads (Sales/Booking/Report/Support conversations
 * on the owner-only line) — these have no `businessId` of their own to
 * notify a tenant's team about, since the "team" here is GrowwMatics'
 * internal staff (User.role === 'SUPER_ADMIN'), not a customer's workspace
 * users. Added for Phase 8's human-handoff notifications (see
 * services/support/supportAgent.ts and the shared handoff-trigger function
 * in services/agentHandoff/checkHandoffTriggers.ts) — no equivalent
 * existed before since nothing on the platform side previously needed to
 * page a human this way.
 */
export async function sendPushToSuperAdmins(message: PushMessage): Promise<void> {
  await dbConnect();
  const admins = await User.find({
    role: 'SUPER_ADMIN',
    isDeleted: { $ne: true },
    pushTokens: { $exists: true, $ne: [] },
  })
    .select('pushTokens')
    .lean() as any[];

  const tokens = Array.from(new Set(admins.flatMap((u) => u.pushTokens ?? [])));
  if (tokens.length === 0) return;

  const dead = await sendToTokens(tokens, message);
  await pruneDeadTokens(dead);
}
