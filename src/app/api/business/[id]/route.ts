import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const body = await request.json();

    await dbConnect();

    // Verify ownership
    const business = await Business.findById(id);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const isOwner = business.userId?.toString() === auth.userId;
    const isOrgMember = auth.user.organizationId && business.organizationId?.toString() === auth.user.organizationId?.toString();
    const isSuperAdmin = auth.user.role === 'SUPER_ADMIN';
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isOwner && !isOrgMember && !isSuperAdmin && !isDev) {
      console.warn(`[AUTH FAILED] User ${auth.userId} tried to access Business ${id}. Business UserId: ${business.userId}, OrgId: ${business.organizationId}`);
      return NextResponse.json({ error: 'Unauthorized to modify this business' }, { status: 403 });
    }

    // Update allowed fields
    if (body.userDefinedCategory !== undefined) {
      business.userDefinedCategory = body.userDefinedCategory;
    }
    if (body.googlePlaceId !== undefined) {
      business.googlePlaceId = body.googlePlaceId;
    }

    await business.save();

    return NextResponse.json({ success: true, business });
  } catch (error: any) {
    console.error('Failed to update business:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
