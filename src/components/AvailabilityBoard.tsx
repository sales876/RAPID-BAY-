'use client';

import { buildAvailabilityBoard } from '@/lib/derive';
import { formatCountdown } from '@/lib/time';
import type { LiveWorker } from '@/lib/types';

/**
 * Worker availability, bucketed by when each person can take the next car.
 * This is the answer to "can I promise this customer a bay right now?", which
 * is the question the front desk is asked most often.
 */
export function AvailabilityBoard({ workers }: { workers: LiveWorker[] }) {
  const board = buildAvailabilityBoard(workers);

  return (
    <div className="availability">
      <Column
        tone="now"
        title="Available now"
        hint="Can start immediately"
        workers={board.now}
        when={() => 'Ready'}
      />
      <Column
        tone="5"
        title="Available in 5 min"
        hint="Finishing shortly"
        workers={board.within5}
        when={(w) => formatCountdown(w.availableInSeconds)}
      />
      <Column
        tone="10"
        title="Available in 10 min"
        hint="Wrapping up soon"
        workers={board.within10}
        when={(w) => formatCountdown(w.availableInSeconds)}
      />
      <Column
        tone="busy"
        title="Busy"
        hint="More than 10 minutes left"
        workers={board.busy}
        when={(w) =>
          w.displayStatus === 'overdue'
            ? `+${formatCountdown(w.currentStage?.remainingSeconds ?? 0)}`
            : formatCountdown(w.availableInSeconds)
        }
      />
      {board.unavailable.length > 0 && (
        <Column
          tone="busy"
          title="Off the floor"
          hint="On break or offline"
          workers={board.unavailable}
          when={(w) => (w.displayStatus === 'on_break' ? 'On break' : 'Offline')}
        />
      )}
    </div>
  );
}

function Column({
  tone,
  title,
  hint,
  workers,
  when,
}: {
  tone: 'now' | '5' | '10' | 'busy';
  title: string;
  hint: string;
  workers: LiveWorker[];
  when(worker: LiveWorker): string;
}) {
  return (
    <div className={`avail-col avail-${tone}`}>
      <div className="avail-head">
        <span className="avail-title">{title}</span>
        <span className="avail-count">{workers.length}</span>
      </div>
      {workers.length === 0 ? (
        <div className="avail-empty">{hint === 'Ready' ? 'None' : 'None'}</div>
      ) : (
        workers.map((worker) => (
          <div key={worker.id} className="avail-chip">
            <span className="avatar" aria-hidden style={{ width: 22, height: 22, flexBasis: 22, fontSize: 10 }}>
              {worker.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="name">{worker.name}</span>
            <span
              className="when mono"
              style={{
                color:
                  tone === 'now'
                    ? 'var(--ok)'
                    : worker.displayStatus === 'overdue'
                      ? 'var(--danger)'
                      : undefined,
              }}
            >
              {when(worker)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
