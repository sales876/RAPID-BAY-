'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useOps } from '@/lib/ops-context';
import { NotificationBell } from '@/components/NotificationBell';

/**
 * The staff portal shell. Deliberately separate from AppShell — a worker's
 * account never even loads the admin nav or the admin's data reach, so this
 * layout is the enforcement point on the client side (the database enforces
 * it again independently via row level security).
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const { ready } = useOps();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace('/login'); return; }
    if (session.role !== 'worker') router.replace('/dashboard');
  }, [loading, session, router]);

  if (loading || !ready || !session || session.role !== 'worker') {
    return <div className="empty" style={{ paddingTop: 120 }}>Loading your jobs…</div>;
  }

  return (
    <div className="staff-shell">
      <header className="staff-top">
        <span className="avatar" aria-hidden>{session.fullName.slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div className="name truncate">{session.fullName}</div>
          <div className="sub row gap-4" data-live-dot>
            <span className="pill-dot" aria-hidden />
            On shift
          </div>
        </div>
        <div className="spacer" />
        <NotificationBell />
        <button className="btn btn-sm btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <main className="staff-body">{children}</main>

      <nav className="staff-tabs">
        <Link href="/staff" aria-current={pathname === '/staff' ? 'page' : undefined}>
          <span aria-hidden style={{ fontSize: 18 }}>◱</span>
          My jobs
        </Link>
        <Link href="/staff/history" aria-current={pathname === '/staff/history' ? 'page' : undefined}>
          <span aria-hidden style={{ fontSize: 18 }}>◫</span>
          History
        </Link>
      </nav>
    </div>
  );
}
