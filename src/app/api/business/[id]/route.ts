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
    const isOrgMember =
      auth.user.organizationId &&
      business.organizationId?.toString() === auth.user.organizationId?.toString();
    const isSuperAdmin = auth.user.role === 'SUPER_ADMIN';
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isOwner && !isOrgMember && !isSuperAdmin && !isDev) {
      console.warn(
        `[AUTH FAILED] User ${auth.userId} tried to access Business ${id}. Business UserId: ${business.userId}, OrgId: ${business.organizationId}`
      );
      return NextResponse.json({ error: 'Unauthorized to modify this business' }, { status: 403 });
    }

    // --- Scalar fields ---
    if (body.userDefinedCategory !== undefined) business.userDefinedCategory = body.userDefinedCategory;
    if (body.googlePlaceId !== undefined) business.googlePlaceId = body.googlePlaceId;
    if (body.name !== undefined) business.name = String(body.name).trim();
    if (body.category !== undefined) business.category = String(body.category).trim();
    if (body.description !== undefined) business.description = String(body.description).trim();
    if (body.phone !== undefined) business.phone = String(body.phone).trim();
    if (body.website !== undefined) business.website = String(body.website).trim();
    if (body.address !== undefined) business.address = String(body.address).trim();
    if (body.googleMapsUrl !== undefined) business.googleMapsUrl = String(body.googleMapsUrl).trim();
    if (body.placeId !== undefined) business.placeId = String(body.placeId).trim() || undefined;

    // --- Keywords (array of strings, max 20) ---
    if (body.keywords !== undefined) {
      if (!Array.isArray(body.keywords)) {
        return NextResponse.json({ error: 'keywords must be an array.' }, { status: 400 });
      }
      if (body.keywords.length > 20) {
        return NextResponse.json({ error: 'keywords cannot exceed 20 items.' }, { status: 400 });
      }
      if (body.keywords.some((k: unknown) => typeof k !== 'string')) {
        return NextResponse.json({ error: 'Each keyword must be a string.' }, { status: 400 });
      }
      business.keywords = body.keywords.map((k: string) => k.trim()).filter(Boolean);
    }

    // --- Coordinates ---
    if (body.coordinates !== undefined) {
      const { lat, lng } = body.coordinates ?? {};
      if (typeof lat === 'number' && typeof lng === 'number') {
        business.coordinates = { lat, lng };
      }
    }

    // --- Nested: integrations.whatsappNumber ---
    if (body['integrations.whatsappNumber'] !== undefined) {
      business.integrations = {
        ...business.integrations,
        whatsappNumber: String(body['integrations.whatsappNumber']).trim() || undefined,
      };
    }

    await business.save();

    return NextResponse.json({ success: true, business });
  } catch (error: any) {
    // Duplicate unique key (e.g. placeId conflict)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
      return NextResponse.json({ error: `${field} is already in use by another business.` }, { status: 400 });
    }
    console.error('Failed to update business:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
