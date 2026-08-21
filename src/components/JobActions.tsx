'use client';

import { AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { rankWorkersForAssignment } from '@/lib/derive';
import { useAuth } from '@/lib/auth';
import { useOps } from '@/lib/ops-context';
import { notifyPush } from '@/lib/push';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatPerformance } from '@/lib/time';
import type { LiveJob } from '@/lib/types';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { WorkerMultiPicker } from './WorkerMultiPicker';

/**
 * Row actions for a job, scoped to whichever stage is currently active.
 * Completing measures that stage against its target and says so
 * immediately — that feedback loop is the point of the whole system.
 */
export function JobActions({ job }: { job: LiveJob }) {
  const {
    completeStage, cancelJob, assignStage, startStage, reassignStage, confirmHandover, workers,
  } = useOps();
  const { can } = useAuth();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const stage = job.currentStage;

  if (job.status === 'cancelled') {
    return <span className="tiny muted">-</span>;
  }

  if (job.status === 'completed') {
    if (job.handoverConfirmed || !can('confirm_handover')) {
      return <span className="tiny muted">-</span>;
    }
    return (
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await confirmHandover(job.id);
            notify(`${job.plateNumber} handed back`, 'Confirmed independently of the worker\'s own completion.');
          } finally {
            setBusy(false);
          }
        }}
        title="Independent check: confirms the car actually left with the customer"
      >
        Confirm handover
      </button>
    );
  }

  if (!stage) return <span className="tiny muted">-</span>;

  const waiting = stage.status === 'waiting';
  const pending = stage.status === 'assigned';
  const running = stage.status === 'in_progress' || stage.displayStatus === 'finishing_soon' || stage.displayStatus === 'overdue';

  async function forceStart() {
    if (!stage) return;
    setBusy(true);
    try {
      await startStage(job.id, stage.stageOrder, stage.workerIds);
      notify(
        `${job.plateNumber} · ${stage.name} force-started`,
        `${stage.workerNames.join(' + ')} · didn't wait for acceptance · target ${stage.expectedDuration} min`,
        'attn',
      );
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!stage) return;
    setBusy(true);
    try {
      const actual = Math.max(
        1,
        Math.round((Date.now() - new Date(stage.startTime ?? job.arrivalTime).getTime()) / 60_000),
      );
      const completedBy = stage.workerIds[0] ?? '';
      await completeStage(job.id, stage.stageOrder, completedBy);
      notify(
        `${job.plateNumber} · ${stage.name} completed`,
        `${stage.workerNames.join(' + ') || 'Unassigned'} · expected ${stage.expectedDuration} min, actual ${actual} min, ${formatPerformance(actual - stage.expectedDuration)}`,
        actual > stage.expectedDuration ? 'attn' : 'ok',
      );
      const supabase = getSupabaseClient();
      if (supabase) {
        void notifyPush(supabase, { audience: 'staff' }, {
          title: `${stage.workerNames.join(' + ') || 'A worker'} finished ${stage.name}`,
          body: `${job.plateNumber} · ${actual} min (target ${stage.expectedDuration} min)`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-4">
      {pending && (
        <div className="tiny" style={{ color: 'var(--warn)' }}>
          Waiting for {stage.workerNames.join(' + ')} to accept
        </div>
      )}
      <div className="row gap-6 wrap">
      {waiting ? (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => setAssigning(true)}
        >
          Assign
        </button>
      ) : pending ? (
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={forceStart}
            title="Start the timer now without waiting for the worker to accept"
          >
            Force start
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => setAssigning(true)}
          >
            Reassign
          </button>
        </>
      ) : (
        <>
          {running && (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={complete}>
              Complete stage
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => setAssigning(true)}
            title="Change who's on this stage without restarting the clock"
          >
            Reassign
          </button>
        </>
      )}

      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Cancel the job for ${job.plateNumber}?`)) return;
          setBusy(true);
          try {
            await cancelJob(job.id);
            notify(`${job.plateNumber} cancelled`, undefined, 'attn');
          } finally {
            setBusy(false);
          }
        }}
      >
        Cancel
      </button>

      <AnimatePresence>
        {assigning && stage && (
          <Modal
            title={waiting ? `Assign ${stage.name}` : `Reassign ${stage.name}`}
            subtitle={
              waiting
                ? `${job.plateNumber} · needs ${stage.workerCount} worker${stage.workerCount > 1 ? 's' : ''} · target ${stage.expectedDuration} min · they'll need to accept before the timer starts`
                : pending
                  ? `${job.plateNumber} · re-sends the accept notification to whoever you pick`
                  : `${job.plateNumber} · the clock keeps running from the original start time`
            }
            onClose={() => setAssigning(false)}
          >
            <div className="modal-body">
              <WorkerMultiPicker
                workers={rankWorkersForAssignment(workers)}
                required={stage.workerCount}
                initialSelected={stage.workerIds}
                onConfirm={async (ids) => {
                  setBusy(true);
                  try {
                    const pushToAssignees = () => {
                      const supabase = getSupabaseClient();
                      if (!supabase) return;
                      for (const id of ids) {
                        void notifyPush(supabase, { audience: 'worker', workerId: id }, {
                          title: `New job: ${job.plateNumber}`,
                          body: `${stage.name}. Tap Accept to start the timer.`,
                        });
                      }
                    };
                    if (waiting) {
                      await assignStage(job.id, stage.stageOrder, ids);
                      notify(
                        `${job.plateNumber} · ${stage.name} assigned`,
                        'Waiting for the worker to accept before the timer starts.',
                      );
                      pushToAssignees();
                    } else {
                      await reassignStage(job.id, stage.stageOrder, ids);
                      notify(
                        `${job.plateNumber} · ${stage.name} reassigned`,
                        pending ? 'Waiting for the new worker to accept.' : 'Timer continues from the original start time',
                      );
                      if (pending) pushToAssignees();
                    }
                    setAssigning(false);
                  } finally {
                    setBusy(false);
                  }
                }}
                confirmLabel={waiting ? 'Assign' : 'Save assignment'}
                busy={busy}
              />
            </div>
          </Modal>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
