import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> } // In Next.js 15, params in Route Handlers should be awaited if we follow the latest conventions or they are sync. Actually, in Next.js 15, `params` is a Promise and needs to be awaited.
) {
  try {
    const { id } = await params;
    await dbConnect();

    const audit = await Audit.findById(id);

    if (!audit) {
      return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, audit }, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch audit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
