"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

/**
 * Replaces the old Hero "dashboard mockup" — which was a literal browser
 * chrome full of plain gray divs pretending to be UI. This is an honest
 * abstract illustration instead: a self-drawing growth line, a faint dot
 * grid for texture, the brand leaf as a watermark, and the two floating
 * result chips restyled as illustration rather than fake screenshot debris.
 */
export function HeroIllustration() {
  return (
    <div className="relative w-full max-w-4xl mx-auto aspect-[16/10] rounded-3xl border border-outline-variant bg-surface-container-lowest/70 backdrop-blur-xl card-shadow overflow-hidden">
      {/* Texture: faint dot grid */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(circle, var(--color-outline-variant) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Soft brand glow, restrained (two, not four+) */}
      <div className="absolute -top-1/3 -right-1/4 w-2/3 h-2/3 bg-primary/10 blur-[100px] rounded-full" />
      <div className="absolute -bottom-1/3 -left-1/4 w-2/3 h-2/3 bg-secondary/10 blur-[100px] rounded-full" />

      {/* Self-drawing growth line */}
      <svg viewBox="0 0 600 300" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="heroLineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#006c45" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#006c45" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M0,260 C80,240 120,180 180,190 C240,200 260,120 320,110 C380,100 400,60 460,50 C500,44 540,30 600,10 L600,300 L0,300 Z"
          fill="url(#heroLineFill)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1.2, duration: 0.8 }}
        />
        <motion.path
          d="M0,260 C80,240 120,180 180,190 C240,200 260,120 320,110 C380,100 400,60 460,50 C500,44 540,30 600,10"
          fill="none"
          stroke="#006c45"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.6, ease: "easeInOut", delay: 0.5 }}
        />
      </svg>

      {/* Leaf watermark */}
      <img
        src="/brand/icon.png"
        alt=""
        aria-hidden="true"
        className="absolute bottom-6 left-6 w-16 h-16 opacity-[0.15] object-contain"
      />

      {/* Floating result chips — illustration, not literal UI */}
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-8 right-6 md:right-10 p-4 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl border border-outline-variant card-shadow"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-secondary-container/40 border border-secondary-fixed rounded-lg flex items-center justify-center shrink-0">
            <MaterialIcon name="auto_awesome" size={20} className="text-secondary" />
          </div>
          <div>
            <div className="text-[10px] text-on-surface-variant font-medium">New Lead Captured</div>
            <div className="text-xs font-bold text-on-surface">Conversion Rate +24%</div>
          </div>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        className="absolute bottom-8 right-6 md:right-16 p-4 bg-surface-container-lowest/95 backdrop-blur-md rounded-xl border border-outline-variant card-shadow"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-fixed border border-primary-fixed-dim rounded-lg flex items-center justify-center shrink-0">
            <MaterialIcon name="star" size={20} className="text-primary" filled />
          </div>
          <div>
            <div className="text-[10px] text-on-surface-variant font-medium">Review Auto-Replied</div>
            <div className="text-xs font-bold text-on-surface">5-Star Feedback Posted</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
