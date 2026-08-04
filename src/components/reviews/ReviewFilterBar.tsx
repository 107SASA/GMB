import React from 'react';
import { motion } from 'framer-motion';

interface ReviewFilterBarProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  counts: Record<string, number>;
}

export default function ReviewFilterBar({ activeFilter, onFilterChange, counts }: ReviewFilterBarProps) {
  const filters = [
    { id: 'all', label: 'All Reviews' },
    { id: 'unanswered', label: 'Unanswered' },
    { id: 'critical', label: 'Critical' },
    { id: '5-star', label: '5-Star' },
    { id: 'positive', label: 'Positive' },
    { id: 'negative', label: 'Negative' }
  ];

  return (
    <div className="flex gap-2 overflow-x-auto pb-4 hide-scrollbar border-b border-outline-variant mb-6">
      {filters.map(f => (
        <button
          key={f.id}
          onClick={() => onFilterChange(f.id)}
          className={`relative px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${
            activeFilter === f.id ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface bg-surface hover:bg-surface-container'
          }`}
        >
          {activeFilter === f.id && (
            <motion.div
              layoutId="activeFilterBg"
              className="absolute inset-0 bg-surface-container-lowest border border-outline-variant shadow-sm rounded-full -z-10"
              initial={false}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
          {f.label}
          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${activeFilter === f.id ? 'bg-surface-container text-on-surface-variant' : 'bg-surface-container-high text-on-surface-variant'}`}>
            {counts[f.id] || 0}
          </span>
        </button>
      ))}
    </div>
  );
}
