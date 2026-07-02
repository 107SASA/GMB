"use client";

import { motion } from "framer-motion";
import { 
  CheckCircle2, 
  Download,
  Share2,
  Star,
} from "lucide-react";
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
} from "recharts";
import { cn } from "@/lib/utils";

export function ResultsView({ audit }: { audit: any }) {
  const { business, recommendations, reviews = [] } = audit;
  
  let posPercent = 0;
  let neuPercent = 0;
  let negPercent = 0;

  if (reviews && reviews.length > 0) {
    const positive = reviews.filter((r: any) => r.sentiment?.toLowerCase() === "positive").length;
    const negative = reviews.filter((r: any) => r.sentiment?.toLowerCase() === "negative").length;
    const neutral = reviews.length - positive - negative;
    
    posPercent = Math.round((positive / reviews.length) * 100);
    negPercent = Math.round((negative / reviews.length) * 100);
    neuPercent = Math.round((neutral / reviews.length) * 100);
  } else if (business?.rating > 0) {
    // Formula based on average rating if detailed reviews aren't available
    const r = business.rating;
    posPercent = Math.round((r / 5) * 100);
    negPercent = Math.max(0, Math.round(((5 - r) / 5) * 100) - 10);
    neuPercent = 100 - posPercent - negPercent;
  }

  const sentimentData = [
    { name: "Positive", value: posPercent, color: "#10b981" },
    { name: "Neutral", value: neuPercent, color: "#3b82f6" },
    { name: "Negative", value: negPercent, color: "#ef4444" },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-10"
    >
      {/* Results Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-primary font-bold text-sm mb-2 uppercase tracking-widest">
            <CheckCircle2 className="w-4 h-4" />
            Audit Report
          </div>
          <h1 className="text-4xl font-bold text-slate-900">{business.name}</h1>
          <p className="text-slate-500">{business.address}</p>
        </div>
        <div className="flex items-center gap-4">
          <button className="px-6 py-3 bg-white border border-slate-200 shadow-sm text-slate-900 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all">
            <Download className="w-4 h-4" />
            Export Report
          </button>
          <button className="px-6 py-3 bg-primary text-white rounded-xl font-bold flex items-center gap-2 hover:bg-primary/90 transition-all shadow-sm">
            <Share2 className="w-4 h-4" />
            Share Result
          </button>
        </div>
      </div>

      {/* Score Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm flex flex-col items-center text-center">
          <div className="relative w-48 h-48 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[{ value: audit.overallScore }, { value: 100 - audit.overallScore }]}
                  innerRadius={70}
                  outerRadius={90}
                  startAngle={90}
                  endAngle={450}
                  dataKey="value"
                >
                  <Cell fill="#8b5cf6" stroke="none" />
                  <Cell fill="#f1f5f9" stroke="none" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-extrabold text-slate-900">{audit.overallScore}</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Score</span>
            </div>
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2">
            {audit.overallScore > 80 ? "Excellent" : audit.overallScore > 60 ? "Good" : "Needs Improvement"}
          </h3>
          <p className="text-sm text-slate-500 leading-relaxed">{audit.aiSummary}</p>
        </div>

        <div className="lg:col-span-8 bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900 mb-8">Performance Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { label: "SEO", score: audit.seoScore },
              { label: "Review", score: audit.reviewScore },
              { label: "Engagement", score: audit.engagementScore },
              { label: "Completeness", score: audit.completenessScore },
            ].map((metric, i) => (
              <div key={i} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 text-center shadow-sm">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-4">{metric.label}</div>
                <div className="text-3xl font-extrabold text-slate-900 mb-2">{metric.score}%</div>
                <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${metric.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-10 rounded-[40px] border border-slate-200 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900 mb-8">Sentiment Analysis</h3>
          
          {posPercent === 0 && neuPercent === 0 && negPercent === 0 ? (
            <div className="h-64 w-full flex flex-col items-center justify-center text-center p-6 bg-slate-50 rounded-3xl border border-slate-100 border-dashed">
              <Star className="w-10 h-10 text-slate-300 mb-3" />
              <p className="text-sm font-bold text-slate-700">Not Enough Data</p>
              <p className="text-xs text-slate-500 mt-1 max-w-[200px]">This business currently has 0 reviews on Google Maps. Start collecting reviews to see sentiment insights!</p>
            </div>
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sentimentData} innerRadius={60} outerRadius={80} dataKey="value">
                      {sentimentData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-around mt-8">
                {sentimentData.map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="text-lg font-bold" style={{ color: item.color }}>{item.value}%</div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold">{item.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="text-xl font-bold text-slate-900">AI Prioritized Actions</h3>
          {recommendations.slice(0, 4).map((rec: any, i: number) => (
            <div key={i} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative overflow-hidden group">
              <div className={cn("absolute top-0 left-0 w-1 h-full", rec.priority === "High" ? "bg-red-500" : "bg-primary")} />
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors">{rec.title}</h4>
                <span className="text-[8px] font-bold px-2 py-1 rounded bg-slate-100 text-slate-500 uppercase tracking-widest">{rec.priority}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">{rec.description}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
