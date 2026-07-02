"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const faqs = [
  {
    question: "Can I change plans later?",
    answer: "Yes, you can upgrade or downgrade your plan at any time. If you upgrade, the new limits and features will be applied immediately. If you downgrade, it takes effect at the start of your next billing cycle."
  },
  {
    question: "Do unused posts roll over?",
    answer: "No, AI posts and audits are allocated monthly to ensure consistent growth. Unused allocations reset at the beginning of each billing month."
  },
  {
    question: "How many businesses can I manage?",
    answer: "Our Starter, Growth, and Pro plans are designed for a single business profile. If you need to manage multiple businesses, our Agency / Multi-Location plan provides unlimited business management."
  },
  {
    question: "Do you provide onboarding?",
    answer: "Yes! Every plan includes an intuitive onboarding flow. Pro and Agency plans also include dedicated support to help you configure your AI agents and automations perfectly."
  },
  {
    question: "Do you support WhatsApp?",
    answer: "Yes, our Lead Conversion Pro and Agency plans include full WhatsApp AI Agent integration, allowing you to automatically qualify leads and follow up with customers directly on WhatsApp."
  },
  {
    question: "Can I cancel anytime?",
    answer: "Absolutely. There are no long-term contracts for our monthly plans. You can cancel your subscription at any time right from your billing dashboard."
  }
];

export function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 mt-32 relative z-10">
      <div className="text-center mb-12">
        <h3 className="text-3xl font-bold text-slate-900 mb-4">Frequently Asked Questions</h3>
        <p className="text-slate-500">Everything you need to know about the product and billing.</p>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <div 
            key={index} 
            className={`border rounded-2xl transition-all duration-200 overflow-hidden ${
              openIndex === index ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <button
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className="w-full flex items-center justify-between p-6 text-left"
            >
              <span className={`font-semibold ${openIndex === index ? 'text-indigo-900' : 'text-slate-900'}`}>
                {faq.question}
              </span>
              <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${
                openIndex === index ? 'rotate-180 text-indigo-500' : 'text-slate-400'
              }`} />
            </button>
            <AnimatePresence>
              {openIndex === index && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="px-6 pb-6 text-slate-600 leading-relaxed">
                    {faq.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
