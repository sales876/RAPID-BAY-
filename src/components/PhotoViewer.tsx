'use client';

import { AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { formatClock } from '@/lib/time';
import type { LiveJob } from '@/lib/types';
import { Modal } from './Modal';

/**
 * Completion-proof photos, worker-side only until now (see StageCompleteModal
 * — a worker can't finish a stage without one, but nothing ever showed them
 * back). This is that missing viewer: a small trigger on the job row, a
 * lightbox with one panel per photographed stage.
 */
export function StagePhotoButton({ job }: { job: LiveJob }) {
  const [open, setOpen] = useState(false);
  const withPhotos = job.stages.filter((s) => s.photoUrl);

  if (!withPhotos.length) return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-ghost photo-trigger"
        onClick={() => setOpen(true)}
        aria-label={`View ${withPhotos.length} completion photo${withPhotos.length > 1 ? 's' : ''} for ${job.plateNumber}`}
      >
        <span aria-hidden>📷</span> {withPhotos.length > 1 ? withPhotos.length : ''}
      </button>
      <AnimatePresence>
        {open && <PhotoLightbox job={job} stages={withPhotos} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function PhotoLightbox({
  job,
  stages,
  onClose,
}: {
  job: LiveJob;
  stages: LiveJob['stages'];
  onClose(): void;
}) {
  const [index, setIndex] = useState(0);
  const stage = stages[index];

  return (
    <Modal
      title="Completion photo"
      subtitle={`${job.plateNumber} · ${job.customerName}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body stack gap-12">
        {stages.length > 1 && (
          <div className="segmented">
            {stages.map((s, i) => (
              <button
                key={s.id}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
                type="button"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="photo-capture has-photo" style={{ cursor: 'default' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.photoUrl!} alt={`${stage.name} completed on ${job.plateNumber}`} />
        </div>

        <div className="row gap-12 wrap small muted">
          <span>
            Completed by{' '}
            <span className="strong" style={{ color: 'var(--ink)' }}>
              {stage.workerNames.join(' + ') || 'Unknown'}
            </span>
          </span>
          <span aria-hidden>·</span>
          <span>{formatClock(stage.completionTime)}</span>
          {stage.actualDuration != null && (
            <>
              <span aria-hidden>·</span>
              <span>{stage.actualDuration} min (target {stage.expectedDuration} min)</span>
            </>
          )}
          {stage.flagged && (
            <span className="pill pill-overdue" title={stage.flagReason ?? 'Flagged for review'}>
              <span className="pill-dot" aria-hidden />
              Flagged
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
