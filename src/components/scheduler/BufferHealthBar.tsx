import React from 'react';
import { motion } from 'framer-motion';

interface BufferHealthBarProps {
  scheduled: number;
  target: number;
  healthStatus: string;
}

export default function BufferHealthBar({ scheduled, target, healthStatus }: BufferHealthBarProps) {
  const percentage = target > 0 ? Math.min(100, Math.round((scheduled / target) * 100)) : 0;
  
  const statusColors = {
    Healthy: 'from-secondary to-secondary',
    Warning: 'from-error to-error',
    Critical: 'from-error to-error',
  };

  const badgeColors = {
    Healthy: 'bg-secondary-container text-on-secondary-container border-secondary-fixed',
    Warning: 'bg-error-container text-on-error-container border-error-container',
    Critical: 'bg-error-container text-error border-error-container',
  };

  const bgGradient = statusColors[healthStatus as keyof typeof statusColors] || statusColors.Healthy;
  const badgeColor = badgeColors[healthStatus as keyof typeof badgeColors] || badgeColors.Healthy;

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant p-6 flex flex-col md:flex-row items-center gap-6">
      <div className="flex-shrink-0 text-center md:text-left">
        <h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider mb-1">Buffer Health</h3>
        <div className="flex items-center gap-3 justify-center md:justify-start">
          <span className="text-3xl font-black text-on-surface">{scheduled}<span className="text-xl text-outline">/{target}</span></span>
          <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${badgeColor}`}>
            {healthStatus}
          </span>
        </div>
        <p className="text-xs text-outline mt-1">posts scheduled this week</p>
      </div>

      <div className="flex-grow w-full">
        <div className="flex justify-between text-xs font-semibold text-on-surface-variant mb-2">
          <span>Empty week</span>
          <span>{target} posts (Optimal)</span>
        </div>
        <div className="h-4 w-full bg-surface-container rounded-full overflow-hidden relative">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className={`absolute top-0 left-0 h-full rounded-full bg-gradient-to-r ${bgGradient}`}
          />
        </div>
      </div>
    </div>
  );
}
