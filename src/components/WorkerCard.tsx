'use client';

import { motion } from 'framer-motion';
import { useOps } from '@/lib/ops-context';
import { formatAvailability, formatClock } from '@/lib/time';
import type { LiveWorker, WorkerBaseStatus } from '@/lib/types';
import { StageIndicator } from './StageIndicator';
import { WorkerStatusPill } from './StatusPill';
import { TimerDisplay } from './TimerDisplay';

/**
 * One worker, one card: who they are, what they are on, and when the floor can
 * hand them the next car. `layout` animates the card sliding to its new grid
 * position when the board re-sorts by status — the reordering itself becomes
 * a readable signal, not just a jump cut.
 */
export function WorkerCard({
  worker,
  carLabel,
  allowStatusChange = false,
}: {
  worker: LiveWorker;
  carLabel(id: string): string;
  allowStatusChange?: boolean;
}) {
  const { setWorkerStatus } = useOps();
  const job = worker.currentJob;
  const stage = worker.currentStage;

  return (
    <motion.article
      layout
      className={`worker-card is-${worker.displayStatus}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { duration: 0.35, ease: [0.16, 1, 0.3, 1] }, duration: 0.25 }}
      whileHover={{ y: -2, boxShadow: '0 6px 18px rgba(35, 36, 25, 0.09)' }}
    >
      <div className="row gap-8">
        <span className="avatar" aria-hidden>{worker.name.slice(0, 2).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div className="worker-name">{worker.name}</div>
          <div className="tiny muted">{worker.jobsToday} completed today</div>
        </div>
        <div className="spacer" />
        <WorkerStatusPill status={worker.displayStatus} />
      </div>

      {job && stage ? (
        <>
          <div className="stack gap-4">
            <span className="plate">{job.plateNumber}</span>
            <span className="worker-vehicle">
              {carLabel(job.carType)} · {stage.name}
              {stage.workerNames.length > 1 && (
                <span className="tiny muted"> · with {stage.workerNames.filter((n) => n !== worker.name).join(', ')}</span>
              )}
            </span>
            <StageIndicator job={job} />
          </div>

          <div className="row gap-12">
            <TimerDisplay stage={stage} size="lg" showProgress />
            <div className="spacer" />
            <div className="right tiny muted">
              <div>Started {formatClock(stage.startTime)}</div>
              <div>Due {formatClock(stage.expectedCompletionTime)}</div>
            </div>
          </div>

          <div className="tiny muted">
            {stage.displayStatus === 'overdue'
              ? 'Available as soon as this stage is completed'
              : `Next available ${formatClock(stage.expectedCompletionTime)}`}
          </div>
        </>
      ) : (
        <>
          <div className="worker-vehicle muted">No active vehicle</div>
          <div className="timer timer-md timer-idle">
            {worker.displayStatus === 'available'
              ? 'Available now'
              : worker.displayStatus === 'on_break'
                ? 'On break'
                : 'Offline'}
          </div>
        </>
      )}

      {allowStatusChange && (
        <div className="row gap-6">
          <select
            className="select"
            style={{ padding: '4px 8px', fontSize: 12 }}
            value={worker.status}
            onChange={(e) => setWorkerStatus(worker.id, e.target.value as WorkerBaseStatus)}
            aria-label={`Set ${worker.name} status`}
          >
            <option value="available">On shift</option>
            <option value="on_break">On break</option>
            <option value="offline">Offline</option>
          </select>
          <span className="tiny muted">
            {worker.activeJobs > 1 ? `${worker.activeJobs} vehicles assigned` : ''}
          </span>
        </div>
      )}

      {!allowStatusChange && !job && Number.isFinite(worker.availableInSeconds) && (
        <div className="tiny muted">{formatAvailability(worker.availableInSeconds)}</div>
      )}
    </motion.article>
  );
}
