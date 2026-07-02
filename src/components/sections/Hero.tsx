"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Play, Sparkles, Calendar } from "lucide-react";

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 overflow-hidden">
      {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/20 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.05)_0%,transparent_70%)]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 border border-indigo-100 text-sm font-medium text-indigo-600 mb-8 shadow-sm"
        >
          <Sparkles className="w-4 h-4" />
          <span>AI-Powered Google Business Growth Platform</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tight text-slate-900 mb-8 leading-[1.1]"
        >
          Scale Your Local Business <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">With AI Intelligence</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto mb-12 leading-relaxed"
        >
          Automate your Google Business Profile, generate more reviews, convert leads instantly, and grow local visibility using AI + WhatsApp automation.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
        >
          <Link href="/onboarding" className="w-full sm:w-auto px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20">
            Start Free Audit
            <ArrowRight className="w-5 h-5" />
          </Link>
          <Link href="/book-demo" className="w-full sm:w-auto px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20">
            <Calendar className="w-5 h-5" />
            Book Free Demo
          </Link>
          <button className="w-full sm:w-auto px-8 py-4 bg-white border border-slate-200 text-slate-700 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-all shadow-sm">
            <Play className="w-5 h-5 text-slate-400" />
            Watch Demo
          </button>
        </motion.div>

        {/* Hero Visual - Dashboard Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
          className="relative max-w-5xl mx-auto"
        >
          <div className="relative bg-slate-50/50 backdrop-blur-xl rounded-t-3xl border-t border-x border-slate-200 p-4 pb-0 overflow-hidden shadow-2xl">
            <div className="flex items-center gap-2 mb-4 px-2">
              <div className="w-3 h-3 rounded-full bg-slate-300" />
              <div className="w-3 h-3 rounded-full bg-slate-300" />
              <div className="w-3 h-3 rounded-full bg-slate-300" />
              <div className="ml-4 px-3 py-1 rounded-lg bg-white border border-slate-200 text-[10px] text-slate-500 shadow-sm">gmb-boost.ai/dashboard</div>
            </div>
            
            <div className="grid grid-cols-12 gap-4 h-[400px] md:h-[600px] bg-white rounded-t-2xl border-t border-x border-slate-100 shadow-sm">
              {/* Sidebar Mock */}
              <div className="col-span-2 border-r border-slate-100 p-4 hidden md:block">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-8 w-full bg-slate-50 rounded-lg mb-4 border border-slate-100" />
                ))}
              </div>
              
              {/* Content Mock */}
              <div className="col-span-12 md:col-span-10 p-6 text-left">
                <div className="flex items-center justify-between mb-8">
                  <div className="h-8 w-48 bg-slate-100 rounded-xl" />
                  <div className="h-10 w-32 bg-indigo-50 border border-indigo-100 rounded-xl" />
                </div>
                
                <div className="grid grid-cols-3 gap-6 mb-8">
                  <div className="h-32 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                    <div className="h-4 w-20 bg-slate-100 rounded mb-4" />
                    <div className="h-8 w-24 bg-slate-200 rounded" />
                  </div>
                  <div className="h-32 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                    <div className="h-4 w-20 bg-slate-100 rounded mb-4" />
                    <div className="h-8 w-24 bg-slate-200 rounded" />
                  </div>
                  <div className="h-32 bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                    <div className="h-4 w-20 bg-slate-100 rounded mb-4" />
                    <div className="h-8 w-24 bg-slate-200 rounded" />
                  </div>
                </div>
                
                <div className="h-64 bg-slate-50 rounded-3xl border border-slate-200 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-indigo-50/50 to-transparent" />
                  <div className="p-6">
                    <div className="h-4 w-32 bg-slate-200 rounded mb-6" />
                    <div className="flex items-end gap-2 h-32">
                      {[40, 70, 45, 90, 65, 80, 50, 85, 30, 95].map((h, i) => (
                        <div key={i} className="flex-1 bg-indigo-400 rounded-t-sm" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating UI Elements */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute top-20 right-[-20px] md:right-10 p-4 bg-white/90 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl hidden sm:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 border border-emerald-100 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">New Lead via WhatsApp</div>
                  <div className="text-xs font-bold text-slate-900">Conversion Rate +24%</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute bottom-20 left-[-20px] md:left-10 p-4 bg-white/90 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl hidden sm:block"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold">
                  ★
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Review Auto-Replied</div>
                  <div className="text-xs font-bold text-slate-900">5-Star Feedback Posted</div>
                </div>
              </div>
            </motion.div>
          </div>
          
          <div className="absolute -bottom-px left-0 right-0 h-40 bg-gradient-to-t from-background via-background/80 to-transparent z-20" />
        </motion.div>
      </div>
    </section>
  );
}
