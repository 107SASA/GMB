/**
 * Regenerate the free report for a phone number with the current report logic.
 *
 *   npx tsx scripts/regenerate-free-report.ts 9035988249            # dry run: shows account + past reports
 *   npx tsx scripts/regenerate-free-report.ts 6b03c594d5dd0959735398f1   # or by an old report's id
 *   npx tsx scripts/regenerate-free-report.ts 9035988249 --apply    # makes a new report now (no WhatsApp)
 *   npx tsx scripts/regenerate-free-report.ts 9035988249 --apply --notify
 *       # instead sends it through Inngest like the website does: also sends the
 *       # "report ready" WhatsApp and restarts the sales follow-up messages
 *
 * A 10-digit number is read as Indian (+91). Env: .env.production if present,
 * else .env.local. Old reports are kept; the new one is the latest.
 */
import fs from 'fs';
import path from 'path';

for (const f of ['.env.production', '.env.local']) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
  }
  console.log(`(env from ${f})`);
  break;
}

const args = process.argv.slice(2);
const rawPhone = args.find((a) => !a.startsWith('--'));
/** An old report's id (24 hex) instead of a phone: its business's owner is used. */
const AUDIT_ID = rawPhone && /^[a-f0-9]{24}$/i.test(rawPhone) ? rawPhone : null;
const APPLY = args.includes('--apply');
const NOTIFY = args.includes('--notify');
if (!rawPhone) {
  console.error('Usage: npx tsx scripts/regenerate-free-report.ts <phone | old report id> [--apply] [--notify]');
  process.exit(1);
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const { normalizePhoneE164 } = await import('../src/lib/phone');
  const User = (await import('../src/models/User')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const Audit = (await import('../src/models/Audit')).default;
  const { REPORT_LOGIC_VERSION } = await import('../src/services/audit/reportLogicVersion');

  let users: any[];
  let onlyBusinessId: string | null = null;
  if (AUDIT_ID) {
    const old: any = await Audit.findById(AUDIT_ID).select('businessId businessName').lean();
    if (!old) throw new Error(`No report with id ${AUDIT_ID}`);
    onlyBusinessId = String(old.businessId);
    console.log(`Report ${AUDIT_ID} is for "${old.businessName}" (business ${onlyBusinessId})`);
    users = await User.find({ businessIds: old.businessId }).lean();
    if (!users.length) throw new Error(`No account owns business ${onlyBusinessId}`);
  } else {
    const digits = rawPhone!.replace(/\D/g, '');
    const phone = normalizePhoneE164(digits.length === 10 ? `+91${digits}` : `+${digits}`);
    if (!phone) throw new Error(`Not a valid phone: ${rawPhone}`);
    users = await User.find({ phone }).lean();
    if (!users.length) throw new Error(`No user with phone ${phone}`);
  }
  if (users.length > 1) console.warn(`! ${users.length} matching users — using the first customer one`);
  const user = users.find((u) => u.role !== 'super_admin' && u.role !== 'SUPER_ADMIN') || users[0];
  console.log(`User ${user._id}  ${user.fullName || '(no name)'}  ${user.phone || ''}  shadow=${!!user.isShadowAccount}  role=${user.role}`);

  const businesses: any[] = await Business.find({ _id: { $in: onlyBusinessId ? [onlyBusinessId] : user.businessIds || [] } });
  if (!businesses.length) throw new Error('User has no business');
  for (const b of businesses) console.log(`Business ${b._id}  "${b.name}"  ${[b.city, b.state].filter(Boolean).join(', ')}  placeId=${b.googlePlaceId || '-'}`);
  if (businesses.length > 1) console.warn('! more than one business — using the first');
  const business = businesses[0];

  const audits: any[] = await Audit.find({ businessId: business._id })
    .select('status auditKind fastMode overallScore createdAt auditData.logicVersion')
    .sort({ createdAt: -1 }).limit(10).lean();
  console.log(`\nReports for this business (latest first), current logic version = ${REPORT_LOGIC_VERSION}:`);
  for (const a of audits) {
    console.log(`  ${a._id}  ${a.status.padEnd(9)} ${String(a.auditKind || '-').padEnd(12)} score=${a.overallScore ?? '-'}  v${a.auditData?.logicVersion ?? '?'}  ${new Date(a.createdAt).toISOString()}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Add --apply to make a new report.');
    process.exit(0);
  }

  const organization = await Organization.findById(business.organizationId);
  if (!organization) throw new Error(`Organization ${business.organizationId} not found`);

  // Same shape as the website's free report (fastMode lead-gen audit).
  const { createPendingAuditAndDispatch } = await import('../src/lib/startAudit');
  let auditId: string;
  if (NOTIFY) {
    const audit = await createPendingAuditAndDispatch(business, organization, user, { trigger: 'admin-regenerate' });
    auditId = String(audit._id);
    console.log(`\nNew report ${auditId} sent to Inngest — it will finish in the background and WhatsApp the owner.`);
    process.exit(0);
  }

  // No Inngest: create the PENDING audit the same way, then run it here.
  const { inngest } = await import('../src/services/inngest/client');
  const realSend = inngest.send.bind(inngest);
  (inngest as any).send = async () => ({ ids: [] }); // skip the dispatch only for this call
  const audit = await createPendingAuditAndDispatch(business, organization, user, { trigger: 'admin-regenerate' });
  (inngest as any).send = realSend;
  auditId = String(audit._id);
  console.log(`\nNew report ${auditId} created, running it now (takes ~20-60 s)...`);

  const { processAuditJob } = await import('../src/services/audit/auditService');
  await processAuditJob(auditId);
  const after: any = await Audit.findById(auditId).lean();
  console.log(`Done: status=${after?.status}  score=${after?.overallScore ?? '-'}  v${after?.auditData?.logicVersion ?? '?'}`);
  console.log(`Report link: ${process.env.NEXT_PUBLIC_APP_URL || 'https://growwmatics.com'}/free-report/result?auditId=${auditId}`);
  process.exit(after?.status === 'COMPLETED' ? 0 : 1);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});
