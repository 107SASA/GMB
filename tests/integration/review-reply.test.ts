/**
 * Review reply fact / policy / quality gate — pure rules.
 * Run: node --experimental-strip-types --test tests/integration/review-reply.test.ts
 * The workflow cases (auto-publish off by default, owner approval, draft on
 * failure, publish on success) run against a database in scripts/review-reply-check.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReply, type ReplyEvidence } from '../../src/services/reviews/validateReply.ts';

const ev: ReplyEvidence = {
  businessName: 'Sahyadri Tile Works',
  category: 'Tile contractor',
  places: ['Nashik', 'Gangapur Road'],
  services: ['Tile installation', 'Bathroom renovation', 'Kitchen tiling', 'Tile contractor'],
  factsText: 'Business: Sahyadri Tile Works | Category: Tile contractor | Location: Gangapur Road, Nashik | Services: Tile installation, Bathroom renovation, Kitchen tiling',
  keywords: ['bathroom renovation nashik', 'tile contractor nashik', 'floor tiles nashik'],
};
const positive = { text: 'Ramesh and his team did a neat job on our bathroom tiles. Finished on time and cleaned up after.', rating: 5, reviewer: 'Priya Kulkarni' };
const negative = { text: 'The kitchen tiling started two days late and nobody called to tell us. Grout is already cracking.', rating: 2, reviewer: 'Amit Shah' };
const bare = { text: 'Good', rating: 4, reviewer: 'A Google User' };
const expectFail = (reply: string, review: typeof positive, re: RegExp) => {
  const r = validateReply(reply, review, ev);
  assert.equal(r.ok, false, `should fail: ${reply}`);
  assert.ok(r.reasons.some((x) => re.test(x)), `${re} not in: ${r.reasons.join(' | ')}`);
};

test('genuine positive review: a specific, factual thank-you passes', () => {
  const r = validateReply('Thank you, Priya! We are glad the bathroom tiles turned out neat and that Ramesh and the team kept to time and cleaned up. — The Sahyadri Tile Works Team', positive, ev);
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test('genuine negative review: specific acknowledgement + invitation passes; claiming it was fixed fails', () => {
  const ok = validateReply('Amit, we are sorry the kitchen tiling started late without a call from us, and that the grout is cracking. Please contact us directly so we can look into this with you. — The Sahyadri Tile Works Team', negative, ev);
  assert.deepEqual(ok, { ok: true, reasons: [] });
  expectFail('Amit, sorry about the kitchen tiling delay. We have already fixed the grout and the issue has been resolved.', negative, /done or resolved/);
  expectFail('Amit, we are thrilled you loved the kitchen tiling!', negative, /celebratory/);
});

test('review mentioning a specific service: reply may name it (it is verified)', () => {
  const r = validateReply('Thanks Priya — bathroom renovation work like this is what we enjoy most, and we are glad the tiles came out neat. — The Sahyadri Tile Works Team', positive, ev);
  assert.equal(r.ok, true, r.reasons.join(' | '));
});

test('review with no useful business information: a short thanks passes; invented details fail', () => {
  assert.equal(validateReply('Thank you for the rating and for taking the time to leave a review. — The Sahyadri Tile Works Team', bare, ev).ok, true);
  expectFail('Thank you! We loved working on your marble flooring project last month as a loyal customer of 5 years.', bare, /reviewer|years of experience|service/);
  expectFail('Thank you for your feedback! If you need tile installation or bathroom renovation in Nashik, let us know.', bare, /review with no details/);
});

test('keyword pasted verbatim is rejected; written as English it passes', () => {
  expectFail('Thanks Priya! We are delighted with your bathroom renovation nashik and glad the tiles look neat.', positive, /pasted verbatim/);
  assert.equal(validateReply('Thanks Priya! We are delighted with your bathroom renovation in Nashik and glad the tiles look neat.', positive, ev).ok, true);
});

test('AI hallucinating a service is rejected', () => {
  expectFail('Thank you Priya! We also offer swimming pool construction and roofing if you ever need it. — The Team', positive, /service not in the verified/);
});

test('AI inventing an offer / price is rejected', () => {
  expectFail('Thanks Priya for the kind words about the bathroom tiles! Enjoy 20% off your next project with us.', positive, /percentage|offer/);
  expectFail('Thanks Priya, glad the bathroom tiles look neat. Next time ask for our free consultation!', positive, /offer \/ discount/);
});

test('keyword stuffing is rejected', () => {
  expectFail('Thanks Priya! As a bathroom renovation nashik expert, our bathroom renovation nashik team loves bathroom renovation nashik jobs and tile contractor nashik work.', positive, /keyword repeated|too many SEO keywords/);
  expectFail('Thanks Priya for the bathroom tiles review — tile contractor nashik, floor tiles nashik, bathroom renovation nashik.', positive, /too many SEO keywords/);
});

test('unsupported location is rejected; verified location passes', () => {
  expectFail('Thanks Priya! Glad the bathroom tiles came out neat. Visit our branch in Pune any time.', positive, /location not verified|branches/);
  expectFail('Thanks Priya, we are glad the tiles look neat! We are based in Mumbai.', positive, /location not verified/);
  assert.equal(validateReply('Thanks Priya, glad the bathroom tiles came out neat. We are based in Nashik. — The Sahyadri Tile Works Team', positive, ev).ok, true);
});

test('ranking promises, competitor claims and sales pitches are rejected', () => {
  expectFail('Thanks Priya! Reviews like yours help us rank higher on Google search for bathroom tiles.', positive, /rankings/);
  expectFail('Thanks Priya, glad the bathroom tiles are neat — unlike other companies, we clean up.', positive, /competitor/);
  expectFail('Thanks Priya for the bathroom tiles review! Call now to book your next job.', positive, /promotional/);
  expectFail('Thanks Priya for the bathroom tiles review — we are the best tile contractor in Nashik.', positive, /superlative/);
});

test('generic SEO paragraph that ignores the review is rejected', () => {
  expectFail('Thank you for choosing us. We provide tile installation for homes and offices with a focus on durable finishes. — The Team', { ...positive, reviewer: '' }, /generic reply/);
});

test('reviewer\'s own words may be echoed (their claim, not ours)', () => {
  const review = { text: 'Best tile contractor we have used — five star work on the kitchen tiling.', rating: 5, reviewer: 'Neha' };
  assert.equal(validateReply('Thank you, Neha — being called the best tile contractor you have used means a lot, and we are glad the kitchen tiling came out well.', review, ev).ok, true);
});

test('placeholders and empty replies are rejected', () => {
  expectFail('Thanks [Customer Name] for the bathroom tiles review!', positive, /placeholder/);
  assert.equal(validateReply('', positive, ev).ok, false);
});
