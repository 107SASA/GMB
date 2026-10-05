/**
 * Content / posting — no customer-facing manual batch generation (web + mobile),
 * read-only Content APIs, and the automatic weekly path intact.
 * Run: node --experimental-strip-types --test tests/integration/content-no-manual-generate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = `${dir}/${e.name}`;
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(rel);
  return /\.(tsx?|jsx?)$/.test(e.name) ? [rel] : [];
});

// Customer-facing UI on both platforms (super-admin pages are internal tools, not customer UI).
const UI = [
  ...walk('src/components'),
  ...walk('src/app/dashboard'),
  ...walk('mobile/src/app'),
  ...walk('mobile/src/components'),
  ...walk('mobile/src/api'),
  ...walk('mobile/src/lib'),
];

test('no customer UI (web or mobile) calls a batch / post generation endpoint', () => {
  for (const f of ['src/components/scheduler/SchedulerDashboard.tsx', 'src/components/scheduler/LowBufferBanner.tsx']) {
    assert.equal(fs.existsSync(path.join(ROOT, f)), false, `unmounted duplicate scheduler UI removed: ${f}`);
  }
  const hits = UI.filter((f) => /['"`]\/api\/(scheduler\/generate|content\/generate)['"`?]/.test(read(f)));
  assert.deepEqual(hits, [], `still calling a generate endpoint: ${hits.join(', ')}`);
});

test('no "Generate extra batch" / "Generate Posts" / "Generate more" / "Generate content" button text anywhere in the customer UI', () => {
  const pattern = /Generate extra batch|Generate more|>\s*Generate Posts|'Generate Posts'|'Generate content'|'Generate'\}|\? 'Generating…' : 'Generate'/;
  const hits = UI.filter((f) => pattern.test(read(f)));
  assert.deepEqual(hits, [], hits.join(', '));
  assert.doesNotMatch(read('src/components/content/ContentHistoryTab.tsx'), /Generate your first batch/, 'empty state no longer asks to generate');
  assert.doesNotMatch(read('mobile/src/components/scheduler-panel.tsx'), /Generate posts or schedule/);
});

test('the Content pages say the posts are automatic (exact wording, web + mobile)', () => {
  for (const f of ['src/components/content/ContentWorkspace.tsx', 'mobile/src/app/(app)/content/index.tsx']) {
    const s = read(f);
    assert.match(s, /Your weekly posts are generated automatically\./, f);
    assert.match(s, /4 posts are planned every week based on your SEO plan, business information, keywords, offers and relevant festivals/, f);
  }
});

test('opening Content never generates: every read API is free of generation / AI / dispatch calls', () => {
  const gen = /inngest\.send|generateWeeklyBatch|maybeStartContentAutopilot\(|groq|chat\.completions|generateImage|imageGenerator/i;
  for (const f of [
    'src/app/api/content/autopilot-status/route.ts',
    'src/app/api/scheduler/buffer/route.ts',
    'src/app/api/content/posts/route.ts',
    'src/app/api/content/posts/images/route.ts',
    'src/app/api/posts/route.ts',
  ]) {
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), gen, f);
  }
  // weekly-offer: GET only reads; the one dispatch is in POST (the owner answering the offer question).
  const wo = read('src/app/api/content/weekly-offer/route.ts');
  const get = wo.slice(wo.indexOf('export async function GET'), wo.indexOf('export async function POST'));
  assert.doesNotMatch(get, /inngest\.send|generateWeeklyBatch/);
});

test('web and mobile read the SAME posting state (same endpoints, no platform-specific posting logic)', () => {
  const web = read('src/components/content/ContentWorkspace.tsx')
    + read('src/components/content/ContentHistoryTab.tsx')
    + read('src/components/content/CreatePostForm.tsx');
  const mobile = read('mobile/src/api/endpoints/scheduler.ts')
    + read('mobile/src/api/endpoints/content.ts')
    + read('mobile/src/api/endpoints/weeklyOffer.ts')
    + read('mobile/src/app/(app)/posts/create.tsx');
  for (const ep of ['/api/scheduler/buffer', '/api/posts', '/api/scheduler/publish', '/api/scheduler/schedule', '/api/content/autopilot-status', '/api/content/weekly-offer']) {
    assert.ok(web.includes(ep), `web reads ${ep}`);
    assert.ok(mobile.includes(ep), `mobile reads ${ep}`);
  }
  // Mobile refetches that shared state on focus / app foreground (no stale copy, no duplicate records).
  assert.match(read('mobile/src/app/_layout.tsx'), /focusManager\.setFocused\(state === 'active'\)/);
  for (const f of ['mobile/src/app/(app)/content/index.tsx', 'mobile/src/app/(app)/scheduler/index.tsx', 'mobile/src/components/gbp/posts-tab.tsx']) {
    assert.match(read(f), /useRefreshContentOnFocus\(\)/, f);
  }
  assert.doesNotMatch(read('mobile/src/lib/useRefreshContentOnFocus.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /api\.post|mutate|generate/i, 'refresh hook only refetches');
});

test('automatic weekly path untouched: hourly autopilot cron registered; first-start triggers kept; batch stays idempotent per ISO week', () => {
  const fns = read('src/services/inngest/functions.ts');
  assert.match(fns, /export const weeklyContentAutopilot = inngest\.createFunction\(\s*\{ id: "weekly-content-autopilot", triggers: \[\{ cron: "0 \* \* \* \*" \}\] \}/);
  assert.match(read('src/app/api/inngest/route.ts'), /weeklyContentAutopilot/);
  for (const f of ['src/lib/gbpConnect.ts', 'src/lib/billing/applyEntitlements.ts', 'src/app/api/onboarding/intake/route.ts']) {
    assert.match(read(f), /maybeStartContentAutopilot\(/, `${f} still starts autopilot when the business qualifies`);
  }
  assert.match(read('src/lib/contentAutopilot.ts'), /autopilotNextRunAt: \{ \$exists: false \}/, 'first start is an atomic one-time claim');
  assert.match(read('src/services/content/weeklyBatch.ts'), /'<ISO week>' for autopilot \(idempotent\)/);
});
