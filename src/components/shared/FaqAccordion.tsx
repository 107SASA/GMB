"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Generalized version of the homepage FAQ.tsx accordion — takes its
 * questions as a prop instead of a hardcoded list, so it can be reused on
 * the standalone /faq page and every /services/[slug] page without
 * duplicating the accordion markup/behavior five times.
 */
export function FaqAccordion({
  faqs,
  defaultOpenIndex = 0,
}: {
  faqs: FaqItem[];
  defaultOpenIndex?: number | null;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(defaultOpenIndex);

  return (
    <div className="space-y-4">
      {faqs.map((faq, idx) => (
        <div
          key={idx}
          className="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest card-shadow"
        >
          <button
            onClick={() => setOpenIndex(openIndex === idx ? null : idx)}
            className="w-full p-6 flex items-center justify-between text-left hover:bg-surface-container-low transition-colors text-on-surface"
            aria-expanded={openIndex === idx}
          >
            <span className="font-heading font-bold pr-4">{faq.question}</span>
            {openIndex === idx ? (
              <MaterialIcon name="remove" size={24} className="text-primary shrink-0" />
            ) : (
              <MaterialIcon name="add" size={24} className="text-outline shrink-0" />
            )}
          </button>

          <AnimatePresence>
            {openIndex === idx && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="p-6 pt-0 text-on-surface-variant text-sm leading-relaxed border-t border-outline-variant">
                  {faq.answer}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
