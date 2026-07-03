import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { createSession } from '@/lib/session';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password required' }, { status: 400 });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    let isValid = false;
    if (user.passwordHash?.startsWith('$2b$') || user.passwordHash?.startsWith('$2a$')) {
      isValid = await bcrypt.compare(password, user.passwordHash);
    } else {
      // Legacy plain-text passwords stored before bcrypt was enforced
      isValid = user.passwordHash === password;
    }

    if (!isValid) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    if (!user.isEmailVerified) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please verify your email before logging in.',
          requiresVerification: true,
          email: user.email,
        },
        { status: 403 }
      );
    }

    await createSession(user._id.toString(), user.role);

    // Sync activeBusinessId cookie so client-side context loads the right business
    let activeBusinessId = user.activeBusinessId?.toString();
    if (!activeBusinessId) {
      const business = await Business.findOne({ userId: user._id });
      if (business) {
        activeBusinessId = business._id.toString();
        await User.updateOne({ _id: user._id }, { $set: { activeBusinessId: business._id } });
      }
    }

    if (activeBusinessId) {
      const cookieStore = await cookies();
      cookieStore.set('activeBusinessId', activeBusinessId, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('Login Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
