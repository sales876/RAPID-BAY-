'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useOps } from '@/lib/ops-context';
import { formatClock } from '@/lib/time';
import type { LiveJob } from '@/lib/types';
import { JobActions } from './JobActions';
import { PaymentControl } from './PaymentControl';
import { StagePhotoButton } from './PhotoViewer';
import { FlagBadge, StageIndicator } from './StageIndicator';
import { StatusPill } from './StatusPill';
import { TimerDisplay } from './TimerDisplay';

/**
 * The live queue.
 *
 * A dense table on desktop where a manager scans twenty rows at once, and
 * purpose-built cards on mobile — the same data, a layout a person can act on
 * with one thumb, rather than a shrunken table. Every worker/timer cell reads
 * from the job's current stage, so a two-leg job shows whichever leg is
 * actually running right now.
 */
export function JobTable({
  jobs,
  showActions = true,
  emptyMessage = 'No vehicles to show.',
}: {
  jobs: LiveJob[];
  showActions?: boolean;
  emptyMessage?: string;
}) {
  const { snapshot } = useOps();
  const carLabel = (id: string) =>
    snapshot.carTypes.find((c) => c.id === id)?.label ?? id;

  if (!jobs.length) {
    return <div className="empty">{emptyMessage}</div>;
  }

  return (
    <>
      <div className="table-wrap job-table">
        <table className="data">
          <thead>
            <tr>
              <th>Plate</th>
              <th>Customer</th>
              <th>Car type</th>
              <th>Service</th>
              <th>Worker</th>
              <th>Start</th>
              <th>Expected finish</th>
              <th>Time remaining</th>
              <th>Payment</th>
              <th>Status</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {jobs.map((job) => {
                const stage = job.currentStage;
                return (
                  <motion.tr
                    key={job.id}
                    className={
                      job.displayStatus === 'overdue'
                        ? 'row-overdue'
                        : job.displayStatus === 'finishing_soon'
                          ? 'row-soon'
                          : undefined
                    }
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <td><span className="plate">{job.plateNumber}</span></td>
                    <td>
                      <div className="strong">{job.customerName}</div>
                      <div className="tiny muted">{job.phone || '-'}</div>
                    </td>
                    <td>{carLabel(job.carType)}</td>
                    <td>
                      <div className="row gap-6">
                        {job.serviceName}
                        <StagePhotoButton job={job} />
                      </div>
                      <div className="tiny muted">Target {job.totalExpectedDuration} min</div>
                      <StageIndicator job={job} />
                    </td>
                    <td>
                      {stage?.workerNames.length ? stage.workerNames.join(' + ') : <span className="muted">Unassigned</span>}
                    </td>
                    <td className="mono small">{formatClock(stage?.startTime ?? null)}</td>
                    <td className="mono small">{formatClock(stage?.expectedCompletionTime ?? null)}</td>
                    <td><TimerDisplay stage={stage} cancelled={job.status === 'cancelled'} /></td>
                    <td><PaymentControl jobId={job.id} status={job.paymentStatus} /></td>
                    <td>
                      <div className="stack gap-4">
                        <StatusPill status={job.displayStatus} />
                        {job.hasFlag && <FlagBadge reason={stage?.flagReason} />}
                      </div>
                    </td>
                    {showActions && (
                      <td><JobActions job={job} /></td>
                    )}
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      <div className="job-cards">
        <AnimatePresence initial={false}>
          {jobs.map((job) => {
            const stage = job.currentStage;
            return (
              <motion.article
                key={job.id}
                layout
                className={`job-card is-${job.displayStatus}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ layout: { duration: 0.3, ease: [0.16, 1, 0.3, 1] }, duration: 0.22 }}
              >
                <div className="row gap-8">
                  <span className="plate">{job.plateNumber}</span>
                  <div className="spacer" />
                  {job.hasFlag && <FlagBadge reason={stage?.flagReason} />}
                  <StatusPill status={job.displayStatus} />
                </div>

                <div className="row gap-12">
                  <div style={{ minWidth: 0 }}>
                    <div className="strong truncate">{job.customerName}</div>
                    <div className="row gap-6">
                      <div className="small muted truncate">
                        {carLabel(job.carType)} · {job.serviceName}
                      </div>
                      <StagePhotoButton job={job} />
                    </div>
                    <StageIndicator job={job} />
                    <div className="small muted">
                      {stage?.workerNames.length ? `Worker: ${stage.workerNames.join(' + ')}` : 'Unassigned'}
                    </div>
                  </div>
                  <div className="spacer" />
                  <div className="right">
                    <TimerDisplay stage={stage} cancelled={job.status === 'cancelled'} />
                  </div>
                </div>

                <div className="row gap-8 small muted">
                  <span>Start {formatClock(stage?.startTime ?? null)}</span>
                  <span aria-hidden>·</span>
                  <span>Due {formatClock(stage?.expectedCompletionTime ?? null)}</span>
                  <div className="spacer" />
                  <PaymentControl jobId={job.id} status={job.paymentStatus} />
                </div>

                {showActions && <JobActions job={job} />}
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
}
