'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured } from './config';
import { getSupabaseClient } from './supabase/client';
import type { Role, Session } from './types';

/**
 * Three roles, structured so permissions are asked for by name
 * (`can('manage_services')`), not by comparing role strings inline.
 *
 * `worker` is deliberately the narrowest: a floor account only ever sees and
 * acts on stages it is personally assigned to (enforced again at the database
 * with row level security — this list controls what the UI *offers*, RLS
 * controls what the server actually *allows*).
 */
const PERMISSIONS: Record<Role, string[]> = {
  admin: [
    'view_dashboard', 'register_vehicle', 'assign_worker', 'complete_job',
    'update_payment', 'view_reports', 'export_data', 'manage_services',
    'manage_workers', 'view_settings', 'review_flags', 'confirm_handover',
  ],
  receptionist: [
    'view_dashboard', 'register_vehicle', 'assign_worker', 'complete_job',
    'update_payment', 'view_reports', 'confirm_handover',
  ],
  worker: [
    'view_my_jobs', 'complete_my_stage',
  ],
};

const DEMO_SESSION_KEY = 'jrhq.session.v1';

/** Demo credentials, shown on the sign-in screen when Supabase is absent. */
export const DEMO_ACCOUNTS = [
  {
    email: 'manager@jrhq.app',
    password: 'jrhq2026',
    fullName: 'Operations Manager',
    role: 'admin' as Role,
  },
  {
    email: 'reception@jrhq.app',
    password: 'jrhq2026',
    fullName: 'Front Desk',
    role: 'receptionist' as Role,
  },
  {
    email: 'ahmed@jrhq.app',
    password: 'jrhq2026',
    fullName: 'Ahmed',
    role: 'worker' as Role,
    workerId: 'wrk-ahmed',
  },
];

interface AuthValue {
  session: Session | null;
  loading: boolean;
  mode: 'demo' | 'live';
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  can(permission: string): boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const mode = isSupabaseConfigured ? 'live' : 'demo';

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const supabase = getSupabaseClient();
      if (!supabase) {
        const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
        if (!cancelled) {
          setSession(raw ? (JSON.parse(raw) as Session) : null);
          setLoading(false);
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role, worker_id')
        .eq('id', user.id)
        .maybeSingle();

      if (!cancelled) {
        setSession({
          userId: user.id,
          email: user.email ?? '',
          fullName: profile?.full_name || user.email || 'Staff',
          role: (profile?.role as Role) ?? 'receptionist',
          workerId: profile?.worker_id ?? null,
        });
        setLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      const account = DEMO_ACCOUNTS.find(
        (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.password === password,
      );
      if (!account) throw new Error('Incorrect email or password.');
      const next: Session = {
        userId: `demo-${account.role}-${account.email}`,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        workerId: 'workerId' in account ? account.workerId : null,
      };
      window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(next));
      setSession(next);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const user = data.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, role, worker_id')
      .eq('id', user.id)
      .maybeSingle();

    setSession({
      userId: user.id,
      email: user.email ?? '',
      fullName: profile?.full_name || user.email || 'Staff',
      role: (profile?.role as Role) ?? 'receptionist',
      workerId: profile?.worker_id ?? null,
    });
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    else window.localStorage.removeItem(DEMO_SESSION_KEY);
    setSession(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      mode,
      signIn,
      signOut,
      can: (permission: string) =>
        Boolean(session && PERMISSIONS[session.role]?.includes(permission)),
    }),
    [session, loading, mode, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
