import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    return NextResponse.json({ success: true, data: ctx.business }, { status: 200 });
  } catch (error: any) {
    console.error('Active Business API Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch business context' }, { status: 500 });
  }
}
