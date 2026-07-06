import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Organization from '@/models/Organization';
import { createSession, signSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();

    // Hash the password before any DB writes — no plain-text bypass
    const passwordHash = body.password
      ? await bcrypt.hash(body.password, 12)
      : undefined;

    // 1. Find or Create User
    // If the email already exists we still issue a fresh session for that user,
    // but we do NOT overwrite their existing password.
    let newUser = await User.findOne({ email: body.email });
    if (!newUser) {
      newUser = await User.create({
        fullName: body.fullName || 'Test User',
        email: body.email,
        phone: body.phone || `000${Date.now().toString().slice(-7)}`,
        passwordHash,
        role: 'CLIENT',
        isEmailVerified: true,
        onboardingCompleted: true,
      });
    }

    // 2. Create Organization
    const newOrg = await Organization.create({
      name: body.businessName || 'My Organization',
      ownerId: newUser._id,
      subscriptionPlan: body.selectedPlan === 'starter' ? 'Free' : 'Pro',
    });

    // Naive city/state extraction from comma-separated address
    const addressParts = (body.address || '').split(',').map((p: string) => p.trim());
    let city = 'Unknown';
    let state = 'Unknown';
    if (addressParts.length >= 3) {
      city = addressParts[addressParts.length - 3];
      state = addressParts[addressParts.length - 2].split(' ')[0];
    } else if (addressParts.length === 2) {
      city = addressParts[0];
      state = addressParts[1].split(' ')[0];
    }

    // 3. Create Business
    const newBusiness = await Business.create({
      name: body.businessName,
      category: body.category || 'Local Business',
      description: body.description,
      address: body.address || 'Unknown',
      area: body.area,
      city: body.city || city,
      state: body.state || state,
      country: body.country,
      phone: body.phone,
      website: body.website,
      placeId: body.googlePlaceId || undefined,
      googlePlaceId: body.googlePlaceId || undefined,
      googleMapsUrl: body.googleMapsUrl,
      coordinates:
        body.latitude && body.longitude
          ? { lat: body.latitude, lng: body.longitude }
          : undefined,
      googleConnected: !!body.googlePlaceId,
      organizationId: newOrg._id,
      userId: newUser._id,
      metaBusinessProfileUrl: body.metaBusinessProfileUrl,
      facebookPageUrl: body.facebookPageUrl,
      instagramUrl: body.instagramUrl,
      // integrations.whatsappNumber is the Twilio WhatsApp number for this business.
      // The webhook routes incoming messages by matching To against this field.
      // whatsappConfig.businessPhone stores the same value for display / Meta future use.
      //
      // Migration for existing records (run once in MongoDB shell):
      // db.businesses.updateMany(
      //   { 'whatsappConfig.businessPhone': { $exists: true, $ne: '' }, 'integrations.whatsappNumber': { $exists: false } },
      //   [{ $set: { 'integrations.whatsappNumber': '$whatsappConfig.businessPhone' } }]
      // )
      integrations: {
        whatsappNumber: body.whatsappBusinessNumber || undefined,
      },
      whatsappConfig: {
        provider: 'meta',
        businessPhone: body.whatsappBusinessNumber,
        metaProfileUrl: body.metaBusinessProfileUrl,
        isConnected: !!body.whatsappBusinessNumber,
      },
      aiSettings: {
        tone: body.aiTone || 'professional',
        salesPrompt: body.aiSalesPrompt,
      },
      onboardingCompleted: true,
    });

    // 4. Update User context
    await User.findByIdAndUpdate(newUser._id, {
      $set: {
        organizationId: newOrg._id,
        activeBusinessId: newBusiness._id,
      },
    });

    // 5. Issue a signed session for the NEW user — overwrites any stale session
    //    that was in the browser from a previous account.
    await createSession(newUser._id.toString(), newUser.role);

    const cookieStore = await cookies();
    cookieStore.set('activeBusinessId', newBusiness._id.toString(), {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    // Mobile clients get the JWT in the body (no cookie support); web never does.
    if (req.headers.get('x-client') === 'mobile') {
      const token = await signSessionToken(newUser._id.toString(), newUser.role);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
      return NextResponse.json(
        { success: true, businessId: newBusiness._id, token, expiresAt },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: true, businessId: newBusiness._id }, { status: 200 });
  } catch (error: any) {
    console.error('Onboarding Creation Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    );
  }
}
