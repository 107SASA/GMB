/**
 * Keyword system migration for existing customers (docs/KEYWORD_SYSTEM_PLAN.md §11).
 *
 *  1. Owner keyword lists over 20: the first 20 stay in Business.keywords; the
 *     rest move to Business.legacyKeywords (still researched, never deleted).
 *  2. Active SEO plans without a keywordSet get one seeded from what their last
 *     report already measured (rank + Google Ads volume), so the Keywords tab
 *     shows targets now. Paid workspaces and active free trials only (free-report
 *     leads are skipped); Google need not be connected — it is display only,
 *     and full research starts at the first monthly report after connecting.
 *
 * No provider call is made. DEFAULT IS A DRY RUN: prints what would change.
 *
 *   cd /var/www/gmbboost
 *   npx tsx --env-file=.env.production scripts/migrate-keyword-set.ts           # dry run
 *   npx tsx --env-file=.env.production scripts/migrate-keyword-set.ts --apply   # write
 *
 * Safe to run more than once: lists already within 20 and plans that already
 * have a keywordSet are skipped.
 */
export {}; // module scope — keeps main() apart from other scripts' globals

const APPLY = process.argv.includes('--apply');

async function main() {
  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();
  const [{ default: Business }, { default: SeoPlan }, { splitOwnerKeywords, seedKeywordSet }, { verifiedServices }, { workspaceHasPlanAccess, PLAN_ACCESS_FIELDS }, { hasGoogleAccess }] = await Promise.all([
    import('../src/models/Business'),
    import('../src/models/SeoPlan'),
    import('../src/services/seo/keywordMigrate'),
    import('../src/services/seo/trackedKeywords'),
    import('../src/lib/billing/entitlements'),
    import('../src/lib/googleAccess'),
  ]);

  // 1. Owner lists over the cap.
  const long: any[] = await Business.find({ isDeleted: { $ne: true }, 'keywords.20': { $exists: true } })
    .select('name keywords legacyKeywords').lean();
  console.log(`\n[1] ${long.length} business(es) with more than 20 keywords`);
  for (const b of long) {
    const split = splitOwnerKeywords(b.keywords, b.legacyKeywords);
    console.log(`  - ${b.name} (${b._id}): keep ${split.keywords.length}, move ${split.moved.length} → legacyKeywords`);
    if (APPLY) await Business.updateOne({ _id: b._id }, { $set: { keywords: split.keywords, legacyKeywords: split.legacyKeywords } });
  }

  // 2. Active plans with no keywordSet yet.
  const plans: any[] = await SeoPlan.find({ status: 'active', $or: [{ keywordSet: { $exists: false } }, { keywordSet: { $size: 0 } }] })
    .select('businessId keywordTable trackedKeywords ownerRemovedKeywords updatedAt').lean();
  console.log(`\n[2] ${plans.length} active SEO plan(s) without a keyword list`);
  let seeded = 0;
  let notEligible = 0;
  for (const p of plans) {
    const b: any = await Business.findById(p.businessId)
      .select(`name category userDefinedCategory city services keywords legacyKeywords intakeCompleted isDeleted googleConnected googleAccess ${PLAN_ACCESS_FIELDS}`).lean();
    if (!b || b.isDeleted) continue;
    if (!workspaceHasPlanAccess(b)) {
      notEligible++;
      console.log(`  - ${b.name}: skipped (not paid / no active trial)`);
      continue;
    }
    const connectNote = hasGoogleAccess(b) ? '' : ' [Google not connected — research starts after connecting]';
    const category = b.userDefinedCategory || b.category || null;
    const services = verifiedServices({ ownerServices: String(b.services || '').split(/[,;\n]+/), category });
    const { keywordSet, changes } = seedKeywordSet({
      businessName: b.name || '',
      category,
      city: b.city || '',
      services,
      ownerKeywords: b.intakeCompleted ? (b.keywords || []).slice(0, 20) : [],
      legacyKeywords: b.legacyKeywords || [],
      keywordTable: p.keywordTable || [],
      trackedKeywords: p.trackedKeywords || [],
      ownerRemoved: p.ownerRemovedKeywords || [],
      measuredAt: new Date(p.updatedAt || Date.now()).toISOString(),
      now: new Date(),
    });
    if (!keywordSet.length) {
      console.log(`  - ${b.name}: nothing to seed (no measured or owner keywords)`);
      continue;
    }
    const core = keywordSet.filter((k: any) => k.role === 'core').map((k: any) => k.keyword);
    console.log(`  - ${b.name}: ${keywordSet.length} keywords, focus: ${core.join(' | ') || '(none yet)'}${connectNote}`);
    if (APPLY) await SeoPlan.updateOne({ _id: p._id }, { $set: { keywordSet, keywordSetChanges: changes } });
    seeded++;
  }

  console.log(`\n${APPLY ? 'Applied' : 'DRY RUN — nothing written'}: ${long.length} keyword list(s) trimmed, ${seeded} plan(s) seeded, ${notEligible} skipped (not paid / no active trial).`);
  if (!APPLY) console.log('Re-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
