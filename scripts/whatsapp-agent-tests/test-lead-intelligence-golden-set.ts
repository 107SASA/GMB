/**
 * Golden-set test for extractLeadIntelligence — runs 15 sample inbound
 * messages against the REAL Groq extraction call (no mocking) and checks the
 * result against expected intent / objection-type / score_signal. Per the
 * task's definition of done, at least 12/15 must match before this phase is
 * considered verified.
 *
 * Needs a live MONGODB_URI and GROQ_API_KEY (loaded from .env.local, same as
 * the other scripts in this repo) since extractLeadIntelligence reads/writes
 * a real Lead document. Creates one disposable test Lead, runs all 15 cases
 * against it sequentially (each case resets the Lead's intent/objections/
 * score first so cases don't bleed into each other), then deletes it.
 *
 * Run: npx tsx scripts/whatsapp-agent-tests/test-lead-intelligence-golden-set.ts
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  });
}

interface GoldenCase {
  name: string;
  message: string;
  history?: { role: 'lead' | 'agent'; text: string }[];
  expectedIntent?: string; // checked loosely — see matches() below
  expectedObjectionType?: string | null; // null = expect no objection
  expectedScoreSignal?: string; // 'NONE' allowed
}

const CASES: GoldenCase[] = [
  {
    name: 'Pricing question',
    message: 'How much does this cost per month?',
    expectedIntent: 'SOLUTION_AWARE',
    expectedObjectionType: null,
    expectedScoreSignal: 'PRICING_QUESTION',
  },
  {
    name: 'Price objection',
    message: 'That seems really expensive for what we get, honestly.',
    expectedObjectionType: 'PRICE',
  },
  {
    name: 'Decision-maker objection',
    message: "I'll need to check with my business partner before deciding anything.",
    expectedObjectionType: 'DECISION_MAKER',
  },
  {
    name: 'Timing objection',
    message: "Can we revisit this in a couple months? Not the right time right now.",
    expectedObjectionType: 'TIMING',
  },
  {
    name: 'Trust objection',
    message: "I've never heard of your company before, how do I know this actually works?",
    expectedObjectionType: 'TRUST',
  },
  {
    name: 'Feature-gap objection',
    message: "Does this integrate with Zoho? If not that's a dealbreaker for us.",
    expectedObjectionType: 'FEATURE_GAP',
  },
  {
    name: 'General small talk / exploring',
    message: 'Hey, just saw your ad, what exactly do you guys do?',
    expectedIntent: 'EXPLORING',
    expectedObjectionType: null,
  },
  {
    name: 'Purchase intent / ready to buy',
    message: "Okay I'm convinced, how do I sign up and pay right now?",
    expectedIntent: 'READY_TO_BUY',
    expectedObjectionType: null,
    expectedScoreSignal: 'PURCHASE_INTENT',
  },
  {
    name: 'Demo request',
    message: 'Can you show me a live demo of how this works for my business?',
    expectedIntent: 'DEMO_INTEREST',
    expectedObjectionType: null,
    expectedScoreSignal: 'DEMO_REQUESTED',
  },
  {
    name: 'Explicit rejection',
    message: "Not interested, please stop messaging me.",
    expectedIntent: 'NOT_INTERESTED',
    expectedScoreSignal: 'EXPLICIT_REJECTION',
  },
  {
    name: 'Business info provided',
    message: "We're a 3-location restaurant chain in Pune, mainly struggling with getting Google reviews.",
    expectedObjectionType: null,
    expectedScoreSignal: 'BUSINESS_INFO_PROVIDED',
  },
  {
    name: 'Implementation question',
    message: "How long does setup take and do I need any technical knowledge to get started?",
    expectedObjectionType: null,
    expectedScoreSignal: 'IMPLEMENTATION_QUESTION',
  },
  {
    name: 'Product question',
    message: "What exactly does the review automation feature do?",
    expectedObjectionType: null,
    expectedScoreSignal: 'PRODUCT_QUESTION',
  },
  {
    name: 'Learning / problem-aware',
    message: "Our Google ranking has been dropping and I don't really understand why.",
    expectedIntent: 'PROBLEM_AWARE',
    expectedObjectionType: null,
  },
  {
    name: 'Bare acknowledgment (no real signal)',
    message: 'ok',
    expectedObjectionType: null,
    expectedScoreSignal: 'NONE',
  },
];

function matches(actual: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined) return true; // not asserted for this case
  return actual === expected;
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const dbConnect = (await import('../../src/lib/mongodb')).default;
  await dbConnect();
  const { default: Lead } = await import('../../src/models/Lead');
  const { extractLeadIntelligence } = await import('../../src/services/leadIntelligence/extract');

  const testLead = await Lead.create({
    tenantId: 'test-golden-set',
    name: 'Golden Set Test Lead',
    phone: '+910000000000',
    source: 'Manual',
    leadType: 'Platform Prospect',
  });

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  try {
    for (const c of CASES) {
      // Reset state between cases so one case's objections/intent don't
      // leak into the next case's assertions.
      testLead.intent = 'EXPLORING';
      testLead.objections = [];
      testLead.leadScore = 0;
      await testLead.save();

      const result = await extractLeadIntelligence(testLead._id, c.message, c.history || []);

      if (!result) {
        failed++;
        failures.push(`${c.name}: extraction returned null (Groq call failed)`);
        console.error(`  FAIL - ${c.name} (null result)`);
        continue;
      }

      const actualObjectionType = result.objections?.[0]?.type ?? null;
      const okIntent = matches(result.intent, c.expectedIntent);
      const okObjection =
        c.expectedObjectionType === undefined
          ? true
          : c.expectedObjectionType === null
            ? !result.objections?.length
            : actualObjectionType === c.expectedObjectionType;
      const okSignal = matches(result.score_signal, c.expectedScoreSignal);

      const ok = okIntent && okObjection && okSignal;
      if (ok) {
        passed++;
        console.log(`  ok   - ${c.name}  (intent=${result.intent}, objection=${actualObjectionType}, signal=${result.score_signal})`);
      } else {
        failed++;
        const detail =
          `intent=${result.intent}${okIntent ? '' : ` (expected ${c.expectedIntent})`}, ` +
          `objection=${actualObjectionType}${okObjection ? '' : ` (expected ${c.expectedObjectionType})`}, ` +
          `signal=${result.score_signal}${okSignal ? '' : ` (expected ${c.expectedScoreSignal})`}`;
        failures.push(`${c.name}: ${detail}`);
        console.error(`  FAIL - ${c.name}  (${detail})`);
      }
    }
  } finally {
    await Lead.deleteOne({ _id: testLead._id });
  }

  console.log(`\n${passed}/${CASES.length} passed (need >= 12/15 per definition of done)\n`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }

  await mongoose.disconnect();
  process.exit(passed >= 12 ? 0 : 1);
}

run().catch((e) => {
  console.error('Golden-set run failed:', e);
  process.exit(1);
});
