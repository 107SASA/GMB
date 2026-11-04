import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusinessContext } from '@/lib/tenant';
import { dismissTaskPopup } from '@/services/tasks/taskService';

export const dynamic = 'force-dynamic';

const schema = z.object({ auditId: z.string().min(1) });

/** Hides the "fixes ready" popup for one report (closed or finished). */
export async function POST(req: Request) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'auditId is required.' }, { status: 400 });
  const result = await dismissTaskPopup(auth.businessId, parsed.data.auditId);
  if (!result.ok) return NextResponse.json({ success: false, error: 'Report not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
