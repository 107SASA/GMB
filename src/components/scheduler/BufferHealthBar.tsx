import React from 'react';
import { motion } from 'framer-motion';

interface BufferHealthBarProps {
  daysCovered: number;
  healthStatus: string;
}

export default function BufferHealthBar({ daysCovered, healthStatus }: BufferHealthBarProps) {
  const percentage = Math.min(100, Math.round((daysCovered / 7) * 100));
  
  const statusColors = {
    Healthy: 'from-emerald-400 to-emerald-500',
    Warning: 'from-amber-400 to-amber-500',
    Critical: 'from-rose-400 to-rose-500',
  };

  const badgeColors = {
    Healthy: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Warning: 'bg-amber-100 text-amber-800 border-amber-200',
    Critical: 'bg-rose-100 text-rose-800 border-rose-200',
  };

  const bgGradient = statusColors[healthStatus as keyof typeof statusColors] || statusColors.Healthy;
  const badgeColor = badgeColors[healthStatus as keyof typeof badgeColors] || badgeColors.Healthy;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row items-center gap-6">
      <div className="flex-shrink-0 text-center md:text-left">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Buffer Health</h3>
        <div className="flex items-center gap-3 justify-center md:justify-start">
          <span className="text-3xl font-black text-slate-900">{daysCovered}<span className="text-xl text-slate-400">/7</span></span>
          <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${badgeColor}`}>
            {healthStatus}
          </span>
        </div>
      </div>
      
      <div className="flex-grow w-full">
        <div className="flex justify-between text-xs font-semibold text-slate-500 mb-2">
          <span>0 Days (Empty)</span>
          <span>7 Days (Optimal)</span>
        </div>
        <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden relative">
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
