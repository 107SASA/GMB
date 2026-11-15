/**
 * Editing / deleting a post that is already live on Google.
 *
 * Run with: node --experimental-strip-types --test tests/integration/live-post-edit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LivePostError,
  POST_NOT_LINKED_CODE,
  buildPostSummary,
  pushLivePostEdit,
  removeLivePost,
} from '../../src/services/content/livePost.ts';

const NAME = 'accounts/1/locations/2/localPosts/3';

test('summary is title + content, like at publish', () => {
  assert.equal(buildPostSummary({ title: 'Hi', content: 'Body' }), 'Hi\n\nBody');
  assert.equal(buildPostSummary({ content: 'Only body' }), 'Only body');
  assert.equal(buildPostSummary({ title: 'x', content: 'y'.repeat(2000) }).length, 1500);
});

test('a live post edit goes to Google with the new text', async () => {
  const calls: unknown[] = [];
  await pushLivePostEdit(
    { status: 'published', businessId: 'b1', gbpPostName: NAME, title: 'New', content: 'Text' },
    { updateLocalPost: async (...args) => { calls.push(args); return { liveWriteApplied: true }; } },
  );
  assert.deepEqual(calls, [['b1', NAME, { summary: 'New\n\nText' }]]);
});

test('a live post is removed from Google', async () => {
  const calls: unknown[] = [];
  await removeLivePost(
    { status: 'published', businessId: 'b1', gbpPostName: NAME },
    { deleteLocalPost: async (...args) => { calls.push(args); return { liveWriteApplied: true }; } },
  );
  assert.deepEqual(calls, [['b1', NAME]]);
});

test('drafts and scheduled posts never call Google', async () => {
  const never = async () => { throw new Error('called Google'); };
  await pushLivePostEdit({ status: 'scheduled', businessId: 'b1' }, { updateLocalPost: never });
  await removeLivePost({ status: 'draft', businessId: 'b1' }, { deleteLocalPost: never });
});

test('an older live post without a Google id is sent to Google by hand', async () => {
  await assert.rejects(
    removeLivePost({ status: 'published', businessId: 'b1' }, { deleteLocalPost: async () => ({ liveWriteApplied: true }) }),
    (err: unknown) => err instanceof LivePostError && err.code === POST_NOT_LINKED_CODE && err.status === 409,
  );
});

test('with Google writes off, nothing is changed', async () => {
  await assert.rejects(
    pushLivePostEdit(
      { status: 'published', businessId: 'b1', gbpPostName: NAME, content: 'x' },
      { updateLocalPost: async () => ({ liveWriteApplied: false }) },
    ),
    (err: unknown) => err instanceof LivePostError && err.code === 'LIVE_WRITES_OFF',
  );
});
