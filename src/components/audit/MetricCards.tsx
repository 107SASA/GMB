'use client';

import { motion } from 'framer-motion';

interface MetricCardProps {
  title: string;
  value: number | string;
  suffix?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  delay?: number;
}

export function MetricCard({ title, value, suffix = '', trend, trendValue, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
    >
      <h3 className="text-sm font-medium text-slate-500 mb-2">{title}</h3>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-slate-900 tracking-tight">{value}{suffix}</span>
        {trend && trendValue && (
          <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${
            trend === 'up' ? 'bg-green-100 text-green-700' :
            trend === 'down' ? 'bg-red-100 text-red-700' :
            'bg-slate-100 text-slate-700'
          }`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '-'} {trendValue}
          </span>
        )}
      </div>
    </motion.div>
  );
}

interface MetricCardsGridProps {
  metrics: {
    title: string;
    value: number | string;
    suffix?: string;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
  }[];
}

export default function MetricCardsGrid({ metrics }: MetricCardsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, idx) => (
        <MetricCard key={idx} {...metric} delay={idx * 0.1} />
      ))}
    </div>
  );
}
