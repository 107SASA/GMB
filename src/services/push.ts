import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';

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

/**
 * Sends one message to a list of tokens and returns the tokens Expo reported
 * as DeviceNotRegistered (uninstalled/expired), in ticket order.
 */
async function sendToTokens(tokens: string[], message: PushMessage): Promise<string[]> {
  const dead: string[] = [];

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    const chunk = tokens.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sound: 'default',
      priority: 'high',
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error(`[push] Expo push API returned ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { data?: ExpoPushTicket[] };
      const tickets = body.data ?? [];
      // Tickets come back in the same order as the messages sent.
      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          dead.push(chunk[idx]);
        }
      });
    } catch (err: any) {
      // Push is always best-effort — a delivery failure must never fail the
      // calling workflow step.
      console.error('[push] Failed to reach Expo push API:', err.message);
    }
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
