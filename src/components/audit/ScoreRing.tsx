'use client';

import { motion } from 'framer-motion';

interface ScoreRingProps {
  score: number; // 0-100
  size?: number;
  strokeWidth?: number;
}

export default function ScoreRing({ score, size = 200, strokeWidth = 16 }: ScoreRingProps) {
  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let color = '#ef4444'; // red for < 50
  if (score >= 80) color = '#22c55e'; // green
  else if (score >= 50) color = '#eab308'; // yellow

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background Ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Animated Progress Ring */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
        />
      </svg>
      {/* Score Text */}
      <div className="absolute flex flex-col items-center justify-center">
        <motion.span
          className="text-4xl font-bold text-slate-900 tracking-tighter"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          {score}
        </motion.span>
        <span className="text-sm font-medium text-slate-500 uppercase tracking-wider mt-1">Score</span>
      </div>
    </div>
  );
}
