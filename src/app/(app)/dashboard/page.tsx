'use client';

import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { AvailabilityBoard } from '@/components/AvailabilityBoard';
import { JobTable } from '@/components/JobTable';
import { Stat, StatGrid } from '@/components/StatGrid';
import { buildDayOverview } from '@/lib/derive';
import { BUSINESS } from '@/lib/config';
import { useOps } from '@/lib/ops-context';
import { formatClock, formatLongDate } from '@/lib/time';
import type { LiveJob } from '@/lib/types';

type QueueFilter = 'active' | 'waiting' | 'overdue' | 'flagged' | 'completed';

export default function DashboardPage() {
  const { jobs, workers, today, ready, error, mode } = useOps();
  const [filter, setFilter] = useState<QueueFilter>('active');

  const todayJobs = useMemo(() => jobs.filter((j) => j.date === today), [jobs, today]);
  const overview = useMemo(
    () => buildDayOverview(jobs, workers, today),
    [jobs, workers, today],
  );

  const overdue = todayJobs.filter((j) => j.displayStatus === 'overdue');
  const flagged = todayJobs.filter((j) => j.hasFlag);

  const queue: LiveJob[] = useMemo(() => {
    const sortActive = (a: LiveJob, b: LiveJob) => a.remainingSeconds - b.remainingSeconds;
    switch (filter) {
      case 'waiting':
        return todayJobs.filter((j) => j.status === 'waiting');
      case 'overdue':
        return overdue.slice().sort(sortActive);
      case 'flagged':
        return flagged.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      case 'completed':
        return todayJobs
          .filter((j) => j.status === 'completed')
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      default:
        return todayJobs
          .filter((j) => j.status === 'in_progress' || j.status === 'waiting')
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
            return sortActive(a, b);
          });
    }
  }, [filter, todayJobs, overdue, flagged]);

  if (!ready) return <div className="empty">Loading the floor…</div>;

  return (
    <div className="stack gap-16 content-narrow">
      {error && <div className="banner banner-alert">{error}</div>}

      {/* --- Today's overview ------------------------------------------- */}
      <section className="stack gap-8">
        <div className="row gap-12 wrap">
          <h2 className="section-title">Today&apos;s overview</h2>
          <span className="tiny muted">{formatLongDate(today)}</span>
          <div className="spacer" />
          <span className="tiny muted">
            {mode === 'live' ? 'Live · Supabase realtime' : 'Demo data · this browser'}
          </span>
        </div>

        <StatGrid>
          <Stat label="Vehicles today" value={overview.vehiclesToday} foot="Registered arrivals" />
          <Stat label="Currently washing" value={overview.currentlyWashing} foot="Timers running" />
          <Stat label="Completed" value={overview.completed} foot="Handed back" tone="good" />
          <Stat label="Waiting" value={overview.waiting} foot="Not yet started" tone={overview.waiting > 3 ? 'attn' : undefined} />
          <Stat label="Workers available" value={overview.workersAvailable} foot="Can start now" tone={overview.workersAvailable === 0 ? 'attn' : 'good'} />
          <Stat label="Finishing soon" value={overview.workersFinishingSoon} foot="Free within 5 min" />
          <Stat label="Overdue jobs" value={overview.overdueJobs} foot="Past target time" tone={overview.overdueJobs > 0 ? 'alert' : undefined} />
          <Stat label="Flagged" value={overview.flaggedJobs} foot="Suspiciously fast completion" tone={overview.flaggedJobs > 0 ? 'alert' : undefined} />
          <Stat
            label="Collected"
            value={`${overview.revenueCollected.toLocaleString()}`}
            foot={`${BUSINESS.currency} · ${overview.unpaid} unpaid`}
          />
        </StatGrid>
      </section>

      {/* --- Overdue call-out -------------------------------------------- */}
      {overdue.length > 0 && (
        <motion.div
          className="banner banner-alert"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="strong">
            {overdue.length} {overdue.length === 1 ? 'job is' : 'jobs are'} past target
          </span>
          <span aria-hidden>·</span>
          <span>
            {overdue
              .slice(0, 3)
              .map(
                (j) =>
                  `${j.plateNumber} (${j.currentStage?.workerNames.join(', ') || 'unassigned'}, expected ${formatClock(j.currentStage?.expectedCompletionTime ?? null)})`,
              )
              .join('  ·  ')}
            {overdue.length > 3 ? `  ·  +${overdue.length - 3} more` : ''}
          </span>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => setFilter('overdue')}>
            Show overdue
          </button>
        </motion.div>
      )}

      {/* --- Flagged call-out ---------------------------------------------- */}
      {flagged.length > 0 && (
        <motion.div
          className="banner banner-attn"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="strong">
            {flagged.length} {flagged.length === 1 ? 'completion needs' : 'completions need'} review
          </span>
          <span aria-hidden>·</span>
          <span>Finished in well under the target time, worth a quick check.</span>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => setFilter('flagged')}>
            Show flagged
          </button>
        </motion.div>
      )}

      {/* --- Worker availability ----------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <span className="card-title">Worker availability</span>
          <span className="card-note">Updates automatically from active timers</span>
          <div className="spacer" />
          <span className="tiny muted">{workers.length} on the roster</span>
        </div>
        <AvailabilityBoard workers={workers} />
      </section>

      {/* --- Live queue --------------------------------------------------- */}
      <section className="card">
        <div className="card-head">
          <span className="card-title">Live vehicle queue</span>
          <div className="spacer" />
          <div className="segmented">
            {(
              [
                ['active', `Active (${todayJobs.filter((j) => j.isActive).length})`],
                ['waiting', `Waiting (${overview.waiting})`],
                ['overdue', `Overdue (${overdue.length})`],
                ['flagged', `Flagged (${flagged.length})`],
                ['completed', `Completed (${overview.completed})`],
              ] as [QueueFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body tight">
          <JobTable
            jobs={queue}
            emptyMessage={
              filter === 'overdue'
                ? 'Nothing is running late.'
                : filter === 'flagged'
                  ? 'Nothing flagged right now.'
                  : filter === 'waiting'
                    ? 'No vehicles are waiting.'
                    : 'No vehicles on the floor right now.'
            }
          />
        </div>
      </section>
    </div>
  );
}
