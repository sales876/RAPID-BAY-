'use client';

import { motion } from 'framer-motion';

/**
 * The headline numbers, set as one continuous hairline-divided strip rather
 * than a row of floating tiles. A metric only takes on colour when it is
 * asking somebody to do something.
 */

const strip = { hidden: {}, show: { transition: { staggerChildren: 0.03 } } };
const cell = {
  hidden: { opacity: 0, y: 5 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const } },
};

export function Metrics({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="metrics" variants={strip} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function Metric({
  k,
  v,
  note,
  tone,
}: {
  k: string;
  v: number | string;
  note?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <motion.div className={`metric${tone ? ` is-${tone}` : ''}`} variants={cell}>
      <div className="metric-k">{k}</div>
      <motion.div
        className="metric-v"
        key={String(v)}
        initial={{ opacity: 0.35 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22 }}
      >
        {v}
      </motion.div>
      {note && <div className="metric-n">{note}</div>}
    </motion.div>
  );
}
