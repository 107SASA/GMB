import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';
import { listCategoryAttributes, readLocationAttributes } from '@/lib/gbpClient';
import { planAttributeBatch } from '@/services/gbp/changes/policy';
import { createChange, locationIdFor, ProposalConflictError } from '@/services/gbp/changes/store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  clientRequestId: z.string().trim().min(8).max(80),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    value: z.unknown(),
  })).min(1).max(20),
});

/**
 * One proposal per selected attribute. Invalid rows are not stored.
 * Nothing in this route is approved or sent to Google.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid attribute selection.', liveWriteApplied: false }, { status: 400 });
  }
  const locationId = await locationIdFor(ctx.businessId);
  if (!locationId) {
    return NextResponse.json({ success: false, error: 'Google Business Profile is not connected.', liveWriteApplied: false }, { status: 400 });
  }

  let current: Array<{ name?: string }> = [];
  try {
    const attrs = await readLocationAttributes(ctx.businessId);
    current = Array.isArray(attrs?.attributes) ? attrs.attributes : [];
  } catch {
    return NextResponse.json({ success: false, error: 'Could not read the current Google value.', liveWriteApplied: false }, { status: 502 });
  }

  const snap = await GbpLocationSnapshot.findOne({ businessId: ctx.businessId })
    .select('sections.location.data.primaryCategory.name sections.location.data.address.regionCode')
    .lean();
  const categoryName = (snap as { sections?: { location?: { data?: { primaryCategory?: { name?: string }; address?: { regionCode?: string } } } } })?.sections?.location?.data?.primaryCategory?.name || '';
  const region = (snap as { sections?: { location?: { data?: { address?: { regionCode?: string } } } } })?.sections?.location?.data?.address?.regionCode || 'IN';
  const catalog = categoryName ? await listCategoryAttributes(ctx.businessId, categoryName, region).catch(() => null) : null;
  const planned = planAttributeBatch(catalog, parsed.data.items);

  const results = [];
  for (const row of planned.results) {
    if (!row.valid || !row.attribute) {
      results.push({ name: row.name, stored: false, status: null, changeId: null, violations: row.violations, error: row.violations[0]?.message || 'This attribute was not stored.' });
      continue;
    }
    const before = current.find((item) => item.name === row.name) || null;
    try {
      const doc = await createChange({
        businessId: ctx.businessId,
        organizationId: ctx.organizationId,
        locationId,
        kind: 'attribute',
        fields: ['attribute'],
        source: 'owner',
        before,
        proposed: { name: row.name, attribute: row.attribute },
        validation: { valid: true, violations: [] },
        requestedBy: ctx.userId,
        clientRequestId: `${parsed.data.clientRequestId}:${row.name}`,
      });
      const stored = doc.status !== 'BLOCKED' && doc.status !== 'FAILED';
      results.push({
        name: row.name,
        stored,
        status: doc.status,
        changeId: doc._id.toString(),
        violations: doc.validation?.violations || [],
        error: stored ? null : doc.error || 'This attribute was not stored as a proposal.',
      });
    } catch (err) {
      const message = err instanceof ProposalConflictError
        ? err.message
        : 'This attribute could not be stored.';
      results.push({ name: row.name, stored: false, status: null, changeId: null, violations: [], error: message });
    }
  }

  const success = results.length > 0 && results.every((row) => row.stored);
  return NextResponse.json({ success, liveWriteApplied: false, results });
}
