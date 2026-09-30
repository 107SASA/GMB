import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import {
  BILLING_RETENTION_YEARS, BUSINESS_TOMBSTONE_KEEP, PURGE_GRACE_DAYS, PURGE_TARGETS, STORAGE_URL_FIELDS,
  USER_TOMBSTONE_KEEP, businessStoragePrefixes, type PurgeKey,
} from './purgePlan';

/**
 * Account hard-purge — permanently erases a deleted account's personal data
 * PURGE_GRACE_DAYS after the owner deleted it (accountHardPurgeCron).
 *
 * This is the ONE place in the codebase allowed to delete core business
 * records (leads, customers, reviews, conversations, audits, …). Every other
 * cleanup job explicitly never does — that boundary is crossed here on
 * purpose, for accounts their owner deleted, and must not be copied elsewhere.
 *
 * Hard safety rails (a bug here destroys a live customer's data):
 *   - SUPER_ADMIN accounts are refused inside purgeAccount itself, whatever
 *     their isDeleted state and whoever calls it.
 *   - A user is acted on only with isDeleted: true AND deletedAt older than
 *     the grace period AND not already purged — re-checked from the database
 *     inside purgeAccount, never taken from the caller.
 *   - Only businesses the user OWNS (Business.userId) that are themselves
 *     isDeleted: true are purged; a workspace owned by someone else is never
 *     touched, even if it appears in the user's businessIds.
 *   - Everything is scoped by those business ids, the user id, and the
 *     leads/audits of those businesses — never by a bare organizationId.
 *   - dry_run (the default mode) only counts: zero writes, zero deletes,
 *     no Google or storage calls.
 *   - Each collection is deleted independently; a failure is recorded and
 *     the account is NOT marked purged, so the next run retries (deletes are
 *     idempotent). Tombstones and purgedAt are written only when everything
 *     succeeded.
 *   - The audit trail (AccountPurgeLog) records ids and counts only.
 */

export type PurgeMode = 'dry_run' | 'live';

export interface PurgeDeps {
  storage?: {
    configured: boolean;
    keyFromPublicUrl: (url: string | null | undefined) => string | null;
    listKeysUnderPrefix: (prefix: string) => Promise<string[]>;
    deleteKeys: (keys: string[]) => Promise<number>;
  };
  /** Revoke a Google OAuth refresh token (best-effort). */
  revokeGoogleToken?: (encryptedRefreshToken: string) => Promise<void>;
}

export interface PurgeResult {
  userId: string;
  mode: PurgeMode;
  refused?: string;
  businessIds: string[];
  counts: Record<string, number>;
  storageObjects: number;
  errors: string[];
  complete: boolean;
}

const DAY = 86_400_000;
export const graceCutoff = (now: Date, graceDays = PURGE_GRACE_DAYS) => new Date(now.getTime() - graceDays * DAY);

async function model(name: string): Promise<mongoose.Model<any>> {
  if (!mongoose.models[name]) await import(`@/models/${name}`);
  return mongoose.models[name];
}

/** Users eligible for purge now. SUPER_ADMIN excluded in the query as well as in purgeAccount. */
export async function findUsersDueForPurge(now = new Date(), graceDays = PURGE_GRACE_DAYS, limit = 50): Promise<string[]> {
  await dbConnect();
  const User = await model('User');
  const rows: any[] = await User.find({
    role: { $ne: 'SUPER_ADMIN' },
    isDeleted: true,
    deletedAt: { $lte: graceCutoff(now, graceDays) },
    purgedAt: { $exists: false },
  }).select('_id').sort({ deletedAt: 1 }).limit(limit).lean();
  return rows.map((r) => String(r._id));
}

async function defaultStorage(): Promise<NonNullable<PurgeDeps['storage']>> {
  const s = await import('@/lib/storage');
  return { configured: s.isStorageConfigured(), keyFromPublicUrl: s.keyFromPublicUrl, listKeysUnderPrefix: s.listKeysUnderPrefix, deleteKeys: s.deleteKeys };
}

async function defaultRevoke(encrypted: string): Promise<void> {
  const { decrypt } = await import('@/lib/crypto');
  const token = decrypt(encrypted);
  const res = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
  // 400 invalid_token = already revoked / expired — nothing left to revoke.
  if (!res.ok && res.status !== 400) throw new Error(`Google revoke HTTP ${res.status}`);
}

export async function purgeAccount(userId: string, opts: { mode: PurgeMode; now?: Date; graceDays?: number; deps?: PurgeDeps }): Promise<PurgeResult> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const live = opts.mode === 'live';
  const result: PurgeResult = { userId, mode: opts.mode, businessIds: [], counts: {}, storageObjects: 0, errors: [], complete: false };
  const User = await model('User');
  const Business = await model('Business');

  // ── Rails: re-check everything from the database ──
  const user: any = await User.findById(userId).lean();
  if (!user) return { ...result, refused: 'user not found' };
  if (user.role === 'SUPER_ADMIN') return { ...result, refused: 'SUPER_ADMIN accounts are never purged' };
  if (user.isDeleted !== true || !user.deletedAt) return { ...result, refused: 'account is not deleted' };
  if (new Date(user.deletedAt) > graceCutoff(now, opts.graceDays)) return { ...result, refused: 'grace period has not passed' };
  if (user.purgedAt) return { ...result, refused: 'already purged' };

  const uid = user._id;
  const owned: any[] = await Business.find({
    isDeleted: true,
    purgedAt: { $exists: false },
    $or: [
      { userId: uid },
      // Legacy workspaces created before Business.userId existed: only when listed on
      // this user AND in their own organization — never someone else's workspace.
      ...(user.businessIds?.length && user.organizationId
        ? [{ _id: { $in: user.businessIds }, userId: { $exists: false }, organizationId: user.organizationId }]
        : []),
    ],
  }).select('_id').lean();
  const businessIds = owned.map((b) => b._id);
  result.businessIds = businessIds.map(String);

  // Ids are matched in BOTH stored forms (ObjectId and its hex string): some
  // collections declare these refs as String (e.g. AutomationLog.businessId),
  // older rows exist in either form, and the native driver is used below so
  // Mongoose never casts one form away.
  const both = (xs: any[]) => [...xs, ...xs.map(String)];
  const Lead = await model('Lead');
  const Audit = await model('Audit');
  const leadIds = businessIds.length ? (await Lead.collection.find({ businessId: { $in: both(businessIds) } }).project({ _id: 1 }).toArray()).map((l: any) => l._id) : [];
  const auditIds = (await Audit.collection.find({ $or: [{ businessId: { $in: both(businessIds) } }, { userId: { $in: both([uid]) } }] }).project({ _id: 1 }).toArray()).map((a: any) => a._id);
  const ids: Record<PurgeKey, any[]> = { businessId: businessIds, userId: [uid], leadId: leadIds, auditId: auditIds };

  const filterFor = (by: Record<string, PurgeKey | undefined>) => {
    const or = Object.entries(by).filter(([, key]) => key && ids[key!].length).map(([field, key]) => ({ [field]: { $in: both(ids[key!]) } }));
    return or.length ? { $or: or } : null;
  };

  // ── Files in object storage (collected before their records go) ──
  const storage = opts.deps?.storage ?? (await defaultStorage());
  const keys = new Set<string>();
  try {
    if (storage.configured) {
      for (const { model: m, field } of STORAGE_URL_FIELDS) {
        const M = await model(m);
        const rows: any[] = businessIds.length ? await M.collection.find({ businessId: { $in: both(businessIds) } }).project({ [field]: 1 }).toArray() : [];
        for (const r of rows) {
          const k = storage.keyFromPublicUrl(r[field]);
          if (k) keys.add(k);
        }
      }
      for (const b of businessIds) for (const p of businessStoragePrefixes(String(b))) for (const k of await storage.listKeysUnderPrefix(p)) keys.add(k);
    }
  } catch (err: any) {
    result.errors.push(`storage listing: ${err?.message}`);
  }
  result.storageObjects = keys.size;

  if (live) {
    // Revoke Google access before the tokens are deleted.
    const GBPToken = await model('GBPToken');
    const tokens: any[] = businessIds.length ? await GBPToken.collection.find({ businessId: { $in: both(businessIds) } }).project({ refreshToken: 1 }).toArray() : [];
    const revoke = opts.deps?.revokeGoogleToken ?? defaultRevoke;
    for (const t of tokens) {
      try { if (t.refreshToken) await revoke(t.refreshToken); } catch (err: any) { result.errors.push(`google revoke: ${err?.message}`); }
    }
    if (keys.size) {
      try { await storage.deleteKeys(Array.from(keys)); } catch (err: any) { result.errors.push(`storage delete: ${err?.message}`); }
    }
  }

  // ── Collections (each independent) ──
  for (const t of PURGE_TARGETS) {
    try {
      const filter = filterFor(t.by);
      if (!filter) { result.counts[t.model] = 0; continue; }
      const M = await model(t.model);
      result.counts[t.model] = live ? (await M.collection.deleteMany(filter)).deletedCount ?? 0 : await M.collection.countDocuments(filter);
    } catch (err: any) {
      result.errors.push(`${t.model}: ${err?.message}`);
    }
  }

  // ── Tombstones: only when every deletion above succeeded ──
  if (live && result.errors.length === 0) {
    try {
      const unsetExcept = (doc: any, keep: string[]) =>
        Object.fromEntries(Object.keys(doc).filter((k) => !keep.includes(k)).map((k) => [k, 1]));
      for (const b of await Business.find({ _id: { $in: businessIds } }).lean() as any[]) {
        const unset = unsetExcept(b, [...BUSINESS_TOMBSTONE_KEEP, 'name', 'category']);
        await Business.collection.updateOne({ _id: b._id }, {
          $set: { name: 'Deleted business', category: 'Deleted', isDeleted: true, purgedAt: now },
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        });
      }
      result.counts.BusinessTombstoned = businessIds.length;

      // Organization: only when nothing live is left in it.
      if (user.organizationId) {
        const Organization = await model('Organization');
        const [otherUsers, liveBusinesses] = await Promise.all([
          User.countDocuments({ organizationId: user.organizationId, _id: { $ne: uid }, isDeleted: { $ne: true } }),
          Business.countDocuments({ organizationId: user.organizationId, isDeleted: { $ne: true } }),
        ]);
        if (otherUsers === 0 && liveBusinesses === 0) {
          const org: any = await Organization.findById(user.organizationId).lean();
          if (org) {
            const unset = unsetExcept(org, ['_id', 'ownerId', 'billingId', 'createdAt', 'updatedAt', '__v', 'name', 'status']);
            await Organization.collection.updateOne({ _id: org._id }, {
              $set: { name: 'Deleted organization', status: 'Cancelled', purgedAt: now },
              ...(Object.keys(unset).length ? { $unset: unset } : {}),
            });
            result.counts.OrganizationTombstoned = 1;
          }
        }
      }

      // User last: unique placeholders keep the required unique indexes satisfied.
      const unset = unsetExcept(user, [...USER_TOMBSTONE_KEEP, 'fullName', 'email', 'phone']);
      await User.collection.updateOne({ _id: uid }, {
        $set: { fullName: 'Deleted user', email: `purged_${uid}@deleted.invalid`, phone: `purged_${uid}`, isDeleted: true, purgedAt: now },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      });
      result.complete = true;
    } catch (err: any) {
      result.errors.push(`tombstone: ${err?.message}`);
    }
  }
  if (!live) result.complete = result.errors.length === 0;

  if (live) {
    const AccountPurgeLog = await model('AccountPurgeLog');
    await AccountPurgeLog.create({
      userId: uid, businessIds, deletedAt: user.deletedAt, startedAt: now, finishedAt: new Date(),
      counts: result.counts, storageObjectsDeleted: result.errors.some((e) => e.startsWith('storage')) ? 0 : result.storageObjects,
      errorMessages: result.errors, complete: result.complete,
    }).catch((e: any) => console.error('[account-purge] audit log write failed:', e?.message));
  }
  return result;
}

/**
 * Billing records of purged accounts are kept (no personal fields) for
 * BILLING_RETENTION_YEARS after the purge, then removed.
 */
export async function expireBillingRecords(opts: { mode: PurgeMode; now?: Date }): Promise<{ subscriptions: number; businesses: number }> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - BILLING_RETENTION_YEARS * 365.25 * DAY);
  const Business = await model('Business');
  const User = await model('User');
  const Subscription = await model('Subscription');
  const biz: any[] = await Business.find({ purgedAt: { $lte: cutoff }, razorpaySubscriptionId: { $exists: true } }).select('_id').lean();
  const users: any[] = await User.find({ purgedAt: { $lte: cutoff }, role: { $ne: 'SUPER_ADMIN' } }).select('_id').lean();
  const filter = { $or: [{ businessId: { $in: biz.map((b) => b._id) } }, { userId: { $in: users.map((u) => u._id) } }] };
  if (opts.mode !== 'live') return { subscriptions: await Subscription.countDocuments(filter), businesses: biz.length };
  const subs = (await Subscription.deleteMany(filter)).deletedCount ?? 0;
  await Business.collection.updateMany(
    { _id: { $in: biz.map((b) => b._id) } },
    { $unset: { razorpaySubscriptionId: 1, subscriptionStatus: 1, subscriptionCurrentPeriodEnd: 1, subscriptionCancelAtPeriodEnd: 1 } },
  );
  return { subscriptions: subs, businesses: biz.length };
}

/** Mode from env: only ACCOUNT_PURGE_MODE=live deletes; anything else is a dry run. */
export function purgeModeFromEnv(): PurgeMode {
  return process.env.ACCOUNT_PURGE_MODE === 'live' ? 'live' : 'dry_run';
}
