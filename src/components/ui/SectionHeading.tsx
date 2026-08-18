"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Single emphasis word/phrase inside a SectionHeading title — solid
 * `text-primary`, not a gradient. Every section on the homepage used to roll
 * its own `text-transparent bg-clip-text bg-gradient-to-r ...` for this,
 * which is the single most repeated "generic AI landing page" tell on the
 * site. One restrained treatment, reused everywhere, reads as designed.
 */
export function Accent({ children }: { children: React.ReactNode }) {
  return <span className="text-primary">{children}</span>;
}

interface SectionHeadingProps {
  /** Small label above the title, e.g. "HOW IT WORKS" */
  eyebrow?: string;
  /** Wrap the emphasized part in <Accent>. */
  title: React.ReactNode;
  description?: string;
  align?: "center" | "left";
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: SectionHeadingProps) {
  const isCenter = align === "center";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      viewport={{ once: true }}
      className={cn(isCenter ? "text-center mx-auto" : "text-left", className)}
    >
      {eyebrow && (
        <div
          className={cn(
            "text-label-sm text-primary font-bold mb-4 flex items-center gap-2",
            isCenter && "justify-center"
          )}
        >
          <span className="w-6 h-px bg-primary/40" />
          {eyebrow}
        </div>
      )}
      <h2
        className={cn(
          "font-heading text-3xl md:text-5xl font-bold text-on-surface tracking-tight",
          description && "mb-6"
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "text-on-surface-variant text-lg leading-relaxed",
            isCenter ? "max-w-2xl mx-auto" : "max-w-xl"
          )}
        >
          {description}
        </p>
      )}
    </motion.div>
  );
}
