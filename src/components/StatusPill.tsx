'use client';

import { STATUS_LABEL, WORKER_STATUS_LABEL } from '@/lib/derive';
import type { DisplayStatus, WorkerDisplayStatus } from '@/lib/types';

export function StatusPill({ status }: { status: DisplayStatus }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="pill-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WorkerStatusPill({ status }: { status: WorkerDisplayStatus }) {
  // An overdue worker is still "working" — the alarm belongs on the job, and
  // repeating it on the person's badge would double-count the problem.
  const className = status === 'overdue' ? 'overdue' : status;
  return (
    <span className={`pill pill-${className}`}>
      <span className="pill-dot" aria-hidden />
      {WORKER_STATUS_LABEL[status]}
    </span>
  );
}
