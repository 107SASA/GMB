import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import ReviewRequest from "@/models/ReviewRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await dbConnect();
    const requests = await ReviewRequest.find({}).sort({ createdAt: -1 }).populate('customerId');
    return NextResponse.json(requests);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await dbConnect();
    const body = await request.json();
    const req = await ReviewRequest.create(body);
    return NextResponse.json(req, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
