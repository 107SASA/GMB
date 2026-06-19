import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSuperAdmin } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) {
      return authResult.response;
    }

    const { businessId } = await req.json();

    if (!businessId) {
      return NextResponse.json(
        { success: false, error: 'businessId is required' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    
    // Set the activeBusinessId to the impersonated business
    cookieStore.set('activeBusinessId', businessId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    return NextResponse.json({ success: true, message: 'Impersonation successful' });
  } catch (error: any) {
    console.error('Impersonation API Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to impersonate customer' },
      { status: 500 }
    );
  }
}
