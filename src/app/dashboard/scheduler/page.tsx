import { redirect } from 'next/navigation';

// Content Scheduler was folded into the unified /dashboard/content page as
// the "Schedule" tab (Bug 14 — combining Content Generator and Content
// Scheduler into one workflow instead of two separate nav items). This route
// stays only so old links/bookmarks land somewhere useful.
export default function SchedulerRedirect() {
  redirect('/dashboard/content?tab=schedule');
}
