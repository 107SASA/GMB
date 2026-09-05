import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

const seoUpdateSchema = z.object({
  description: z.string().max(750, 'Description must be 750 characters or fewer'),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Single source of truth for "is this caller allowed to touch this
    // business" — no dev-environment bypass; see lib/tenant.ts. Previously
    // this route re-derived the same check by hand with its own
    // NODE_ENV!=='production' escape hatch, which meant ANY logged-in user
    // could edit ANY business's SEO description on the shared dev/QA
    // deployment real testers use — removed, not replaced.
    const ctx = await requireBusinessContext({ businessIdFromBody: id });
    if (!ctx.ok) return ctx.response;

    const body = await request.json();

    const parsed = seoUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    await dbConnect();

    const business = await Business.findById(id);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    business.description = parsed.data.description;
    await business.save();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to save SEO description:', error);
    return NextResponse.json({ error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}
