/**
 * One-off backfill: for every Lead, checks for an active SalesConversation /
 * BookingConversation / ReportConversation / SupportConversation by phone,
 * and sets currentAgent/currentStage accordingly. Leads with no matching
 * active conversation are left at currentAgent='NONE' (the schema default —
 * this script only ever WRITES a non-default value, never forces 'NONE'
 * onto a Lead that already has something else set by some other flow).
 *
 * Same priority order as processPlatformInbound() in
 * app/api/whatsapp/webhook/route.ts and observeLeadOwnershipShadow() next to
 * it: active SalesConversation > active BookingConversation > non-stopped
 * ReportConversation > active SupportConversation.
 *
 * Shadow-mode data only — does not affect live routing/reply behavior in any
 * way (LEAD_ENGINE_V2 still gates any future code that would read these
 * fields to decide something).
 *
 * Idempotent — re-running recomputes the same mapping from the same source
 * data and is safe to run repeatedly.
 *
 * Run once:  npx tsx scripts/backfillLeadOwnership.ts
 * Dry run (no writes, just prints what it would do):
 *            npx tsx scripts/backfillLeadOwnership.ts --dry-run
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

// Load environment variables manually (same approach as
// migrate-user-businessids.ts / migrate-subscriptions.ts).
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1]] = val;
    }
  });
}

const DRY_RUN = process.argv.includes('--dry-run');

// Minimal inline schemas — same approach as the other backfill scripts in
// this folder, to avoid pulling in the full @/models/* path-aliased tree
// under a standalone tsx run. Only the fields this script actually reads or
// writes are declared.
const LeadSchema = new mongoose.Schema({
  phone: String,
  currentAgent: String,
  currentStage: String,
}, { strict: false });

const SalesConversationSchema = new mongoose.Schema({
  phoneKey: String,
  status: String,
}, { strict: false });

const BookingConversationSchema = new mongoose.Schema({
  phoneKey: String,
  status: String,
}, { strict: false });

const ReportConversationSchema = new mongoose.Schema({
  phoneKey: String,
  status: String,
}, { strict: false });

const SupportConversationSchema = new mongoose.Schema({
  phoneKey: String,
  status: String,
}, { strict: false });

const Lead = mongoose.models.Lead || mongoose.model('Lead', LeadSchema);
const SalesConversation = mongoose.models.SalesConversation || mongoose.model('SalesConversation', SalesConversationSchema, 'salesconversations');
const BookingConversation = mongoose.models.BookingConversation || mongoose.model('BookingConversation', BookingConversationSchema, 'bookingconversations');
const ReportConversation = mongoose.models.ReportConversation || mongoose.model('ReportConversation', ReportConversationSchema, 'reportconversations');
const SupportConversation = mongoose.models.SupportConversation || mongoose.model('SupportConversation', SupportConversationSchema, 'supportconversations');

// Same last-10-digits normalization as lib/phone.ts's phoneDedupeKey, kept
// inline for the same reason as the schemas above.
function phoneDedupeKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < 8) return null;
  return digits.slice(-10);
}

type LeadAgent = 'NONE' | 'SALES' | 'DEMO' | 'IN_HOUSE' | 'HUMAN';
type LeadStage =
  | 'NEW' | 'QUALIFYING' | 'NURTURING' | 'DEMO_REQUESTED' | 'DEMO_SCHEDULED'
  | 'DEMO_COMPLETED' | 'CONVERSION_PENDING' | 'PAYMENT_VERIFIED' | 'CUSTOMER'
  | 'COLD' | 'UNRESPONSIVE' | 'LONG_TERM_NURTURE' | 'LOST' | 'DO_NOT_CONTACT'
  | 'HUMAN_HANDOFF';

interface Mapping {
  agent: LeadAgent;
  stage: LeadStage;
  matchedCollection: string | null;
}

async function computeMapping(phoneKey: string): Promise<Mapping> {
  const activeSales = await SalesConversation.findOne({ phoneKey, status: 'active' }).select('_id').lean();
  if (activeSales) return { agent: 'SALES', stage: 'NURTURING', matchedCollection: 'SalesConversation' };

  const activeBooking = await BookingConversation.findOne({ phoneKey, status: 'active' }).select('_id').lean();
  if (activeBooking) return { agent: 'DEMO', stage: 'DEMO_REQUESTED', matchedCollection: 'BookingConversation' };

  const activeReport = await ReportConversation.findOne({ phoneKey, status: { $ne: 'stopped' } }).select('_id').lean();
  if (activeReport) return { agent: 'DEMO', stage: 'QUALIFYING', matchedCollection: 'ReportConversation' };

  const activeSupport = await SupportConversation.findOne({ phoneKey, status: 'active' }).select('_id').lean();
  if (activeSupport) return { agent: 'IN_HOUSE', stage: 'CUSTOMER', matchedCollection: 'SupportConversation' };

  return { agent: 'NONE', stage: 'NEW', matchedCollection: null };
}

async function run() {
  try {
    console.log(`Connecting to MongoDB...${DRY_RUN ? ' (--dry-run: no writes will be made)' : ''}`);
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected.');

    const leads = await Lead.find({}, { _id: 1, phone: 1, currentAgent: 1, currentStage: 1 }).lean();
    console.log(`Found ${leads.length} Lead document(s).`);

    let matched = 0;
    let updated = 0;
    let skippedNoPhone = 0;

    for (const lead of leads as any[]) {
      const key = phoneDedupeKey(lead.phone);
      if (!key) {
        skippedNoPhone++;
        continue;
      }

      const { agent, stage, matchedCollection } = await computeMapping(key);
      if (matchedCollection) matched++;

      const changed = lead.currentAgent !== agent || lead.currentStage !== stage;
      console.log(
        `Lead ${lead._id} (${lead.phone}) -> currentAgent=${agent}, currentStage=${stage}` +
        `${matchedCollection ? ` [matched ${matchedCollection}]` : ' [no active conversation]'}` +
        `${changed ? '' : ' (unchanged)'}`
      );

      if (changed && !DRY_RUN) {
        await Lead.updateOne({ _id: lead._id }, { $set: { currentAgent: agent, currentStage: stage } });
        updated++;
      } else if (changed) {
        updated++; // count what WOULD be updated, for the dry-run summary
      }
    }

    console.log('');
    console.log(`Backfill ${DRY_RUN ? 'dry-run ' : ''}complete.`);
    console.log(`  Leads scanned:                 ${leads.length}`);
    console.log(`  Skipped (no usable phone):     ${skippedNoPhone}`);
    console.log(`  Matched an active conversation: ${matched}`);
    console.log(`  ${DRY_RUN ? 'Would be updated' : 'Updated'}:                      ${updated}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  }
}

run();
