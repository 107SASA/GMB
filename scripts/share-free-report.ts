/**
 * Make a public (no sign-in) link for a finished report, and optionally send
 * it to the owner with the "report ready" WhatsApp template.
 *
 *   npx tsx scripts/share-free-report.ts <auditId>          # prints the share link only
 *   npx tsx scripts/share-free-report.ts <auditId> --send   # also WhatsApps it to the owner
 *
 * --send ignores the once-per-business guard (Business.reportReadySentAt),
 * because this is a deliberate resend of a regenerated report.
 * Env: .env.production if present, else .env.local.
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
const auditId = args.find((a) => !a.startsWith('--'));
const SEND = args.includes('--send');
if (!auditId) {
  console.error('Usage: npx tsx scripts/share-free-report.ts <auditId> [--send]');
  process.exit(1);
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const Audit = (await import('../src/models/Audit')).default;
  const Business = (await import('../src/models/Business')).default;
  const User = (await import('../src/models/User')).default;

  const audit: any = await Audit.findById(auditId).lean();
  if (!audit) throw new Error(`Audit ${auditId} not found`);
  if (audit.status !== 'COMPLETED') throw new Error(`Audit is ${audit.status}, not COMPLETED`);
  const business: any = await Business.findById(audit.businessId).lean();
  if (!business) throw new Error('Business not found');

  const { reportShareToken } = await import('../src/services/report/reportShareLink');
  const token = await reportShareToken(String(audit._id), 'admin-share');
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://growwmatics.com';
  console.log(`Business: ${business.name}`);
  console.log(`Share link (works without sign-in, 30 days): ${base}/free-report/result?auditId=${token}`);

  if (!SEND) {
    console.log('\nNot sent. Add --send to WhatsApp it to the owner.');
    process.exit(0);
  }

  const owner: any = business.userId ? await User.findById(business.userId).select('fullName phone').lean() : null;
  const phone = owner?.phone || business.phone;
  if (!phone) throw new Error('No phone for the owner');

  const { WA_TEMPLATES } = await import('../src/lib/whatsappTemplates');
  const { sendTemplateMessage } = await import('../src/services/twilio/client');
  const { usablePersonName } = await import('../src/lib/personName');
  const res: any = await sendTemplateMessage(phone, WA_TEMPLATES.reportReady, {
    '1': usablePersonName(owner?.fullName) || business.name || 'there',
    '2': business.name || 'your business',
    '3': token,
  }, String(business._id));

  if (res.success) {
    await Business.updateOne({ _id: business._id }, { $set: { reportReadySentAt: new Date() } });
    console.log(`WhatsApp sent to ${phone}.`);
    process.exit(0);
  }
  console.error(`WhatsApp FAILED: ${res.errorKind || ''} ${res.errorCode || ''} ${res.error || ''}`);
  process.exit(1);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});
