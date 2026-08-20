'use client';

import { useRef, useState } from 'react';
import { useOps } from '@/lib/ops-context';
import { notifyPush } from '@/lib/push';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatCountdown } from '@/lib/time';
import type { LiveJob, LiveJobStage } from '@/lib/types';
import { Modal } from './Modal';

/**
 * A worker completing a stage from their own phone. A photo of the finished
 * car is required before "Complete" enables — the cheapest real check
 * against a false completion: it doesn't prove quality, but it means lying
 * takes actual effort and leaves evidence if a customer disputes the job.
 *
 * The system separately auto-flags anything finished in under half its
 * target time, regardless of the photo — that catch happens automatically
 * and needs nothing from the worker.
 */
export function StageCompleteModal({
  job,
  stage,
  workerId,
  onClose,
}: {
  job: LiveJob;
  stage: LiveJobStage;
  workerId: string;
  onClose(): void;
}) {
  const { completeStage } = useOps();
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // A phone camera photo is several MB at full resolution — far more than
    // this needs as evidence. Downscale to a max edge of 640px, JPEG ~60%,
    // which lands proof-of-completion photos around 30-80KB each.
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const maxEdge = 640;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPhoto(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  /** Data URL → Blob, synchronously (no canvas.toBlob race against a fast tap on Submit). */
  function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function submit() {
    if (!photo) { setError('Take a photo of the finished car first.'); return; }
    setSaving(true);
    setError(null);
    try {
      const actual = Math.max(
        1,
        Math.round((Date.now() - new Date(stage.startTime ?? job.arrivalTime).getTime()) / 60_000),
      );
      const supabase = getSupabaseClient();
      // Uploaded to Storage when live (a real bucket, not a database column)
      // so the photo never rides along on ordinary job fetches — only the
      // short URL does. Demo mode has no bucket to upload to, so it keeps
      // the inline data URL; the local dataset is tiny enough that it's fine.
      let photoUrl = photo;
      if (supabase) {
        const path = `${job.id}/${stage.stageOrder}-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('completion-photos')
          .upload(path, dataUrlToBlob(photo), { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        photoUrl = supabase.storage.from('completion-photos').getPublicUrl(path).data.publicUrl;
      }
      await completeStage(job.id, stage.stageOrder, workerId, photoUrl);
      if (supabase) {
        void notifyPush(supabase, { audience: 'staff' }, {
          title: `${stage.workerNames.join(' + ') || 'A worker'} finished ${stage.name}`,
          body: `${job.plateNumber} · ${actual} min (target ${stage.expectedDuration} min)`,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete this stage.');
      setSaving(false);
    }
  }

  return (
    <Modal title={`Complete ${stage.name}`} subtitle={`${job.plateNumber} · ${job.customerName}`} onClose={onClose}>
      <div className="modal-body stack gap-16">
        {error && <div className="banner banner-alert">{error}</div>}

        <div className="banner banner-info">
          <span>
            Target {stage.expectedDuration} min ·{' '}
            {stage.remainingSeconds < 0
              ? `${formatCountdown(stage.remainingSeconds)} over`
              : `${formatCountdown(stage.remainingSeconds)} remaining`}
          </span>
        </div>

        <div>
          <span className="field-label" style={{ display: 'block', marginBottom: 6 }}>
            Photo of the finished car
          </span>
          <label className={`photo-capture ${photo ? 'has-photo' : ''}`}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Finished vehicle" />
            ) : (
              <>
                <span style={{ fontSize: 28 }} aria-hidden>📷</span>
                <span className="small strong">Tap to take a photo</span>
                <span className="tiny muted">Required before you can complete this stage</span>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
            />
          </label>
          {photo && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ marginTop: 8 }}
              onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}
            >
              Retake photo
            </button>
          )}
        </div>
      </div>

      <div className="modal-foot">
        <button type="button" className="staff-btn ghost" onClick={onClose} disabled={saving} style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          className="staff-btn primary"
          onClick={submit}
          disabled={saving || !photo}
          style={{ flex: 2 }}
        >
          {saving ? 'Completing…' : 'Complete stage'}
        </button>
      </div>
    </Modal>
  );
}
