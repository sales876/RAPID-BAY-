'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useOps } from '@/lib/ops-context';
import { isAlreadySubscribed, isPushSupported, subscribeToPush } from '@/lib/push';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AppNotification } from '@/lib/types';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/**
 * Alerts for both sides of the accept workflow: a worker gets told a car has
 * been handed to them, staff get told when one finishes. Realtime delivers
 * these the instant they're written (see ops-context's subscribe()), so the
 * unread badge updates live — the count is the alert. Nothing pops up
 * uninvited; the list itself only appears once someone opens the bell, and
 * it's just a plain list, so multiple arrivals never stack on top of each
 * other the way toasts used to.
 */
export function NotificationBell() {
  const { session } = useAuth();
  const { snapshot, markNotificationRead } = useOps();
  const [open, setOpen] = useState(false);
  const [pushState, setPushState] = useState<'checking' | 'offer' | 'subscribed' | 'unavailable'>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported() || typeof Notification === 'undefined' || Notification.permission === 'denied') {
        if (!cancelled) setPushState('unavailable');
        return;
      }
      const already = await isAlreadySubscribed();
      if (!cancelled) setPushState(already ? 'subscribed' : 'offer');
    })();
    return () => { cancelled = true; };
  }, []);

  async function enablePush() {
    const supabase = getSupabaseClient();
    if (!supabase || !session) return;
    const ok = await subscribeToPush(supabase, session.userId);
    setPushState(ok ? 'subscribed' : 'unavailable');
  }

  const mine: AppNotification[] = session?.role === 'worker'
    ? snapshot.notifications.filter((n) => n.audience === 'worker' && n.workerId === session.workerId)
    : snapshot.notifications.filter((n) => n.audience === 'staff');

  const unread = mine.filter((n) => !n.readAt);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        style={{ position: 'relative' }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>&#128276;</span>
        {unread.length > 0 && (
          <span className="nav-badge" style={{ position: 'absolute', top: -4, right: -4 }}>
            {unread.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div
              onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 190 }}
            />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="notif-panel"
              style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 191,
                width: 320, maxHeight: 420, overflowY: 'auto',
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 12, boxShadow: 'var(--shadow-pop)', padding: 8,
              }}
            >
              {pushState === 'offer' && (
                <button
                  type="button"
                  onClick={() => void enablePush()}
                  className="banner banner-info"
                  style={{ width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', marginBottom: 6 }}
                >
                  <span className="small strong">Enable push notifications</span>
                  <span className="tiny muted" style={{ display: 'block' }}>
                    Get alerted even when this tab isn&apos;t open.
                  </span>
                </button>
              )}
              {mine.length === 0 ? (
                <div className="tiny muted" style={{ padding: 12 }}>Nothing yet.</div>
              ) : (
                mine.slice(0, 20).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => { if (!n.readAt) void markNotificationRead(n.id); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 10px', borderRadius: 8, border: 'none',
                      background: n.readAt ? 'transparent' : 'var(--warn-soft)',
                      cursor: n.readAt ? 'default' : 'pointer', marginBottom: 4,
                    }}
                  >
                    <div className="small strong">{n.title}</div>
                    <div className="tiny muted">{n.body}</div>
                    <div className="tiny muted">{timeAgo(n.createdAt)}</div>
                  </button>
                ))
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
