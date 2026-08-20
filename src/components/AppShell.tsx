'use client';

import { AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { BUSINESS } from '@/lib/config';
import { useOps } from '@/lib/ops-context';
import { Headline } from './Motion';
import { NewVehicleModal } from './NewVehicleModal';
import { NotificationBell } from './NotificationBell';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '◱', permission: 'view_dashboard', mobile: true },
  { href: '/vehicles', label: 'Vehicles', icon: '▤', permission: 'view_dashboard', mobile: true },
  { href: '/workers', label: 'Workers', icon: '◍', permission: 'view_dashboard', mobile: true },
  { href: '/reports', label: 'Reports', icon: '◫', permission: 'view_reports', mobile: true },
  { href: '/services', label: 'Services', icon: '⚙', permission: 'manage_services', mobile: false },
  { href: '/settings', label: 'Settings', icon: '⚑', permission: 'view_settings', mobile: false },
];

const TITLES: Record<string, { title: string; sub: string }> = {
  '/dashboard': { title: 'Operations Dashboard', sub: 'Where every car is, right now' },
  '/vehicles': { title: 'Vehicles', sub: 'Every job record, searchable' },
  '/workers': { title: 'Workers', sub: 'Availability and performance' },
  '/reports': { title: 'Reports', sub: 'Historical data and analytics' },
  '/services': { title: 'Services', sub: 'Services, car types and durations' },
  '/settings': { title: 'Settings', sub: 'Business configuration and integrations' },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, loading, can, signOut, mode } = useAuth();
  const { jobs, today } = useOps();
  const [registering, setRegistering] = useState(false);
  const [clock, setClock] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace('/login'); return; }
    // A worker account has its own portal — never the admin/reception shell.
    if (session.role === 'worker') router.replace('/staff');
  }, [loading, session, router]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: true, timeZone: BUSINESS.timezone,
        }).format(new Date()).toUpperCase(),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (loading || !session || session.role === 'worker') {
    return <div className="empty" style={{ paddingTop: 120 }}>Loading operations…</div>;
  }

  const overdueCount = jobs.filter(
    (j) => j.displayStatus === 'overdue' && j.date === today,
  ).length;

  const visible = NAV.filter((item) => can(item.permission));
  const meta = TITLES[pathname] ?? { title: BUSINESS.name, sub: '' };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">JR</span>
          <span>
            <span className="brand-name" style={{ display: 'block' }}>{BUSINESS.name}</span>
            <span className="brand-sub">{BUSINESS.branch}</span>
          </span>
        </div>

        <nav className="nav">
          <div className="nav-label">Operations</div>
          {visible.slice(0, 4).map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} badge={item.href === '/dashboard' ? overdueCount : 0} />
          ))}
          {visible.length > 4 && <div className="nav-label">Configuration</div>}
          {visible.slice(4).map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} badge={0} />
          ))}
        </nav>

        <div className="sidebar-foot stack gap-8">
          {mode === 'demo' && (
            <div className="tiny muted">
              Demo mode — data is stored in this browser. Add Supabase credentials to go live.
            </div>
          )}
          <div className="row gap-8">
            <span className="avatar" aria-hidden>
              {session.fullName.slice(0, 2).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="small strong truncate">{session.fullName}</div>
              <div className="tiny muted" style={{ textTransform: 'capitalize' }}>{session.role}</div>
            </div>
          </div>
          <button className="btn btn-sm btn-block" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            {/* Keyed on the route so the mask replays when the page changes,
                rather than animating once on first load and never again. */}
            <Headline key={pathname} className="topbar-title">{meta.title}</Headline>
            <div className="topbar-sub">{meta.sub}</div>
          </div>
          <div className="topbar-spacer" />

          {overdueCount > 0 && (
            <Link href="/dashboard" className="pill pill-overdue desktop-only">
              <span className="pill-dot" aria-hidden />
              {overdueCount} overdue
            </Link>
          )}

          <span className="clock">
            {clock}
            <span className="caret" aria-hidden />
          </span>

          <NotificationBell />

          {can('register_vehicle') && (
            <button className="btn btn-primary desktop-only" onClick={() => setRegistering(true)}>
              + New Vehicle
            </button>
          )}
        </header>

        <main className="content">{children}</main>
      </div>

      {can('register_vehicle') && (
        <button className="fab" onClick={() => setRegistering(true)} aria-label="Register new vehicle">
          + New Vehicle
        </button>
      )}

      <nav className="mobile-nav">
        {visible
          .filter((item) => item.mobile)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        <button
          onClick={() => void signOut()}
          style={{
            border: 'none', background: 'transparent', color: 'var(--muted)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 2, fontSize: 10, padding: '8px 2px 7px', cursor: 'pointer',
          }}
        >
          <span className="nav-icon" aria-hidden style={{ fontSize: 16 }}>⏻</span>
          Sign out
        </button>
      </nav>

      <AnimatePresence>
        {registering && <NewVehicleModal onClose={() => setRegistering(false)} />}
      </AnimatePresence>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  badge,
}: {
  item: (typeof NAV)[number];
  pathname: string;
  badge: number;
}) {
  return (
    <Link
      href={item.href}
      className="nav-item"
      aria-current={pathname === item.href ? 'page' : undefined}
    >
      <span className="nav-icon" aria-hidden>{item.icon}</span>
      {item.label}
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </Link>
  );
}
