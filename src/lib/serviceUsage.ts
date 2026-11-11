/**
 * Counts calls to providers that have no usage API of their own (Resend,
 * NanoBanana), so the Services & Costs monitor can compare them with the
 * plan's limits. Fire-and-forget: a counter failure never affects the send.
 */
export type CountedService = 'resend' | 'nanobanana';

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function countServiceUse(service: CountedService, n = 1): void {
  void (async () => {
    try {
      const { default: dbConnect } = await import('@/lib/mongodb');
      const { default: ServiceUsageCounter } = await import('@/models/ServiceUsageCounter');
      await dbConnect();
      await ServiceUsageCounter.updateOne(
        { service, day: utcDay() },
        { $inc: { count: n }, $setOnInsert: { expiresAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000) } },
        { upsert: true }
      );
    } catch (err: any) {
      console.warn(`[serviceUsage] could not count ${service}:`, err?.message);
    }
  })();
}

/** Sum of counts for a service since `sinceDay` (inclusive, YYYY-MM-DD). */
export async function sumServiceUse(service: CountedService, sinceDay: string): Promise<number> {
  const { default: ServiceUsageCounter } = await import('@/models/ServiceUsageCounter');
  const rows = await ServiceUsageCounter.aggregate([
    { $match: { service, day: { $gte: sinceDay } } },
    { $group: { _id: null, total: { $sum: '$count' } } },
  ]);
  return rows[0]?.total ?? 0;
}
