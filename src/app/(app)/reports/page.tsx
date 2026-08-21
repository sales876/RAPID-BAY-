'use client';

import { useMemo, useState } from 'react';
import { Stat, StatGrid } from '@/components/StatGrid';
import { useAuth } from '@/lib/auth';
import { BUSINESS } from '@/lib/config';
import { buildPeriodReport, buildWorkerPerformance } from '@/lib/derive';
import { exportToExcel } from '@/lib/export/excel';
import { useOps } from '@/lib/ops-context';
import { formatLongDate, formatMinutes, shiftDateKey } from '@/lib/time';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function startOfWeek(todayKey: string): string {
  const d = new Date(`${todayKey}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(todayKey: string): string {
  return `${todayKey.slice(0, 7)}-01`;
}

export default function ReportsPage() {
  const { jobs, workers, snapshot, today, ready } = useOps();
  const { can } = useAuth();

  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(shiftDateKey(today, -6));
  const [to, setTo] = useState(today);

  const range = useMemo(() => {
    switch (preset) {
      case 'today': return { from: today, to: today, label: `Today · ${formatLongDate(today)}` };
      case 'yesterday': {
        const y = shiftDateKey(today, -1);
        return { from: y, to: y, label: `Yesterday · ${formatLongDate(y)}` };
      }
      case 'week': {
        const start = startOfWeek(today);
        return { from: start, to: today, label: `This week · ${formatLongDate(start)} to ${formatLongDate(today)}` };
      }
      case 'month': {
        const start = startOfMonth(today);
        return { from: start, to: today, label: `This month · ${formatLongDate(start)} to ${formatLongDate(today)}` };
      }
      default:
        return { from, to, label: `${formatLongDate(from)} to ${formatLongDate(to)}` };
    }
  }, [preset, today, from, to]);

  const periodJobs = useMemo(
    () => jobs.filter((j) => j.date >= range.from && j.date <= range.to),
    [jobs, range],
  );

  const report = useMemo(() => buildPeriodReport(periodJobs), [periodJobs]);
  const performance = useMemo(
    () => buildWorkerPerformance(workers, periodJobs, today),
    [workers, periodJobs, today],
  );

  const byService = useMemo(() => {
    const map = new Map<string, { name: string; count: number; minutes: number; revenue: number }>();
    for (const job of periodJobs) {
      const entry = map.get(job.serviceName) ?? { name: job.serviceName, count: 0, minutes: 0, revenue: 0 };
      entry.count += 1;
      entry.minutes += job.totalActualDuration ?? job.totalExpectedDuration;
      if (job.paymentStatus === 'paid') entry.revenue += Number(job.price || 0);
      map.set(job.serviceName, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [periodJobs]);

  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const job of periodJobs) map.set(job.date, (map.get(job.date) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [periodJobs]);

  const maxDay = Math.max(1, ...byDay.map(([, n]) => n));
  const maxService = Math.max(1, ...byService.map((s) => s.count));

  if (!ready) return <div className="empty">Loading reports…</div>;

  return (
    <div className="stack gap-16 content-narrow">
      <section className="card">
        <div className="card-head wrap" style={{ gap: 10 }}>
          <div className="segmented">
            {(
              [
                ['today', 'Today'],
                ['yesterday', 'Yesterday'],
                ['week', 'This week'],
                ['month', 'This month'],
                ['custom', 'Custom range'],
              ] as [Preset, string][]
            ).map(([key, label]) => (
              <button key={key} aria-pressed={preset === key} onClick={() => setPreset(key)}>
                {label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="row gap-6">
              <input className="input" type="date" style={{ width: 148 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <span className="muted small">to</span>
              <input className="input" type="date" style={{ width: 148 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </div>
          )}

          <div className="spacer" />
          {can('export_data') && (
            <button
              className="btn btn-primary btn-sm"
              disabled={!periodJobs.length}
              onClick={() =>
                exportToExcel({
                  jobs: periodJobs,
                  workers: snapshot.workers,
                  carTypes: snapshot.carTypes,
                  periodLabel: range.label,
                })
              }
            >
              Export Excel
            </button>
          )}
        </div>

        <div className="card-body stack gap-12">
          <div className="small muted">{range.label}</div>

          <StatGrid>
            <Stat label="Total vehicles" value={report.totalVehicles} />
            <Stat label="Completed" value={report.completed} tone="good" />
            <Stat label="Still active" value={report.active} />
            <Stat label="Cancelled" value={report.cancelled} />
            <Stat label="Over target" value={report.overdue} tone={report.overdue > 0 ? 'attn' : undefined} />
            <Stat label="Flagged" value={report.flagged} tone={report.flagged > 0 ? 'alert' : undefined} />
            <Stat label="Avg expected" value={formatMinutes(report.avgExpected)} />
            <Stat label="Avg actual" value={formatMinutes(report.avgActual)} />
            <Stat
              label="Avg difference"
              value={
                report.avgDifference === null
                  ? '-'
                  : `${report.avgDifference > 0 ? '+' : ''}${Math.round(report.avgDifference * 10) / 10} min`
              }
              tone={report.avgDifference !== null && report.avgDifference > 0 ? 'attn' : 'good'}
            />
          </StatGrid>

          <StatGrid>
            <Stat label={`Collected (${BUSINESS.currency})`} value={report.revenueCollected.toLocaleString()} tone="good" />
            <Stat label={`Outstanding (${BUSINESS.currency})`} value={report.revenueOutstanding.toLocaleString()} tone={report.revenueOutstanding > 0 ? 'attn' : undefined} />
            <Stat label="Paid jobs" value={report.paid} />
            <Stat label="Partial" value={report.partial} />
            <Stat label="Unpaid" value={report.unpaid} />
          </StatGrid>
        </div>
      </section>

      <div className="report-grid">
        <section className="card">
          <div className="card-head">
            <span className="card-title">Vehicles per day</span>
            <div className="spacer" />
            <span className="card-note">{byDay.length} {byDay.length === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="card-body stack gap-2">
            {byDay.length === 0 && <div className="empty">No vehicles in this period.</div>}
            {byDay.map(([day, count]) => (
              <div key={day} className="bar-row">
                <span className="small muted">{formatLongDate(day).replace(/,? \d{4}$/, '')}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(count / maxDay) * 100}%` }} />
                </span>
                <span className="small mono right">{count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="card-title">Services</span>
            <div className="spacer" />
            <span className="card-note">By volume</span>
          </div>
          <div className="card-body stack gap-2">
            {byService.length === 0 && <div className="empty">No services in this period.</div>}
            {byService.map((service) => (
              <div key={service.name} className="bar-row">
                <span className="small truncate">{service.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(service.count / maxService) * 100}%` }} />
                </span>
                <span className="small mono right">{service.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Worker performance</span>
          <div className="spacer" />
          <span className="card-note">{range.label}</span>
        </div>
        <div className="card-body tight table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Worker</th>
                <th className="right">Stages completed</th>
                <th className="right">Avg target</th>
                <th className="right">Avg actual</th>
                <th className="right">Avg difference</th>
                <th className="right">On time</th>
                <th className="right">Collected ({BUSINESS.currency})</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((row) => (
                <tr key={row.workerId}>
                  <td className="strong">{row.name}</td>
                  <td className="right mono">{row.completed}</td>
                  <td className="right mono">{formatMinutes(row.avgTarget)}</td>
                  <td className="right mono">{formatMinutes(row.avgActual)}</td>
                  <td
                    className="right mono strong"
                    style={{
                      color:
                        row.avgDifference === null
                          ? 'var(--muted)'
                          : row.avgDifference > 0.5
                            ? 'var(--danger)'
                            : row.avgDifference < -0.5
                              ? 'var(--ok)'
                              : undefined,
                    }}
                  >
                    {row.avgDifference === null
                      ? '-'
                      : `${row.avgDifference > 0 ? '+' : ''}${Math.round(row.avgDifference)} min`}
                  </td>
                  <td className="right mono">
                    {row.onTimeRate === null ? '-' : `${Math.round(row.onTimeRate * 100)}%`}
                  </td>
                  <td className="right mono">{row.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
