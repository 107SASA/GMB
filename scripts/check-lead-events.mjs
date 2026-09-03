/**
 * Read-only check: pull the last 20 LeadEvent rows for a given phone number,
 * to manually verify the event-timeline logging added in services/leadEvents.ts
 * is actually producing rows (LEAD_CREATED, MESSAGE_SENT, AGENT_HANDOFF,
 * NURTURE_ACTION_SCHEDULED, etc).
 *
 * Matches on BOTH `phone` and `leadId` linked to a Lead with this phone,
 * since most platform-agent events (sales/support/report) are phone-keyed
 * and have no leadId, while tenant-inbound and booked-demo events do.
 *
 * Run:
 *   MONGODB_URI="mongodb://..." node scripts/check-lead-events.mjs "+919876543210"
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
  process.exit(1);
}

const phoneArg = process.argv[2];
if (!phoneArg) {
  console.error('Usage: MONGODB_URI="..." node scripts/check-lead-events.mjs "<phone>"');
  console.error('Example: node scripts/check-lead-events.mjs "+919876543210"');
  process.exit(1);
}

// Last-10-digits key, same normalization idea as lib/phone.ts's phoneDedupeKey
// — lets a caller pass the number in any of the shapes it might be stored in
// (with/without '+', with/without a leading 0) and still match.
function last10(phone) {
  const digits = String(phone).replace(/[^\d]/g, '');
  return digits.slice(-10);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const leadEvents = db.collection('leadevents');
  const leads = db.collection('leads');

  const key = last10(phoneArg);
  const phoneRegex = new RegExp(`${key}$`); // matches any stored variant ending in these digits

  // A phone may also be attached to one or more Lead docs (tenant path,
  // booked demos) — pull those in too so the timeline is complete even for
  // events that only carry leadId, not phone.
  const matchingLeads = await leads.find({ phone: phoneRegex }).project({ _id: 1, phone: 1, name: 1 }).toArray();
  const leadIds = matchingLeads.map((l) => l._id);

  const query = {
    $or: [
      { phone: phoneRegex },
      ...(leadIds.length ? [{ leadId: { $in: leadIds } }] : []),
    ],
  };

  const events = await leadEvents
    .find(query)
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  console.log(`Phone: ${phoneArg} (matched on last 10 digits: ${key})`);
  if (matchingLeads.length) {
    console.log(`Linked Lead(s): ${matchingLeads.map((l) => `${l._id} (${l.name || 'no name'})`).join(', ')}`);
  } else {
    console.log('No Lead document found for this phone yet.');
  }
  console.log(`\nLast ${events.length} LeadEvent row(s), most recent first:\n`);

  if (!events.length) {
    console.log('(none found — either nothing has happened yet, or the phone/format doesn\'t match)');
  } else {
    for (const e of events) {
      console.log(
        `[${e.createdAt.toISOString()}] ${e.type}  actor=${e.actor}  ` +
        `conversationType=${e.conversationType ?? '-'}  leadId=${e.leadId ?? '-'}`
      );
      if (e.payload) console.log(`    payload: ${JSON.stringify(e.payload)}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
