import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';

const SAFE_FIELDS =
  'fullName email phone companyName isEmailVerified isShadowAccount subscriptionPlan lastLoginAt createdAt businessIds';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { fullName, phone, companyName, email } = body;

  const update: Record<string, string> = {};

  if (fullName !== undefined) {
    const name = String(fullName).trim();
    if (!name) return NextResponse.json({ error: 'Full name cannot be empty.' }, { status: 400 });
    update.fullName = name;
  }

  if (companyName !== undefined) {
    update.companyName = String(companyName).trim();
  }

  // Real accounts keep email immutable here (see the profile page's
  // "Contact support" copy) — but a shadow account (see shadowAccount.ts)
  // was provisioned with a fake `<phone>@shadow.growwmatics.internal`
  // placeholder and hasn't set a real one yet, so it's fine — expected,
  // even — to let it through here. Login stays phone+WhatsApp OTP either
  // way (there's no separate email/password claim step anymore); this only
  // fixes the placeholder being shown/used (e.g. as the Razorpay receipt
  // address) once a real email is entered, e.g. at checkout.
  if (email !== undefined) {
    const current = await User.findById(auth.userId, 'isShadowAccount').lean<{ isShadowAccount?: boolean }>();
    if (!current) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (!current.isShadowAccount) {
      return NextResponse.json(
        { error: 'Email cannot be changed here. Contact support if you need to change your email.' },
        { status: 400 }
      );
    }
    const emailStr = String(email).trim().toLowerCase();
    if (!emailStr || !EMAIL_REGEX.test(emailStr)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    const existing = await User.findOne({ email: emailStr, _id: { $ne: auth.userId } }).lean();
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 400 });
    }
    update.email = emailStr;
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
