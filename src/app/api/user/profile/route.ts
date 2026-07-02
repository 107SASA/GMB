import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';

const SAFE_FIELDS = 'fullName email phone companyName isEmailVerified subscriptionPlan lastLoginAt createdAt businessIds';

export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();
  const user = await User.findById(auth.userId, SAFE_FIELDS).lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({ user });
}

export async function PATCH(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const body = await req.json();
  const { fullName, phone, companyName } = body;

  const update: Record<string, string> = {};

  if (fullName !== undefined) {
    const name = String(fullName).trim();
    if (!name) return NextResponse.json({ error: 'Full name cannot be empty.' }, { status: 400 });
    update.fullName = name;
  }

  if (companyName !== undefined) {
    update.companyName = String(companyName).trim();
  }

  if (phone !== undefined) {
    const phoneStr = String(phone).trim();
    if (phoneStr && !/^\+[1-9]\d{6,14}$/.test(phoneStr)) {
      return NextResponse.json(
        { error: 'Phone must be in E.164 format (e.g. +91XXXXXXXXXX).' },
        { status: 400 }
      );
    }
    if (phoneStr) {
      const existing = await User.findOne({ phone: phoneStr, _id: { $ne: auth.userId } }).lean();
      if (existing) {
        return NextResponse.json({ error: 'Phone number already in use.' }, { status: 400 });
      }
    }
    update.phone = phoneStr;
  }

  const user = await User.findByIdAndUpdate(
    auth.userId,
    { $set: update },
    { new: true, select: SAFE_FIELDS }
  ).lean();

  return NextResponse.json({ user });
}
