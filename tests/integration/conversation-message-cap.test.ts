/**
 * Sales-thread pre('save') must survive Mongoose 9's middleware call shape.
 * SalesConversation (and the other WhatsApp thread models) register this hook
 * via applyConversationMessageCap. Mongoose invokes it as
 * fn.apply(document, [saveOptions]) — there is no next callback. Calling the
 * first argument used to throw and abort SalesConversation.create inside
 * prepare-nurture.
 *
 * Run with: node --experimental-strip-types --test tests/integration/conversation-message-cap.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose, { type Document } from 'mongoose';
import {
  applyConversationMessageCap,
  CONVERSATION_MESSAGE_CAP,
} from '../../src/models/shared/conversationMessageCap.ts';

const SLACK = 100;

const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['agent', 'lead'], required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SalesThreadSchema = new mongoose.Schema(
  {
    messages: { type: [MessageSchema], default: [] },
  },
  { timestamps: true }
);
applyConversationMessageCap(SalesThreadSchema);

const SalesThread =
  mongoose.models.SalesThreadCapTest ||
  mongoose.model('SalesThreadCapTest', SalesThreadSchema);

type SaveHookRunner = {
  s: {
    hooks: {
      execPre: (name: string, context: unknown, args: unknown[]) => Promise<unknown>;
    };
  };
};

function message(i: number) {
  return { role: 'agent' as const, text: `m${i}`, at: new Date('2026-10-03T18:00:00Z') };
}

function thread(count: number) {
  return new SalesThread({
    messages: Array.from({ length: count }, (_, i) => message(i)),
  });
}

/** Same call Mongoose 9 uses: pre('save') gets save options, not next. */
async function runPreSave(doc: Document) {
  const options = { timestamps: true };
  const schema = SalesThread.schema as unknown as SaveHookRunner;
  await schema.s.hooks.execPre('save', doc, [options]);
  return options;
}

test('sales-thread pre(save) accepts Mongoose 9 save options and does not call them', async () => {
  const doc = thread(3);
  const options = await runPreSave(doc);
  assert.equal(doc.get('messages').length, 3);
  assert.equal(typeof options, 'object');
});

test('messages at or under the cap plus slack are left untouched', async () => {
  const doc = thread(CONVERSATION_MESSAGE_CAP + SLACK);
  let sets = 0;
  const original = doc.set.bind(doc);
  doc.set = ((...args: unknown[]) => {
    sets += 1;
    return original(...(args as Parameters<typeof original>));
  }) as typeof doc.set;

  await runPreSave(doc);

  assert.equal(sets, 0);
  assert.equal(doc.get('messages').length, CONVERSATION_MESSAGE_CAP + SLACK);
  assert.equal(doc.get('messages')[0].text, 'm0');
});

test('messages past the cap plus slack keep only the newest cap entries', async () => {
  const count = CONVERSATION_MESSAGE_CAP + SLACK + 1;
  const doc = thread(count);
  await runPreSave(doc);
  const messages = doc.get('messages') as { text: string }[];
  assert.equal(messages.length, CONVERSATION_MESSAGE_CAP);
  assert.equal(messages[0].text, `m${count - CONVERSATION_MESSAGE_CAP}`);
  assert.equal(messages[messages.length - 1].text, `m${count - 1}`);
});
