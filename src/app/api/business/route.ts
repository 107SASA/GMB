import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Business from "@/models/Business";
import Organization from "@/models/Organization";
import { requireBusinessContext } from "@/lib/tenant";
import { requireClient } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    return NextResponse.json(ctx.business);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const auth = await requireClient();
    if (!auth.ok) return auth.response;

    const organizationId = (auth.user as any).organizationId;
    if (!organizationId) {
      return NextResponse.json({ message: "No organization associated with this account" }, { status: 400 });
    }

    const org = await Organization.findById(organizationId).lean() as any;
    if (!org) {
      return NextResponse.json({ message: "Organization not found" }, { status: 404 });
    }

    const existingCount = await Business.countDocuments({ organizationId });
    if (org.maxBusinesses !== -1 && existingCount >= org.maxBusinesses) {
      return NextResponse.json({ message: "Business limit reached for your plan" }, { status: 403 });
    }

    const body = await req.json();
    delete body._id;
    delete body.organizationId;
    delete body.userId;

    const business = await Business.create({
      ...body,
      organizationId,
      userId: auth.userId,
    });
    return NextResponse.json({ message: "Business created", business }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const body = await req.json();
    // Exclude _id to prevent modification errors
    delete body._id;

    const business = await Business.findByIdAndUpdate(ctx.businessId, body, { new: true });
    return NextResponse.json({ message: "Business updated", business });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
