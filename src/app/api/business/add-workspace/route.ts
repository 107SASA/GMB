import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Organization from '@/models/Organization';
import { requireClient } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const {
      businessName,
      category,
      description,
      address,
      area,
      city,
      state,
      country,
      phone,
      website,
      googlePlaceId,
      googleMapsUrl,
      latitude,
      longitude,
    } = body;

    if (!businessName || !category || !city) {
      return NextResponse.json(
        { success: false, error: 'businessName, category, and city are required' },
        { status: 400 }
      );
    }

    // Each workspace gets its own Organization so tenant scoping is consistent
    // with the existing architecture.
    const newOrg = await Organization.create({
      name: businessName,
      ownerId: auth.userId,
      subscriptionPlan: 'Free',
    });

    const newBusiness = await Business.create({
      name: businessName,
      category,
      description: description || '',
      address: address || city,
      area: area || '',
      city,
      state: state || '',
      country: country || '',
      phone: phone || '',
      website: website || '',
      placeId: googlePlaceId || undefined,
      googlePlaceId: googlePlaceId || undefined,
      googleMapsUrl: googleMapsUrl || '',
      coordinates:
        latitude && longitude ? { lat: latitude, lng: longitude } : undefined,
      googleConnected: false,
      organizationId: newOrg._id,
      userId: auth.userId,
      onboardingCompleted: true,
    });

    const cookieStore = await cookies();
    cookieStore.set('activeBusinessId', newBusiness._id.toString(), {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    return NextResponse.json(
      { success: true, businessId: newBusiness._id.toString(), business: newBusiness },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Add Workspace Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create workspace' },
      { status: 500 }
    );
  }
}
