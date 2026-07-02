"use client";

import { motion } from "framer-motion";
import { 
  Search, 
  PenTool, 
  Calendar, 
  MessageSquare, 
  MessageCircle, 
  Users, 
  Mail, 
  BarChart3 
} from "lucide-react";

const features = [
  {
    title: "AI GMB Audit Engine",
    description: "Instant analysis of your profile with actionable AI-driven optimization steps.",
    icon: Search,
    color: "bg-blue-500/20 text-blue-500",
  },
  {
    title: "AI SEO Content Generator",
    description: "Generate hyper-local posts and updates that rank higher on Google Maps.",
    icon: PenTool,
    color: "bg-purple-500/20 text-purple-500",
  },
  {
    title: "7-Day Auto Scheduler",
    description: "Set it and forget it. AI handles your content calendar across all locations.",
    icon: Calendar,
    color: "bg-pink-500/20 text-pink-500",
  },
  {
    title: "Review Reply Automation",
    description: "Intelligent, personalized responses to reviews within minutes.",
    icon: MessageSquare,
    color: "bg-green-500/20 text-green-500",
  },
  {
    title: "WhatsApp AI Lead Agent",
    description: "Convert profile visitors into customers instantly via automated WhatsApp chats.",
    icon: MessageCircle,
    color: "bg-emerald-500/20 text-emerald-500",
  },
  {
    title: "Built-in CRM Pipeline",
    description: "Track every lead from initial contact to final conversion in one simple view.",
    icon: Users,
    color: "bg-amber-500/20 text-amber-500",
  },
  {
    title: "Review Request Campaigns",
    description: "Automated SMS and Email triggers to get more 5-star reviews from happy customers.",
    icon: Mail,
    color: "bg-indigo-500/20 text-indigo-500",
  },
  {
    title: "Analytics Dashboard",
    description: "Real-time visibility into your local growth, calls, and conversions.",
    icon: BarChart3,
    color: "bg-rose-500/20 text-rose-500",
  },
];

export function Features() {
  return (
    <section id="features" className="py-24 px-6 max-w-7xl mx-auto">
      <div className="text-center mb-20">
        <h2 className="text-3xl md:text-5xl font-bold text-slate-900 mb-6">Everything You Need to <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">Dominate Local Search</span></h2>
        <p className="text-slate-500 max-w-2xl mx-auto text-lg">
          Our AI engine handles the heavy lifting, so you can focus on running your business.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: idx * 0.1 }}
            viewport={{ once: true }}
            whileHover={{ y: -5, transition: { duration: 0.2 } }}
            className="group p-8 rounded-3xl bg-white shadow-sm border border-slate-200 hover:border-primary/30 hover:shadow-md transition-all relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <div className={`w-12 h-12 rounded-2xl ${feature.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
              <feature.icon className="w-6 h-6" />
            </div>
            
            <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-primary transition-colors">{feature.title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">{feature.description}</p>
            
            {/* Hover Glow */}
            <div className="absolute -bottom-20 -right-20 w-40 h-40 bg-primary/5 blur-[60px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
