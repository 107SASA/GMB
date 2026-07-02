import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const body = await req.json();
    
    // In Next.js 16 app router, route params are awaited according to rules (if applicable, though { params } in type is standard, we must await it as per the user's AGENTS.md rule 'Next.js you know ... breaking changes')
    // Next.js 15+ requires awaiting params
    const resolvedParams = await params;
    const { id } = resolvedParams;

    const lead = await Lead.findByIdAndUpdate(id, { $set: body }, { new: true });
    
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(lead);
  } catch (error) {
    console.error('Error updating lead:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
