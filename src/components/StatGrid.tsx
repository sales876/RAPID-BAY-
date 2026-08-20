'use client';

import { motion } from 'framer-motion';

/**
 * The stat-tile grid used on Dashboard, Reports and Workers. Tiles stagger in
 * on mount, and a tile's value cross-fades whenever it changes — the numbers
 * are live, and the motion says so without calling attention to itself.
 */

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const } },
};

export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="stats" variants={container} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function Stat({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: number | string;
  foot?: string;
  tone?: 'good' | 'attn' | 'alert';
}) {
  return (
    <motion.div className={`stat ${tone ?? ''}`} variants={item}>
      <div className="stat-label">{label}</div>
      <motion.div
        className="stat-value"
        key={String(value)}
        initial={{ opacity: 0.3, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        {value}
      </motion.div>
      {foot && <div className="stat-foot">{foot}</div>}
    </motion.div>
  );
}
