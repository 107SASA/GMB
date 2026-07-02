import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Business from "@/models/Business";
import { getActiveBusinessContext } from "@/lib/business-context";

export async function GET(req: Request) {
  try {
    const context = await getActiveBusinessContext();
    if (!context.ok) {
      return NextResponse.json({ message: context.error }, { status: context.status });
    }
    return NextResponse.json(context.business);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await dbConnect();
    const body = await req.json();
    const business = await Business.create(body);
    return NextResponse.json({ message: "Business created", business }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const context = await getActiveBusinessContext();
    if (!context.ok) {
      return NextResponse.json({ message: context.error }, { status: context.status });
    }
    
    const body = await req.json();
    // Exclude _id to prevent modification errors
    delete body._id;
    
    const business = await Business.findByIdAndUpdate(context.business._id, body, { new: true });
    return NextResponse.json({ message: "Business updated", business });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Server error" }, { status: 500 });
  }
}
