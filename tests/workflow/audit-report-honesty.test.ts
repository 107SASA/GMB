/**
 * Phase 4 of the free report rebuild (docs/FREE_REPORT_REBUILD_PLAN.md):
 * numbers and issues shown only when they are true. Cases from the 22 free
 * reports checked in Nov 2026.
 *
 * Run: npx tsx --test tests/workflow/audit-report-honesty.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBookingLink } from '../../src/services/intel/websiteExtract';
import { calculateBusinessIntelligence } from '../../src/services/audit/seoAnalyzer';

test('a Facebook or WhatsApp link is not a booking page (10 of 22 reports said it was)', () => {
  assert.equal(isBookingLink('https://www.facebook.com/zuperled', 'Facebook'), false);
  assert.equal(isBookingLink('https://www.facebook.com/sharer/sharer.php?u=x', 'Share'), false);
  assert.equal(isBookingLink('https://wa.me/919999999999', 'Book on WhatsApp'), false);
  assert.equal(isBookingLink('https://api.whatsapp.com/send?phone=91999', 'Chat'), false);
  assert.equal(isBookingLink('https://example.com/ebook-download', 'Free ebook'), false);
  assert.equal(isBookingLink('https://example.com/notebooks', 'Notebooks'), false);
});

test('real booking links still count', () => {
  assert.equal(isBookingLink('https://example.com/book-now', 'Book now'), true);
  assert.equal(isBookingLink('https://example.com/booking', ''), true);
  assert.equal(isBookingLink('https://example.com/contact', 'Book an appointment'), true);
  assert.equal(isBookingLink('https://calendly.com/inspiron/session', 'Schedule'), true);
  assert.equal(isBookingLink('https://www.practo.com/bangalore/clinic/x', 'Practo'), true);
  assert.equal(isBookingLink('mailto:a@b.com', 'Book'), false);
});

test('no review gap from a single competitor (Hula Global showed 171 next to "not enough data")', () => {
  const one = calculateBusinessIntelligence({}, [{ reviewCount: 242 }], 71, null, 1);
  assert.equal(one.reviewGap, 0);
  assert.match(one.reviewGapImpact, /Not enough competitor review data/);
  const two = calculateBusinessIntelligence({}, [{ reviewCount: 100 }, { reviewCount: 120 }], 71, null, 2);
  assert.equal(two.reviewGap, 39);
});
