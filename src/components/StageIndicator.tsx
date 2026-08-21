'use client';

import type { LiveJob } from '@/lib/types';

/**
 * "Stage 2/2 · Interior Detail" — the one piece of context every screen needs
 * to add once a job can have more than one leg. Renders nothing for a
 * single-stage job, so existing single-worker services look exactly as they
 * always did.
 */
export function StageIndicator({ job }: { job: LiveJob }) {
  const current = job.currentStage;
  const pending = current?.status === 'assigned';

  if (job.stages.length <= 1) {
    if (!pending) return null;
    return (
      <span className="tiny" style={{ display: 'block', color: 'var(--warn)' }}>
        Pending, waiting for {current!.workerNames.join(' + ')} to accept
      </span>
    );
  }

  const position = current ? job.stages.findIndex((s) => s.id === current.id) + 1 : job.stages.length;

  return (
    <span className="tiny muted" style={{ display: 'block' }}>
      Stage {position}/{job.stages.length} · {current?.name ?? job.stages.at(-1)?.name}
      {pending && (
        <span style={{ color: 'var(--warn)' }}> · pending accept</span>
      )}
    </span>
  );
}

/** A small red badge for a stage that was completed suspiciously fast. */
export function FlagBadge({ reason }: { reason?: string | null }) {
  return (
    <span
      className="pill pill-overdue"
      title={reason ?? 'Flagged for review'}
      style={{ cursor: reason ? 'help' : undefined }}
    >
      <span className="pill-dot" aria-hidden />
      Flagged
    </span>
  );
}
