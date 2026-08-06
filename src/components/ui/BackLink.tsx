'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/**
 * Consistent "go back" affordance for pages nested under a feature (e.g. an
 * audit's detail view, a picker screen reached from a connect flow). Several
 * deep dashboard pages had no way back except the browser Back button or the
 * sidebar — this is the one component to reuse instead of each page
 * reinventing its own back link.
 *
 * `href` should be the natural parent page (e.g. the list this detail view
 * came from) rather than router.back(), so the destination is predictable
 * even if the user arrived via a bookmark or direct link.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors mb-4"
    >
      <ChevronLeft className="w-4 h-4" />
      {label}
    </Link>
  );
}
