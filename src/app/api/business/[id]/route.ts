import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Single source of truth for "is this caller allowed to touch this
    // business" (owner, org member, or SUPER_ADMIN — no dev-environment
    // bypass; see lib/tenant.ts). Previously this route re-derived the same
    // check by hand with its own NODE_ENV!=='production' escape hatch,
    // which meant ANY logged-in user could edit ANY business's data on the
    // shared dev/QA deployment real testers use — removed, not replaced.
    const ctx = await requireBusinessContext({ businessIdFromBody: id });
    if (!ctx.ok) return ctx.response;

    const body = await request.json();

    await dbConnect();

    const business = await Business.findById(id);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
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
    // Social profile links — collected here instead of at onboarding now
    // (that step was removed; every field on it was optional anyway).
    if (body.metaBusinessProfileUrl !== undefined) business.metaBusinessProfileUrl = String(body.metaBusinessProfileUrl).trim() || undefined;
    if (body.facebookPageUrl !== undefined) business.facebookPageUrl = String(body.facebookPageUrl).trim() || undefined;
    if (body.instagramUrl !== undefined) business.instagramUrl = String(body.instagramUrl).trim() || undefined;

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
