import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AdminInvite from '@/models/AdminInvite';
import User from '@/models/User';
import crypto from 'crypto';

// GET - list all invites
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const invites = await AdminInvite.find()
      .sort({ createdAt: -1 })
      .populate('invitedBy', 'fullName email')
      .lean();

    return NextResponse.json({ success: true, data: invites });
  } catch (error: any) {
    console.error('Invites GET Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch invites' },
      { status: 500 }
    );
  }
}

// POST - create a new invite
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'A user with this email already exists' },
        { status: 400 }
      );
    }

    // Check if pending invite already exists
    const existingInvite = await AdminInvite.findOne({
      email: email.toLowerCase(),
      status: 'pending',
    });
    if (existingInvite) {
      return NextResponse.json(
        { success: false, error: 'A pending invite already exists for this email' },
        { status: 400 }
      );
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Expires in 48 hours
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);

    const invite = await AdminInvite.create({
      email: email.toLowerCase(),
      token,
      invitedBy: auth.userId,
      expiresAt,
    });

    const inviteLink = `${process.env.NEXTAUTH_URL}/admin/invite/${token}`;

    return NextResponse.json({
      success: true,
      data: { invite, inviteLink },
    });
  } catch (error: any) {
    console.error('Invites POST Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create invite' },
      { status: 500 }
    );
  }
}

// DELETE - cancel/delete an invite
export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { id } = await req.json();
    await AdminInvite.findByIdAndDelete(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Invites DELETE Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete invite' },
      { status: 500 }
    );
  }
}