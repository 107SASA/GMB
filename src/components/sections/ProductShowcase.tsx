"use client";

import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { SectionHeading, Accent } from "@/components/ui/SectionHeading";
import { PipelineIllustration } from "@/components/graphics/PipelineIllustration";
import { CalendarIllustration } from "@/components/graphics/CalendarIllustration";

export function ProductShowcase() {
  return (
    <section className="py-24 px-6 bg-surface">
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="Product"
          title={
            <>
              Powerful Tools, <Accent>Simple Interface</Accent>
            </>
          }
          description="Manage everything from reviews to lead conversion in one sleek command center."
          className="mb-20"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
          >
            <PipelineIllustration />
          </motion.div>

          <div className="space-y-8">
            <h3 className="font-heading text-3xl font-bold text-on-surface">Smart CRM & Lead Automation</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Our integrated CRM automatically captures and categorizes leads coming from your Google Business Profile, triggering personalized follow-ups that increase conversion.
            </p>
            <ul className="space-y-4">
              {[
                "Automated lead tagging",
                "Review request campaigns",
                "Multi-location pipeline view",
                "Performance tracking per agent",
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-on-surface">
                  <div className="w-6 h-6 rounded-lg bg-secondary-container/40 flex items-center justify-center border border-secondary-fixed">
                    <MaterialIcon name="check" size={16} className="text-secondary" />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mt-24">
          <div className="order-2 lg:order-1 space-y-8">
            <h3 className="font-heading text-3xl font-bold text-on-surface">AI Content Calendar</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Never worry about what to post again. Our AI generates a full month of local-optimized content based on your business category and goals.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            viewport={{ once: true }}
            className="order-1 lg:order-2"
          >
            <CalendarIllustration />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
