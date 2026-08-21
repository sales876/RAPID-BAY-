'use client';

import { useMemo, useState } from 'react';
import { WorkerCard } from '@/components/WorkerCard';
import { useAuth } from '@/lib/auth';
import { buildWorkerPerformance } from '@/lib/derive';
import { useOps } from '@/lib/ops-context';
import { formatMinutes } from '@/lib/time';

type Scope = 'today' | 'week' | 'all';

export default function WorkersPage() {
  const { workers, jobs, snapshot, today, ready, repo, refresh } = useOps();
  const { can } = useAuth();
  const [scope, setScope] = useState<Scope>('today');
  const [newName, setNewName] = useState('');

  const carLabel = (id: string) =>
    snapshot.carTypes.find((c) => c.id === id)?.label ?? id;

  const scopedJobs = useMemo(() => {
    if (scope === 'all') return jobs;
    if (scope === 'today') return jobs.filter((j) => j.date === today);
    const cutoff = new Date(`${today}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 6);
    const from = cutoff.toISOString().slice(0, 10);
    return jobs.filter((j) => j.date >= from);
  }, [jobs, scope, today]);

  const performance = useMemo(
    () => buildWorkerPerformance(workers, scopedJobs, today),
    [workers, scopedJobs, today],
  );

  // Busiest workers first, then whoever is free — the order a manager scans in.
  const ordered = useMemo(() => {
    const rank = { overdue: 0, finishing_soon: 1, pending_accept: 2, working: 2, available: 3, on_break: 4, offline: 5 };
    return workers.slice().sort((a, b) => rank[a.displayStatus] - rank[b.displayStatus]);
  }, [workers]);

  if (!ready) return <div className="empty">Loading workers…</div>;

  return (
    <div className="stack gap-16 content-narrow">
      <section className="stack gap-12">
        <div className="row gap-12 wrap">
          <h2 className="section-title">Worker board</h2>
          <div className="spacer" />
          <span className="tiny muted">
            {workers.filter((w) => w.displayStatus === 'available').length} available ·{' '}
            {workers.filter((w) => w.currentJob).length} on a vehicle
          </span>
        </div>

        <div className="worker-grid">
          {ordered.map((worker) => (
            <WorkerCard
              key={worker.id}
              worker={worker}
              carLabel={carLabel}
              allowStatusChange={can('manage_workers')}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Worker performance</span>
          <div className="spacer" />
          <div className="segmented">
            {([['today', 'Today'], ['week', 'Last 7 days'], ['all', 'All time']] as [Scope, string][]).map(
              ([key, label]) => (
                <button key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>
                  {label}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="card-body tight table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Status</th>
                <th className="right">Stages completed</th>
                <th className="right">Active now</th>
                <th className="right">Avg target</th>
                <th className="right">Avg actual</th>
                <th className="right">Avg difference</th>
                <th className="right">On time</th>
                <th className="right">Flagged</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((row) => {
                const worker = workers.find((w) => w.id === row.workerId);
                const diff = row.avgDifference;
                return (
                  <tr key={row.workerId}>
                    <td className="strong">{row.name}</td>
                    <td className="small muted" style={{ textTransform: 'capitalize' }}>
                      {worker?.displayStatus.replace('_', ' ')}
                    </td>
                    <td className="right mono">{row.completed}</td>
                    <td className="right mono">{row.activeJobs}</td>
                    <td className="right mono">{formatMinutes(row.avgTarget)}</td>
                    <td className="right mono">{formatMinutes(row.avgActual)}</td>
                    <td
                      className="right mono strong"
                      style={{
                        color:
                          diff === null ? 'var(--muted)' : diff > 0.5 ? 'var(--danger)' : diff < -0.5 ? 'var(--ok)' : undefined,
                      }}
                    >
                      {diff === null
                        ? '-'
                        : diff > 0
                          ? `${Math.round(diff)} min slower`
                          : diff < 0
                            ? `${Math.abs(Math.round(diff))} min faster`
                            : 'On target'}
                    </td>
                    <td className="right mono">
                      {row.onTimeRate === null ? '-' : `${Math.round(row.onTimeRate * 100)}%`}
                    </td>
                    <td className="right mono" style={{ color: row.flagged > 0 ? 'var(--danger)' : undefined }}>
                      {row.flagged || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {can('manage_workers') && (
        <section className="card">
          <div className="card-head">
            <span className="card-title">Roster</span>
            <span className="card-note">
              Removing a worker keeps their history: they simply stop appearing for assignment.
              A staff-portal login is created in Supabase Authentication, then linked to a name here.
            </span>
          </div>
          <div className="card-body stack gap-12">
            <form
              className="row gap-8"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                await repo.saveWorker({ name: newName.trim() });
                setNewName('');
                await refresh();
              }}
            >
              <input
                className="input"
                style={{ maxWidth: 260 }}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Add worker name"
                aria-label="New worker name"
              />
              <button className="btn btn-primary" type="submit">Add worker</button>
            </form>

            <div className="row gap-8 wrap">
              {workers.map((worker) => (
                <span key={worker.id} className="avail-chip" style={{ marginBottom: 0 }}>
                  <span className="name">{worker.name}</span>
                  {worker.hasAccount && (
                    <span className="pill pill-completed" style={{ marginLeft: 2 }}>
                      <span className="pill-dot" aria-hidden />
                      App access
                    </span>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${worker.name} from the active roster?`)) return;
                      await repo.removeWorker(worker.id);
                      await refresh();
                    }}
                  >
                    Remove
                  </button>
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
