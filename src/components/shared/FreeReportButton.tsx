"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";

interface FreeReportButtonProps {
  className?: string;
  children?: React.ReactNode;
  onTriggerClick?: () => void;
  showIcon?: boolean;
  iconSize?: number;
}

/**
 * Shared "Get My Free Report" CTA — goes to /free-report (form page).
 * WhatsApp icon is visual only; the sticky GBP booster / "Try on WhatsApp"
 * still opens the report agent.
 */
export function FreeReportButton({
  className,
  children = "Get My Free Report",
  onTriggerClick,
  showIcon = true,
  iconSize = 18,
}: FreeReportButtonProps) {
  return (
    <Link
      href="/free-report"
      className={cn("inline-flex items-center justify-center gap-2", className)}
      onClick={onTriggerClick}
    >
      {showIcon && <WhatsAppIcon size={iconSize} />}
      {children}
    </Link>
  );
}
