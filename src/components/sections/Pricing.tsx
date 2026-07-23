"use client";

import { PricingCards } from "./pricing/PricingCards";
import { ROICalculator } from "./pricing/ROICalculator";

export function Pricing() {
  return (
    <section id="pricing" className="py-32 relative bg-white overflow-hidden">
      {/* Background gradients for premium SaaS aesthetic */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] max-w-[1200px] opacity-40 pointer-events-none">
        <div className="absolute top-20 left-20 w-[400px] h-[400px] bg-indigo-200 rounded-full mix-blend-multiply filter blur-[100px] opacity-70 animate-blob" />
        <div className="absolute top-40 right-20 w-[400px] h-[400px] bg-purple-200 rounded-full mix-blend-multiply filter blur-[100px] opacity-70 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-blue-100 rounded-full mix-blend-multiply filter blur-[100px] opacity-70 animate-blob animation-delay-4000" />
      </div>

      <div className="text-center mb-20 relative z-10 px-4">
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight mb-6">
          Choose Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">Growth Plan</span>
        </h2>
        <p className="text-slate-500 max-w-2xl mx-auto text-lg md:text-xl font-medium">
          Start small and scale your local business with AI-powered Google Business Profile optimization and lead conversion.
        </p>
      </div>

      <PricingCards />

      <ROICalculator />

    </section>
  );
}
