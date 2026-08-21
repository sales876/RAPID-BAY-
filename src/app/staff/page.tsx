'use client';

import { useMemo, useState } from 'react';
import { StageCompleteModal } from '@/components/StageCompleteModal';
import { StageIndicator } from '@/components/StageIndicator';
import { TimerDisplay } from '@/components/TimerDisplay';
import { useAuth } from '@/lib/auth';
import { myActiveStages } from '@/lib/derive';
import { useOps } from '@/lib/ops-context';
import { formatClock } from '@/lib/time';
import type { LiveJob, LiveJobStage } from '@/lib/types';

/**
 * A worker's whole world: the car(s) assigned to them right now, and one
 * button — Complete. Nothing about other workers, other stages, payment, or
 * the rest of the floor is visible here, by design and by database policy.
 */
export default function StaffJobsPage() {
  const { session } = useAuth();
  const { jobs, snapshot, acceptStage } = useOps();
  const [completing, setCompleting] = useState<{ job: LiveJob; stage: LiveJobStage } | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);

  const workerId = session?.workerId ?? '';
  const carLabel = (id: string) => snapshot.carTypes.find((c) => c.id === id)?.label ?? id;

  const mine = useMemo(
    () => (workerId ? myActiveStages(jobs, workerId) : []),
    [jobs, workerId],
  );
  const pending = mine.filter(({ stage }) => stage.status === 'assigned');
  const active = mine.filter(({ stage }) => stage.status !== 'assigned');

  async function accept(jobId: string, stageOrder: number) {
    setAccepting(`${jobId}-${stageOrder}`);
    try {
      await acceptStage(jobId, stageOrder, workerId);
    } finally {
      setAccepting(null);
    }
  }

  if (!workerId) {
    return (
      <div className="banner banner-alert">
        This login isn&apos;t linked to a worker profile yet. Ask an admin to connect your
        account on the Workers page.
      </div>
    );
  }

  if (mine.length === 0) {
    return (
      <div className="empty" style={{ paddingTop: 40 }}>
        Nothing assigned to you right now.
        <div className="tiny" style={{ marginTop: 4 }}>Check back once reception hands you a car.</div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title" style={{ marginBottom: 12 }}>
        {mine.length} {mine.length === 1 ? 'car' : 'cars'} assigned to you
      </h2>

      {pending.map(({ job, stage }) => (
        <article key={stage.id} className="stage-card is-assigned pending-accept">
          <div className="row gap-8">
            <span className="plate">{job.plateNumber}</span>
            <div className="spacer" />
            <span className="pill pill-assigned">
              <span className="pill-dot" aria-hidden />
              New · needs acceptance
            </span>
          </div>

          <div>
            <div className="strong">{job.customerName}</div>
            <div className="small muted">{carLabel(job.carType)} · {job.serviceName}</div>
            <div className="small muted">{stage.name} · target {stage.expectedDuration} min</div>
            {stage.workerNames.length > 1 && (
              <div className="tiny muted">with {stage.workerNames.filter((n) => n !== session?.fullName).join(', ')}</div>
            )}
          </div>

          <button
            type="button"
            className="staff-btn primary"
            disabled={accepting === `${job.id}-${stage.stageOrder}`}
            onClick={() => accept(job.id, stage.stageOrder)}
          >
            {accepting === `${job.id}-${stage.stageOrder}` ? 'Accepting…' : 'Accept & start timer'}
          </button>
        </article>
      ))}

      {active.map(({ job, stage }) => (
        <article key={stage.id} className={`stage-card is-${stage.displayStatus}`}>
          <div className="row gap-8">
            <span className="plate">{job.plateNumber}</span>
            <div className="spacer" />
            {stage.workerNames.length > 1 && (
              <span className="tiny muted">with {stage.workerNames.filter((n) => n !== session?.fullName).join(', ')}</span>
            )}
          </div>

          <div>
            <div className="strong">{job.customerName}</div>
            <div className="small muted">{carLabel(job.carType)} · {job.serviceName}</div>
            <StageIndicator job={job} />
          </div>

          <TimerDisplay stage={stage} size="lg" showProgress />

          <div className="row gap-12 small muted">
            <span>Started {formatClock(stage.startTime)}</span>
            <span aria-hidden>·</span>
            <span>Due {formatClock(stage.expectedCompletionTime)}</span>
          </div>

          <button
            type="button"
            className="staff-btn primary"
            onClick={() => setCompleting({ job, stage })}
          >
            Complete {stage.name}
          </button>
        </article>
      ))}

      {completing && (
        <StageCompleteModal
          job={completing.job}
          stage={completing.stage}
          workerId={workerId}
          onClose={() => setCompleting(null)}
        />
      )}
    </div>
  );
}
