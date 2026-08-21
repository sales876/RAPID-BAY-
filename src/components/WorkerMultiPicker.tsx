'use client';

import { useState } from 'react';
import { formatCountdown } from '@/lib/time';
import type { LiveWorker } from '@/lib/types';

/**
 * Selects 1-or-more workers for a stage. A single-worker stage behaves like a
 * simple radio pick (choosing someone new replaces the previous choice); a
 * multi-worker stage (the Sharjah interior-detail leg, say) lets you tick up
 * to the required count. You can still confirm with fewer than recommended —
 * short-staffed is a real floor condition, not something to block on.
 */
export function WorkerMultiPicker({
  workers,
  required,
  initialSelected = [],
  onConfirm,
  confirmLabel = 'Confirm',
  busy = false,
}: {
  workers: LiveWorker[];
  required: number;
  initialSelected?: string[];
  onConfirm(workerIds: string[]): void | Promise<void>;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);

  const groups = groupWorkers(workers);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (required <= 1) return [id];
      if (prev.length >= required) return prev; // at capacity, deselect one first
      return [...prev, id];
    });
  }

  return (
    <div className="col g10">
      <div className="picker">
        <div className="picker-scroll">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="picker-group-label">{group.label}</div>
              {group.workers.map((worker) => (
                <Option
                  key={worker.id}
                  worker={worker}
                  selected={selected.includes(worker.id)}
                  onSelect={() => toggle(worker.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <span className="tiny muted">
          {selected.length} of {required} recommended selected
        </span>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || selected.length === 0}
          onClick={() => onConfirm(selected)}
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

function groupWorkers(workers: LiveWorker[]) {
  const now = workers.filter((w) => w.displayStatus === 'available');
  const soon = workers.filter(
    (w) => w.displayStatus === 'finishing_soon' ||
      (w.displayStatus === 'working' && w.availableInSeconds <= 10 * 60),
  );
  const busy = workers.filter(
    (w) => (w.displayStatus === 'working' && w.availableInSeconds > 10 * 60) ||
      w.displayStatus === 'overdue',
  );
  const off = workers.filter((w) => w.displayStatus === 'on_break' || w.displayStatus === 'offline');
  return [
    { label: 'Available now', workers: now },
    { label: 'Available soon', workers: soon },
    { label: 'Currently working', workers: busy },
    { label: 'Unavailable', workers: off },
  ].filter((g) => g.workers.length);
}

function Option({
  worker,
  selected,
  onSelect,
}: {
  worker: LiveWorker;
  selected: boolean;
  onSelect(): void;
}) {
  const detail = worker.currentJob
    ? `${worker.currentJob.plateNumber} · ${worker.currentStage?.name ?? ''}`
    : worker.displayStatus === 'on_break'
      ? 'On break'
      : worker.displayStatus === 'offline'
        ? 'Offline today'
        : 'No active vehicle';

  const when =
    worker.displayStatus === 'available'
      ? 'Available now'
      : worker.displayStatus === 'overdue'
        ? `Overdue +${formatCountdown(worker.currentStage?.remainingSeconds ?? 0)}`
        : Number.isFinite(worker.availableInSeconds)
          ? `In ~${Math.ceil(worker.availableInSeconds / 60)} min`
          : '-';

  return (
    <button
      type="button"
      className="picker-option"
      aria-pressed={selected}
      aria-label={`${selected ? 'Remove' : 'Add'} ${worker.name}, ${detail}, ${when}`}
      onClick={onSelect}
    >
      <span
        className="avatar"
        aria-hidden
        style={selected ? { background: 'var(--accent)', color: 'var(--on-dark)' } : undefined}
      >
        {selected ? '✓' : worker.name.slice(0, 2).toUpperCase()}
      </span>
      <span>
        <span className="who">{worker.name}</span>
        <span className="detail" style={{ display: 'block' }}>{detail}</span>
      </span>
      <span
        className="when"
        style={{
          color:
            worker.displayStatus === 'available'
              ? 'var(--ok)'
              : worker.displayStatus === 'overdue'
                ? 'var(--danger)'
                : undefined,
        }}
      >
        {when}
      </span>
    </button>
  );
}
