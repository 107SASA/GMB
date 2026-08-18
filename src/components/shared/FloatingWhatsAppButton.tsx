"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

/**
 * Persistent bottom-right "talk to our WhatsApp AI agent" launcher —
 * replaces the old static "Get Report on WhatsApp" hero button, which is
 * now this one always-visible floating bubble instead of competing for
 * attention in the hero's button row. Mounted once on marketing pages
 * (see Navbar/Footer call sites), not per-section.
 */
export function FloatingWhatsAppButton() {
  return (
    <motion.a
      href={boostProfileLink()}
      {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1, duration: 0.4, type: "spring", stiffness: 260, damping: 20 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 pl-4 pr-5 py-3.5 bg-whatsapp text-white rounded-full shadow-lg shadow-whatsapp/30"
      aria-label="Talk to our WhatsApp AI agent"
    >
      {/* Gentle bump — a slow, subtle vertical bounce, distinct from the
          spring pop-in above, so it keeps drawing the eye without being
          obnoxious. */}
      <motion.span
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.4, ease: "easeInOut" }}
        className="flex items-center gap-2"
      >
        <MaterialIcon name="chat" size={22} className="text-white" filled />
        <span className="hidden sm:inline text-sm font-bold whitespace-nowrap">Talk to our AI Agent</span>
      </motion.span>

      {/* Ambient pulse ring — reinforces "live"/available without being a
          second competing bounce animation. */}
      <motion.span
        animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        className="absolute inset-0 rounded-full bg-whatsapp -z-10"
      />
    </motion.a>
  );
}
