import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import PlatformSettings from '@/models/PlatformSettings';

/** The admin's own sales-pipeline Kanban columns — platform-wide, single shared list (see PlatformSettings.salesKanbanColumns). */

async function getOrCreateSettings() {
  let settings = await PlatformSettings.findOne();
  if (!settings) settings = await PlatformSettings.create({});
  return settings;
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  await dbConnect();
  const settings = await getOrCreateSettings();
  return NextResponse.json({ success: true, columns: settings.salesKanbanColumns });
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { columns } = await req.json().catch(() => ({}));
  if (!Array.isArray(columns) || columns.some((c) => typeof c !== 'string')) {
    return NextResponse.json({ success: false, error: 'columns must be an array of strings.' }, { status: 400 });
  }

  await dbConnect();
  const settings = await getOrCreateSettings();
  settings.salesKanbanColumns = columns;
  await settings.save();

  return NextResponse.json({ success: true, columns: settings.salesKanbanColumns });
}
