"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus } from "lucide-react";

const faqs = [
  {
    question: "How does AI optimize my Google Business Profile?",
    answer: "Our AI analyzes your current profile against thousands of high-ranking competitors in your niche. It identifies missing keywords, optimizes business categories, suggests better service descriptions, and generates localized posts to boost your authority."
  },
  {
    question: "Does this support WhatsApp automation?",
    answer: "Yes! We provide a built-in WhatsApp AI agent that can handle customer inquiries 24/7. It can book appointments, answer FAQs, and capture lead details directly from your Google profile visitors."
  },
  {
    question: "Can I manage multiple locations?",
    answer: "Absolutely. Our Growth and Enterprise plans are designed for businesses with multiple branches. You can manage everything from a single dashboard and see aggregated analytics."
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
        <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6">Frequently Asked <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Questions</span></h2>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, idx) => (
          <div 
            key={idx} 
            className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm"
          >
            <button
              onClick={() => setOpenIndex(openIndex === idx ? null : idx)}
              className="w-full p-6 flex items-center justify-between text-left hover:bg-slate-50 transition-colors text-slate-900"
            >
              <span className="font-bold">{faq.question}</span>
              {openIndex === idx ? <Minus className="text-primary" /> : <Plus className="text-slate-400" />}
            </button>
            
            <AnimatePresence>
              {openIndex === idx && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="p-6 pt-0 text-slate-500 text-sm leading-relaxed border-t border-slate-100">
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
