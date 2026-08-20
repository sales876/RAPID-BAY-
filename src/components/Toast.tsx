'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type Tone = 'ok' | 'attn' | 'alert';
interface ToastItem { id: number; message: string; detail?: string; tone: Tone }

const ToastContext = createContext<{
  notify(message: string, detail?: string, tone?: Tone): void;
} | null>(null);

/** How long one toast stays up before the next in line takes its place. */
const TOAST_DURATION_MS = 5000;

/**
 * A queue, not a stack. Showing every notification at once used to pile
 * banners up the screen — on a phone that's tall enough to cover the whole
 * viewport and block scrolling underneath. One toast is visible at a time;
 * everything else waits its turn and a small counter says how many are next,
 * so nothing gets silently dropped either.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const notify = useCallback((message: string, detail?: string, tone: Tone = 'ok') => {
    nextId.current += 1;
    setQueue((prev) => [...prev, { id: nextId.current, message, detail, tone }]);
  }, []);

  const current = queue[0] ?? null;
  const advance = useCallback(() => setQueue((prev) => prev.slice(1)), []);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(advance, TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [current, advance]);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              className={`banner banner-${current.tone === 'ok' ? 'info' : current.tone}`}
              style={{ boxShadow: 'var(--shadow-pop)', background: 'var(--surface)', cursor: 'pointer', width: '100%' }}
              onClick={advance}
              title="Tap to dismiss"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <div>
                <div className="strong">{current.message}</div>
                {current.detail && <div className="small muted">{current.detail}</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {queue.length > 1 && (
          <span className="tiny muted" style={{ background: 'var(--surface)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--line)' }}>
            +{queue.length - 1} more
          </span>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
