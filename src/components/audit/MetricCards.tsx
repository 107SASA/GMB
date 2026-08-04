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
      className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow"
    >
      <h3 className="text-label-sm text-on-surface-variant mb-2">{title}</h3>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-on-surface tracking-tight">{value}{suffix}</span>
        {trend && trendValue && (
          <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${
            trend === 'up' ? 'bg-secondary-container text-on-secondary-container' :
            trend === 'down' ? 'bg-error-container text-on-error-container' :
            'bg-surface-container text-on-surface'
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
