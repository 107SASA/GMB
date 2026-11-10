import { redirect } from 'next/navigation';

/** Keywords now live in the SEO Plan page (its default tab); old links land there. */
export default function KeywordsRedirect() {
  redirect('/dashboard/seo-plan');
}
