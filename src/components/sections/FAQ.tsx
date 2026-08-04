"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const faqs = [
  {
    question: "How does AI optimize my Google Business Profile?",
    answer: "Our AI analyzes your current profile against thousands of high-ranking competitors in your niche. It identifies missing keywords, optimizes business categories, suggests better service descriptions, and generates localized posts to boost your authority."
  },
  {
    question: "Can I manage multiple businesses?",
    answer: "Yes. You can add multiple business workspaces from a single account and switch between them in one dashboard. Each workspace runs on its own subscription, so you only pay for the businesses you're actively growing."
  },
  {
    question: "Is manual approval available before posting?",
    answer: "Yes, you have full control. You can set the AI to 'Draft Mode' where it generates content for your review, or 'Auto-Pilot' where it posts automatically once it understands your brand voice."
  },
  {
    question: "Does it work for coaching institutes?",
    answer: "Yes, it works for any local business that relies on Google Maps visibility, including coaching institutes, dental clinics, restaurants, and professional services."
  }
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 px-6 max-w-3xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6">
          Frequently Asked{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
            Questions
          </span>
        </h2>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, idx) => (
          <div
            key={idx}
            className="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest card-shadow"
          >
            <button
              onClick={() => setOpenIndex(openIndex === idx ? null : idx)}
              className="w-full p-6 flex items-center justify-between text-left hover:bg-surface-container-low transition-colors text-on-surface"
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
    </section>
  );
}
