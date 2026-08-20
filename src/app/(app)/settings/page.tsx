'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { BUSINESS, FINISHING_SOON_MINUTES } from '@/lib/config';
import { exportToExcel } from '@/lib/export/excel';
import { useOps } from '@/lib/ops-context';

interface IntegrationStatus {
  supabase: { configured: boolean; serviceRole: boolean; url: string | null };
  googleSheets: {
    configured: boolean;
    tabName: string | null;
    serviceAccount: string | null;
    spreadsheetId: string | null;
  };
}

export default function SettingsPage() {
  const { snapshot, jobs, mode, repo, refresh } = useOps();
  const { session } = useAuth();
  const { notify } = useToast();

  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function backfillSheets() {
    setSyncing(true);
    try {
      const response = await fetch('/api/sheets/backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // In demo mode the records live in this browser, so send them along.
        body: JSON.stringify(mode === 'demo' ? { jobs: snapshot.jobs } : {}),
      });
      const result = await response.json();
      if (result.ok) notify('Google Sheet rebuilt', `${result.rows} rows written`);
      else notify('Sheets sync failed', result.error, 'alert');
    } catch (err) {
      notify('Sheets sync failed', err instanceof Error ? err.message : undefined, 'alert');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="stack gap-16 content-narrow" style={{ maxWidth: 900 }}>
      <section className="card">
        <div className="card-head">
          <span className="card-title">Business</span>
          <span className="card-note">Set through environment variables</span>
        </div>
        <div className="card-body">
          <dl className="stack gap-12" style={{ margin: 0 }}>
            <Row label="Business name" value={BUSINESS.name} />
            <Row label="Branch" value={BUSINESS.branch} />
            <Row label="Timezone" value={BUSINESS.timezone} hint="Sets the business day boundary and all displayed times" />
            <Row label="Currency" value={BUSINESS.currency} />
            <Row
              label="Finishing soon threshold"
              value={`${FINISHING_SOON_MINUTES} minutes`}
              hint="Remaining time at which a job and its worker are flagged"
            />
            <Row label="Signed in as" value={`${session?.fullName} (${session?.role})`} />
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Data &amp; integrations</span>
          <div className="spacer" />
          <span className={`pill ${mode === 'live' ? 'pill-completed' : 'pill-waiting'}`}>
            <span className="pill-dot" aria-hidden />
            {mode === 'live' ? 'Live' : 'Demo'}
          </span>
        </div>

        <div className="card-body stack gap-16">
          <Integration
            title="Supabase"
            connected={Boolean(status?.supabase.configured)}
            detail={
              status?.supabase.configured
                ? `Connected to ${status.supabase.url}${status.supabase.serviceRole ? ' · service role key present' : ' · service role key missing'}`
                : 'Not configured. Records are stored in this browser only.'
            }
            help={
              <>
                Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then run{' '}
                <code>supabase/schema.sql</code> and <code>supabase/seed.sql</code> in the SQL
                editor. Realtime updates switch on automatically.
              </>
            }
          />

          <Integration
            title="Google Sheets"
            connected={Boolean(status?.googleSheets.configured)}
            detail={
              status?.googleSheets.configured
                ? `Writing to tab "${status.googleSheets.tabName}" · sheet ${status.googleSheets.spreadsheetId}`
                : 'Not configured. Job records are not being mirrored to a spreadsheet.'
            }
            help={
              status?.googleSheets.serviceAccount ? (
                <>
                  Share the spreadsheet with <code>{status.googleSheets.serviceAccount}</code> as an
                  Editor. Every job create and update is mirrored automatically; one row per job,
                  keyed by Job ID.
                </>
              ) : (
                <>
                  Set <code>GOOGLE_SHEETS_SPREADSHEET_ID</code>,{' '}
                  <code>GOOGLE_SHEETS_CLIENT_EMAIL</code> and{' '}
                  <code>GOOGLE_SHEETS_PRIVATE_KEY</code> from a Google service account, then share
                  the spreadsheet with that address.
                </>
              )
            }
            action={
              <button
                className="btn btn-sm"
                disabled={!status?.googleSheets.configured || syncing}
                onClick={backfillSheets}
              >
                {syncing ? 'Syncing…' : 'Rebuild sheet now'}
              </button>
            }
          />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Export</span>
          <span className="card-note">Formatted workbook: summary, worker performance, records</span>
        </div>
        <div className="card-body row gap-8 wrap">
          <button
            className="btn btn-primary"
            onClick={() =>
              exportToExcel({
                jobs: snapshot.jobs,
                workers: snapshot.workers,
                carTypes: snapshot.carTypes,
                periodLabel: 'All records',
              })
            }
            disabled={!snapshot.jobs.length}
          >
            Export all records
          </button>
          <span className="small muted">
            {snapshot.jobs.length} records · {jobs.filter((j) => j.isActive).length} active
          </span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Roles</span>
          <span className="card-note">
            Worker logins are created in Supabase Authentication, then linked to a name on the
            Workers page. A worker's account only ever sees stages assigned to them — enforced
            again at the database, not just hidden in this UI.
          </span>
        </div>
        <div className="card-body tight table-wrap">
          <table className="data">
            <thead>
              <tr><th>Capability</th><th>Admin / Manager</th><th>Receptionist</th><th>Worker</th></tr>
            </thead>
            <tbody>
              {[
                ['Register vehicles and assign workers', true, true, false],
                ['Complete a stage they are assigned to', true, true, true],
                ['Confirm handover (independent of the worker)', true, true, false],
                ['View live queue and worker availability', true, true, false],
                ['View their own assigned / completed jobs only', false, false, true],
                ['Review and clear fraud flags', true, false, false],
                ['View reports and export data', true, true, false],
                ['Manage services, durations and car types', true, false, false],
                ['Manage the worker roster', true, false, false],
                ['View settings and integrations', true, false, false],
              ].map(([label, admin, reception, worker]) => (
                <tr key={label as string}>
                  <td>{label}</td>
                  <td>{admin ? '✓' : '—'}</td>
                  <td>{reception ? '✓' : '—'}</td>
                  <td>{worker ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Fraud prevention</span>
          <span className="card-note">How a false "complete" gets caught</span>
        </div>
        <div className="card-body stack gap-8 small">
          <p style={{ margin: 0 }}>
            A stage completed in under half its target time is <strong>automatically flagged</strong> —
            visible on the Dashboard and in Reports, with the exact minutes shown. No one has to
            go looking for it.
          </p>
          <p style={{ margin: 0 }}>
            Every completion records <strong>who</strong> completed it, separately from who the job
            is assigned to — so reassigning a stage never blurs the accountability trail.
          </p>
          <p style={{ margin: 0 }}>
            Once every stage is done, the car isn&apos;t considered handed back until reception or
            an admin taps <strong>Confirm handover</strong> — a second, independent check that
            doesn&apos;t rely on the worker&apos;s own claim.
          </p>
        </div>
      </section>

      {mode === 'demo' && repo.reseed && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">Demo data</span>
            <span className="card-note">Only available while Supabase is not configured</span>
          </div>
          <div className="card-body row gap-8 wrap">
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!window.confirm('Rebuild the demo floor? Current demo records are replaced.')) return;
                await repo.reseed?.();
                await refresh();
                notify('Demo data rebuilt', 'Timers, queue and history are freshly staged');
              }}
            >
              Reset demo floor
            </button>
            <span className="small muted">
              Restages active vehicles, worker states and two weeks of history relative to now.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="row gap-16" style={{ alignItems: 'baseline' }}>
      <dt className="field-label" style={{ width: 210, flex: '0 0 210px' }}>{label}</dt>
      <dd style={{ margin: 0 }}>
        <div className="strong">{value}</div>
        {hint && <div className="tiny muted">{hint}</div>}
      </dd>
    </div>
  );
}

function Integration({
  title,
  connected,
  detail,
  help,
  action,
}: {
  title: string;
  connected: boolean;
  detail: string;
  help: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="stack gap-8" style={{ paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
      <div className="row gap-8 wrap">
        <span className="strong">{title}</span>
        <span className={`pill ${connected ? 'pill-completed' : 'pill-cancelled'}`}>
          <span className="pill-dot" aria-hidden />
          {connected ? 'Connected' : 'Not configured'}
        </span>
        <div className="spacer" />
        {action}
      </div>
      <div className="small">{detail}</div>
      <div className="tiny muted">{help}</div>
    </div>
  );
}
