import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';

const seoUpdateSchema = z.object({
  description: z.string().max(750, 'Description must be 750 characters or fewer'),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const { id } = await params;
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

    const isOwner = business.userId?.toString() === auth.userId;
    const isOrgMember =
      auth.user.organizationId &&
      business.organizationId?.toString() === auth.user.organizationId?.toString();
    const isSuperAdmin = auth.user.role === 'SUPER_ADMIN';
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isOwner && !isOrgMember && !isSuperAdmin && !isDev) {
      return NextResponse.json({ error: 'Unauthorized to modify this business' }, { status: 403 });
    }

    business.description = parsed.data.description;
    await business.save();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to save SEO description:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
