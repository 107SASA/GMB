/**
 * READ-ONLY: why are a customer's visiting-card scans not reaching the CRM?
 *
 * For the customer account on a phone number, prints per workspace: the
 * monthly card-scan limit and how many are used, the active-lead cap, scans
 * in the last 24 hours, recent card-scan AI calls (and failures), and the
 * latest "Business Card" leads that DID arrive. Writes nothing.
 *
 *   npx tsx --env-file=.env.production scripts/diagnose-card-scans.ts 8485860323
 */
async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: npx tsx --env-file=.env.production scripts/diagnose-card-scans.ts <phone>');
    process.exit(1);
  }
  const { default: dbConnect } = await import('../src/lib/mongodb');
  const { default: mongoose } = await import('mongoose');
  const { default: User } = await import('../src/models/User');
  const { default: Business } = await import('../src/models/Business');
  const { default: Lead } = await import('../src/models/Lead');
  const { default: AIUsageLog } = await import('../src/models/AIUsageLog');
  const { phoneDedupeKey } = await import('../src/lib/phone');
  const { checkUsageLimit } = await import('../src/lib/featureGating');
  const { activeLeadCapacity } = await import('../src/lib/freeCrm');

  await dbConnect();
  const key = phoneDedupeKey(arg);
  if (!key) throw new Error(`Not a phone number: ${arg}`);
  const users: any[] = await User.find({ phone: { $regex: `${key}$` }, role: { $nin: ['GROWTH_PARTNER', 'SUPER_ADMIN', 'TEAM_MEMBER'] } })
    .select('_id fullName email phone subscriptionPlan isDeleted lastSeenAt lastSeenClient businessIds activeBusinessId')
    .lean();
  if (!users.length) {
    console.log(`No customer account found for ${arg}.`);
    return;
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const u of users) {
    console.log(`\n=== User ${u._id}  ${u.fullName}  ${u.phone}  plan=${u.subscriptionPlan}${u.isDeleted ? '  (DELETED)' : ''}`);
    console.log(`    last seen ${u.lastSeenAt?.toISOString?.() ?? '-'} on ${u.lastSeenClient ?? '-'}; active workspace ${u.activeBusinessId ?? '-'}`);
    const businesses: any[] = await Business.find({ _id: { $in: u.businessIds ?? [] } }).select('_id name isDeleted').lean();
    for (const b of businesses) {
      const bid = String(b._id);
      const [scans, cap, last24h, recentLogs, leads] = await Promise.all([
        checkUsageLimit(String(u._id), bid, 'cardScans'),
        activeLeadCapacity(bid),
        AIUsageLog.countDocuments({
          businessId: new mongoose.Types.ObjectId(bid),
          promptType: { $in: ['business_card_scan', 'business_card_scan_retry'] },
          createdAt: { $gte: since24h },
        }),
        AIUsageLog.find({ businessId: new mongoose.Types.ObjectId(bid), promptType: { $in: ['business_card_scan', 'business_card_scan_retry'] } })
          .sort({ createdAt: -1 }).limit(25).select('createdAt promptType status errorMessage').lean(),
        Lead.find({ businessId: bid, source: 'Business Card' })
          .sort({ createdAt: -1 }).limit(25).select('name phone createdAt businessCard.needsReview businessCard.metAt').lean(),
      ]);
      console.log(`\n  --- Workspace ${bid}  ${b.name}${b.isDeleted ? '  (DELETED)' : ''}${String(u.activeBusinessId) === bid ? '  [active]' : ''}`);
      console.log(`  Card scans this month: ${scans.used ?? '?'} / ${scans.limit === -1 ? 'unlimited' : scans.limit}  ${scans.allowed ? 'OK' : 'LIMIT REACHED -> app gets 403 and stops sending'}`);
      console.log(`  Active leads: ${cap.used} / ${cap.limit === -1 ? 'unlimited' : cap.limit}  ${cap.allowed ? 'OK' : 'LEAD CAP REACHED -> app gets 403 and stops sending'}`);
      console.log(`  Scans in last 24h: ${last24h} (daily guard ${Number(process.env.CARD_SCAN_DAILY_LIMIT) || 300})`);
      console.log(`  Recent card-scan AI calls (${recentLogs.length}):`);
      for (const l of recentLogs as any[]) {
        console.log(`    ${l.createdAt.toISOString()}  ${l.promptType}  ${l.status}${l.errorMessage ? `  ${String(l.errorMessage).slice(0, 100)}` : ''}`);
      }
      console.log(`  Latest Business Card leads that arrived (${leads.length}):`);
      for (const l of leads as any[]) {
        console.log(`    ${l.createdAt.toISOString()}  ${l.name || '(no name)'}  ${l.phone || '-'}${l.businessCard?.needsReview ? '  [check details]' : ''}${l.businessCard?.metAt ? `  @${l.businessCard.metAt}` : ''}`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

export {};
