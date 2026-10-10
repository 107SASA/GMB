/**
 * Open-proposal key plan shared by the migration and the read-only diagnostic. Pure.
 * Run: node --experimental-strip-types --test tests/integration/fr5-open-proposal-plan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyIntegrity, planOpenProposalKeys, recordKey, type PlanRecord } from '../../scripts/open-proposal-plan.ts';
import { canonicalFingerprint } from '../../src/services/gbp/changes/policy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
let seq = 0;
const hexId = () => `6a${String(++seq).padStart(22, '0')}`;
const rec = (over: Partial<PlanRecord> & { proposed: unknown }): PlanRecord => ({
  id: hexId(),
  businessId: 'b1',
  kind: 'description',
  status: 'PROPOSED',
  createdAt: '2026-10-01T00:00:00.000Z',
  beforeFingerprint: canonicalFingerprint('description', 'Old.'),
  openKey: null,
  source: 'owner',
  ...over,
});
const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute)).toISOString();

// Shaped like the production dry run: 11 unkeyed open proposals (5 APPROVED, 6
// PROPOSED), one APPROVED record already keyed by the app.
function productionShape() {
  const holder = rec({ proposed: 'G1', status: 'APPROVED', createdAt: at(50), source: 'recommendation' });
  holder.openKey = recordKey(holder);
  const candidates = [
    rec({ proposed: 'G1', status: 'PROPOSED', createdAt: at(1) }),
    rec({ proposed: 'G2', status: 'APPROVED', createdAt: at(2) }),
    rec({ proposed: 'G2', status: 'PROPOSED', createdAt: at(3) }),
    rec({ proposed: 'G2', status: 'PROPOSED', createdAt: at(4) }),
    rec({ proposed: 'G3', status: 'APPROVED', createdAt: at(5) }),
    rec({ proposed: 'G3', status: 'PROPOSED', createdAt: at(6) }),
    rec({ proposed: 'G4', status: 'APPROVED', createdAt: at(7) }),
    rec({ proposed: 'G4', status: 'APPROVED', createdAt: at(8) }),
    rec({ proposed: 'G5', status: 'PROPOSED', createdAt: at(9) }),
    rec({ proposed: 'G5', status: 'APPROVED', createdAt: at(10) }),
    rec({ proposed: 'G6', status: 'PROPOSED', createdAt: at(11) }),
  ];
  return { holder, candidates };
}

test('production-shaped data: 5 keyed, 6 left unchanged, 1 of them because the app already holds the key', () => {
  const { holder, candidates } = productionShape();
  assert.equal(candidates.filter((c) => c.status === 'APPROVED').length, 5);
  assert.equal(candidates.filter((c) => c.status === 'PROPOSED').length, 6);
  const plan = planOpenProposalKeys(candidates, [holder]);
  const by = (a: string) => plan.decisions.filter((d) => d.action === a);
  assert.equal(by('key').length, 5);
  assert.equal(by('duplicate').length, 5);
  assert.equal(by('held').length, 1);
  assert.equal(plan.decisions.length, candidates.length, 'every candidate gets exactly one decision');
  const held = by('held')[0] as { id: string; of: string };
  assert.equal(held.id, candidates[0].id);
  assert.equal(held.of, holder.id);
  const g1 = plan.groups.find((g) => g.members.some((m) => m.id === holder.id))!;
  assert.deepEqual(g1.members.map((m) => [m.id, m.keyed]), [[holder.id, true], [candidates[0].id, false]]);
});

test('the newest record of each identical group is the one keyed', () => {
  const { holder, candidates } = productionShape();
  const keyedIds = planOpenProposalKeys(candidates, [holder]).decisions.filter((d) => d.action === 'key').map((d) => d.id).sort();
  const expected = ['G2', 'G3', 'G4', 'G5', 'G6'].map((g) => candidates.filter((c) => c.proposed === g).sort((a, b) => Date.parse(b.createdAt!) - Date.parse(a.createdAt!))[0].id).sort();
  assert.deepEqual(keyedIds, expected);
});

test('the plan is deterministic: input order does not matter, equal timestamps fall back to _id', () => {
  const { holder, candidates } = productionShape();
  const a = planOpenProposalKeys(candidates, [holder]).decisions;
  const b = planOpenProposalKeys([...candidates].reverse(), [holder]).decisions;
  assert.deepEqual(new Map(a.map((d) => [d.id, d])), new Map(b.map((d) => [d.id, d])));
  const t1 = rec({ proposed: 'tie', createdAt: at(30) });
  const t2 = rec({ proposed: 'tie', createdAt: at(30) });
  const tie = planOpenProposalKeys([t1, t2], []).decisions;
  assert.equal(tie.find((d) => d.action === 'key')!.id, t2.id, 'higher _id wins a timestamp tie');
});

test('only unkeyed PROPOSED and APPROVED records are candidates; businesses never mix', () => {
  const closed = ['EXECUTING', 'BLOCKED', 'FAILED', 'VERIFIED', 'REVERTED', 'CONFLICT', 'UNRESOLVED', 'APPLIED'].map((status) => rec({ proposed: 'X', status }));
  const plan = planOpenProposalKeys([...closed, rec({ proposed: 'X', businessId: 'b1' }), rec({ proposed: 'X', businessId: 'b2' })], []);
  assert.equal(plan.decisions.length, 2);
  assert.equal(plan.decisions.every((d) => d.action === 'key'), true);
  const alreadyKeyed = rec({ proposed: 'Y' });
  alreadyKeyed.openKey = recordKey(alreadyKeyed);
  assert.equal(planOpenProposalKeys([alreadyKeyed], [alreadyKeyed]).decisions.length, 0);
});

test('key problems the index build depends on are detected', () => {
  const a = rec({ proposed: 'S' });
  const b = rec({ proposed: 'S' });
  a.openKey = recordKey(a);
  b.openKey = recordKey(b);
  const closed = rec({ proposed: 'C', status: 'BLOCKED' });
  closed.openKey = recordKey(closed);
  const wrong = rec({ proposed: 'W' });
  wrong.openKey = 'f'.repeat(64);
  const found = keyIntegrity([a, b, closed, wrong]);
  assert.deepEqual(found.sameKeyHeldTwice.map((g) => g.ids.sort()), [[a.id, b.id].sort()]);
  assert.deepEqual(found.closedButKeyed.map((r) => r.id), [closed.id]);
  assert.deepEqual(found.keyDoesNotMatchContent.map((r) => r.id), [wrong.id]);
  assert.deepEqual(keyIntegrity(productionShape().candidates), { sameKeyHeldTwice: [], closedButKeyed: [], keyDoesNotMatchContent: [] });
});

test('the diagnostic and the shared plan cannot write; the migration never deletes or rewrites', () => {
  const writes = /\.(updateOne|updateMany|insertOne|insertMany|deleteOne|deleteMany|replaceOne|bulkWrite|findOneAndUpdate|findOneAndReplace|findOneAndDelete|createIndex|createIndexes|dropIndex|dropIndexes|drop|rename)\(/;
  for (const file of ['scripts/fr5-open-proposal-diagnostic.ts', 'scripts/open-proposal-plan.ts']) {
    const src = readFileSync(join(root, file), 'utf8');
    assert.equal(writes.test(src), false, file);
    assert.equal(/mongodb-memory-server|readFileSync|dotenv/.test(src), false, file);
  }
  const plan = readFileSync(join(root, 'scripts/open-proposal-plan.ts'), 'utf8');
  assert.match(plan, /export type ReadOnlyCollection = Pick<import\('mongodb'\)\.Collection, 'find' \| 'aggregate' \| 'indexes'>;/);
  const migration = readFileSync(join(root, 'scripts/migrate-open-proposal-keys.ts'), 'utf8');
  assert.equal(/delete(One|Many)|replaceOne|findOneAnd|dropIndex|\$unset|syncIndexes/.test(migration), false);
  assert.deepEqual([...migration.matchAll(/\.(updateOne|createIndex)\(/g)].map((m) => m[1]).sort(), ['createIndex', 'updateOne']);
  assert.match(migration, /\{ \$set: \{ openKey: d\.key \} \}/);
});
