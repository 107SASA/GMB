/**
 * The text read from a Twilio Content template, per content type — so a Card
 * template (photo/video + buttons) shows its message in the templates list,
 * the Leads send preview and the lead's history.
 *
 * Run: npx tsx --test tests/workflow/whatsapp-template-body.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyOf } from '../../src/services/twilio/contentTemplates.ts';

test('a plain text / quick-reply / media template reads its body', () => {
  assert.equal(bodyOf({ 'twilio/text': { body: 'Hi {{1}}' } }), 'Hi {{1}}');
  assert.equal(bodyOf({ 'twilio/quick-reply': { body: 'Tap below', actions: [] } }), 'Tap below');
  assert.equal(bodyOf({ 'twilio/media': { body: 'See the photo', media: ['https://x/y.jpg'] } }), 'See the photo');
});

test('a card template reads its title, with the subtitle as the footer', () => {
  const types = {
    'twilio/card': {
      title: 'Thank you for visiting *Growwmatics AI*',
      subtitle: 'Team Growwmatics AI',
      media: ['https://x/y.jpg'],
      actions: [{ type: 'QUICK_REPLY', title: 'Book a Demo', id: 'book a demo' }],
    },
  };
  assert.equal(bodyOf(types), 'Thank you for visiting *Growwmatics AI*\n\nTeam Growwmatics AI');
  assert.equal(bodyOf({ 'twilio/card': { title: 'Only a title' } }), 'Only a title');
});

test('a body wins over a card title, and nothing usable reads as empty', () => {
  assert.equal(bodyOf({ 'twilio/card': { title: 'Card' }, 'twilio/text': { body: 'Text' } }), 'Text');
  assert.equal(bodyOf({ 'twilio/card': { title: '  ' } }), '');
  assert.equal(bodyOf(undefined), '');
});
