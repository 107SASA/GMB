"use client";

import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

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
    { name: "Positive", value: posPercent, color: "#006c45" },
    { name: "Neutral", value: neuPercent, color: "#00386c" },
    { name: "Negative", value: negPercent, color: "#ba1a1a" },
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
            <MaterialIcon name="check_circle" size={16} className="text-primary" />
            Audit Report
          </div>
          <h1 className="font-heading text-4xl font-bold text-on-surface">{business.name}</h1>
          <p className="text-on-surface-variant">{business.address}</p>
        </div>
        <div className="flex items-center gap-4">
          <button className="px-6 py-3 bg-surface-container-lowest border border-outline-variant card-shadow text-on-surface rounded-lg font-bold flex items-center gap-2 hover:bg-surface-container-low transition-all">
            <MaterialIcon name="download" size={16} />
            Export Report
          </button>
          <button className="px-6 py-3 bg-primary text-on-primary rounded-lg font-bold flex items-center gap-2 hover:bg-primary-container transition-all card-shadow">
            <MaterialIcon name="share" size={16} className="text-on-primary" />
            Share Result
          </button>
        </div>
      </div>

      {/* Score Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 bg-surface-container-lowest p-10 rounded-xl border border-outline-variant card-shadow flex flex-col items-center text-center">
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
                  <Cell fill="#00386c" stroke="none" />
                  <Cell fill="#eceef0" stroke="none" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-heading text-5xl font-extrabold text-on-surface">{audit.overallScore}</span>
              <span className="text-[10px] font-bold text-outline uppercase tracking-widest">Score</span>
            </div>
          </div>
          <h3 className="font-heading text-2xl font-bold text-on-surface mb-2">
            {audit.overallScore > 80 ? "Excellent" : audit.overallScore > 60 ? "Good" : "Needs Improvement"}
          </h3>
          <p className="text-sm text-on-surface-variant leading-relaxed">{audit.aiSummary}</p>
        </div>

        <div className="lg:col-span-8 bg-surface-container-lowest p-10 rounded-xl border border-outline-variant card-shadow">
          <h3 className="font-heading text-xl font-bold text-on-surface mb-8">Performance Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { label: "SEO", score: audit.seoScore },
              { label: "Review", score: audit.reviewScore },
              { label: "Engagement", score: audit.engagementScore },
              { label: "Completeness", score: audit.completenessScore },
            ].map((metric, i) => (
              <div key={i} className="p-6 bg-surface rounded-xl border border-outline-variant text-center">
                <div className="text-[10px] font-bold text-outline uppercase mb-4">{metric.label}</div>
                <div className="font-heading text-3xl font-extrabold text-on-surface mb-2">{metric.score}%</div>
                <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${metric.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-surface-container-lowest p-10 rounded-xl border border-outline-variant card-shadow">
          <h3 className="font-heading text-xl font-bold text-on-surface mb-8">Sentiment Analysis</h3>

          {posPercent === 0 && neuPercent === 0 && negPercent === 0 ? (
            <div className="h-64 w-full flex flex-col items-center justify-center text-center p-6 bg-surface rounded-xl border border-outline-variant border-dashed">
              <MaterialIcon name="star" size={40} className="text-outline mb-3" />
              <p className="text-sm font-bold text-on-surface">Not Enough Data</p>
              <p className="text-xs text-on-surface-variant mt-1 max-w-[200px]">
                This business currently has 0 reviews on Google Maps. Start collecting reviews to see sentiment insights!
              </p>
            </div>
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sentimentData} innerRadius={60} outerRadius={80} dataKey="value">
                      {sentimentData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-around mt-8">
                {sentimentData.map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="text-lg font-bold" style={{ color: item.color }}>
                      {item.value}%
                    </div>
                    <div className="text-[10px] text-outline uppercase font-bold">{item.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="font-heading text-xl font-bold text-on-surface">AI Prioritized Actions</h3>
          {recommendations.slice(0, 4).map((rec: any, i: number) => (
            <div
              key={i}
              className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow relative overflow-hidden group"
            >
              <div
                className={cn(
                  "absolute top-0 left-0 w-1 h-full",
                  rec.priority === "High" ? "bg-error" : "bg-primary"
                )}
              />
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">
                  {rec.title}
                </h4>
                <span className="text-[8px] font-bold px-2 py-1 rounded bg-surface-container text-on-surface-variant uppercase tracking-widest">
                  {rec.priority}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">{rec.description}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
