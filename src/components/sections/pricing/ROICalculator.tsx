"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Calculator, TrendingUp, Users, Star } from "lucide-react";

export function ROICalculator() {
  const [customers, setCustomers] = useState(100);
  const [ticketSize, setTicketSize] = useState(500);
  const [targetReviews, setTargetReviews] = useState(50);

  // Calculations based on realistic assumptions
  const currentRevenue = customers * ticketSize;
  
  // Review Impact: 5% increase per 10 reviews = 0.5% per review. Max 30%
  const reviewGrowthPercent = Math.min(targetReviews * 0.005, 0.30);
  const estimatedAdditionalRevenue = currentRevenue * reviewGrowthPercent;
  const potentialRevenue = currentRevenue + estimatedAdditionalRevenue;

  // Lead Increase: 2% increase per 5 reviews = 0.4% per review. Max 25%
  const leadIncreasePercent = Math.min(targetReviews * 0.004, 0.25);
  const estimatedLeadGrowth = Math.round(customers * leadIncreasePercent);

  // Review Potential: Assume 20% conversion rate for asked reviews
  const reviewPotential = Math.round(customers * 0.20);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 mt-32 relative z-10">
      <div className="bg-white rounded-[32px] border border-slate-200 shadow-2xl shadow-indigo-500/10 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2">
          
          {/* Inputs Section */}
          <div className="p-8 md:p-12 bg-slate-50 border-r border-slate-200">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-3 bg-indigo-100 rounded-xl">
                <Calculator className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900">Growth Calculator</h3>
            </div>
            
            <p className="text-slate-500 mb-8">See how optimizing your Google Business Profile directly translates to local revenue growth.</p>

            <div className="space-y-8">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="font-semibold text-slate-700">Monthly Customers</label>
                  <span className="font-bold text-indigo-600">{customers}</span>
                </div>
                <input 
                  type="range" 
                  min="10" max="1000" step="10" 
                  value={customers} 
                  onChange={(e) => setCustomers(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="font-semibold text-slate-700">Average Ticket Size (₹)</label>
                  <span className="font-bold text-indigo-600">₹{ticketSize.toLocaleString()}</span>
                </div>
                <input 
                  type="range" 
                  min="100" max="10000" step="100" 
                  value={ticketSize} 
                  onChange={(e) => setTicketSize(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="font-semibold text-slate-700">Target New Reviews</label>
                  <span className="font-bold text-indigo-600">{targetReviews}</span>
                </div>
                <input 
                  type="range" 
                  min="10" max="100" step="5" 
                  value={targetReviews} 
                  onChange={(e) => setTargetReviews(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>
          </div>

          {/* Results Section */}
          <div className="p-8 md:p-12 flex flex-col justify-center">
            <div className="space-y-8">
              
              <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-500/30">
                <p className="text-indigo-100 font-medium mb-1">Potential Monthly Revenue</p>
                <motion.h4 
                  key={potentialRevenue}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-4xl md:text-5xl font-extrabold tracking-tight"
                >
                  ₹{Math.round(potentialRevenue).toLocaleString()}
                </motion.h4>
                <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 rounded-full text-sm font-medium">
                  <TrendingUp className="w-4 h-4" />
                  +₹{Math.round(estimatedAdditionalRevenue).toLocaleString()} /mo Growth
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Users className="w-4 h-4" />
                    <span className="text-sm font-medium">New Local Leads</span>
                  </div>
                  <motion.div 
                    key={estimatedLeadGrowth}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-2xl font-bold text-slate-900"
                  >
                    +{estimatedLeadGrowth} /mo
                  </motion.div>
                </div>

                <div className="p-5 rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex items-center gap-2 text-slate-500 mb-2">
                    <Star className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium">Auto-Reviews</span>
                  </div>
                  <motion.div 
                    key={reviewPotential}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-2xl font-bold text-slate-900"
                  >
                    +{reviewPotential} /mo
                  </motion.div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 text-xs text-slate-400 text-center">
                * Estimates are based on average local business performance benchmarks. 
                Actual results may vary based on industry and location.
              </div>

            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
