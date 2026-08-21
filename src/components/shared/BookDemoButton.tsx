"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";

interface BookDemoButtonProps {
  /** Which page/CTA triggered this — passed as ?origin= on /book-demo. */
  origin: string;
  className?: string;
  children?: React.ReactNode;
  onTriggerClick?: () => void;
  /** Show WhatsApp glyph (Figma default). Set false for text-only links. */
  showIcon?: boolean;
  iconSize?: number;
}

/**
 * Shared "Book Free Demo" CTA — WhatsApp icon + label, matching Figma.
 */
export function BookDemoButton({
  origin,
  className,
  children = "Book Free Demo",
  onTriggerClick,
  showIcon = true,
  iconSize = 18,
}: BookDemoButtonProps) {
  return (
    <Link
      href={`/book-demo?origin=${encodeURIComponent(origin)}`}
      className={cn("inline-flex items-center justify-center gap-2", className)}
      onClick={onTriggerClick}
    >
      {showIcon && <WhatsAppIcon size={iconSize} />}
      {children}
    </Link>
  );
}
