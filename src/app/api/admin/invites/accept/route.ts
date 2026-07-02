import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import AdminInvite from '@/models/AdminInvite';
import User from '@/models/User';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  try {
    await dbConnect();

    const { token, name, password, phone } = await req.json();

    if (!token || !name || !password) {
      return NextResponse.json(
        { success: false, error: 'Token, name and password are required' },
        { status: 400 }
      );
    }

    // Find the invite
    const invite = await AdminInvite.findOne({ token });

    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'Invalid invite link' },
        { status: 400 }
      );
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'This invite has already been used' },
        { status: 400 }
      );
    }

    if (new Date() > invite.expiresAt) {
      await AdminInvite.findByIdAndUpdate(invite._id, { status: 'expired' });
      return NextResponse.json(
        { success: false, error: 'This invite link has expired' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: invite.email });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create the super admin user
    await User.create({
      fullName: name,
      email: invite.email,
      passwordHash: hashedPassword,
      phone: phone || '+910000000000',
      role: 'super_admin',
      isEmailVerified: true,
    });

    // Mark invite as accepted
    await AdminInvite.findByIdAndUpdate(invite._id, { status: 'accepted' });

    return NextResponse.json({
      success: true,
      message: 'Super admin account created successfully',
    });
  } catch (error: any) {
    console.error('Accept Invite Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to accept invite' },
      { status: 500 }
    );
  }
}