'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEMO_ACCOUNTS, useAuth } from '@/lib/auth';
import { BUSINESS } from '@/lib/config';

export default function LoginPage() {
  const router = useRouter();
  const { session, loading, signIn, mode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !session) return;
    router.replace(session.role === 'worker' ? '/staff' : '/dashboard');
  }, [loading, session, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      // Redirect handled by the effect above once `session` updates —
      // avoids sending a worker to /dashboard for one render before bouncing.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="row gap-12">
          <span className="brand-mark" style={{ background: 'rgba(255,255,255,0.16)' }}>JR</span>
          <span className="strong">{BUSINESS.name}</span>
        </div>

        <div>
          <h2>Where is every car, who is working on it, and when will it be ready?</h2>
          <p>
            The operations floor for {BUSINESS.branch}. Register a vehicle in seconds, assign the
            worker who is genuinely free, and watch every cleaning timer against its target.
          </p>

          <div className="login-points">
            <div className="login-point"><span aria-hidden>→</span> Live queue with per-vehicle countdowns</div>
            <div className="login-point"><span aria-hidden>→</span> Worker availability, bucketed by minutes</div>
            <div className="login-point"><span aria-hidden>→</span> Overdue jobs surfaced the moment they slip</div>
            <div className="login-point"><span aria-hidden>→</span> Daily records, reports and Excel export</div>
          </div>
        </div>

        <div className="tiny" style={{ color: 'rgba(243,240,231,0.55)' }}>
          {BUSINESS.branch} · {BUSINESS.timezone}
        </div>
      </aside>

      <main className="login-main">
        <div className="login-card stack gap-20">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em' }}>Sign in</h1>
            <p className="small muted" style={{ marginTop: 4 }}>
              Staff access to the operations dashboard.
            </p>
          </div>

          <form onSubmit={submit} className="stack gap-14">
            {error && <div className="banner banner-alert">{error}</div>}

            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </label>

            <label className="field">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {mode === 'demo' && (
            <div className="card">
              <div className="card-head">
                <span className="card-title">Demo accounts</span>
                <div className="spacer" />
                <span className="card-note">No Supabase configured</span>
              </div>
              <div className="card-body stack gap-8">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="btn btn-block"
                    style={{ justifyContent: 'space-between' }}
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                  >
                    <span>{account.fullName}</span>
                    <span className="tiny muted" style={{ textTransform: 'capitalize' }}>
                      {account.role}
                    </span>
                  </button>
                ))}
                <p className="tiny muted">
                  Click an account to fill the form. Password for both: <code>jrhq2026</code>
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
