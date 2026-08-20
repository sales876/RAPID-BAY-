'use client';

import { useEffect, useMemo, useState } from 'react';
import { rankWorkersForAssignment } from '@/lib/derive';
import { useOps } from '@/lib/ops-context';
import { notifyPush } from '@/lib/push';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { PaymentStatus } from '@/lib/types';
import { Modal } from './Modal';
import { WorkerMultiPicker } from './WorkerMultiPicker';

/**
 * Vehicle registration.
 *
 * Built to be completed in seconds: the form opens focused on the customer
 * name, the stage breakdown updates as soon as a car type and service are
 * chosen, and the worker list is pre-sorted so the top entry is almost always
 * the right answer. Only stage 1 is assigned here — later stages (the
 * interior-detail leg, say) are assigned from the queue once stage 1 finishes,
 * since who's free for that leg isn't known yet at registration time.
 */
export function NewVehicleModal({ onClose }: { onClose(): void }) {
  const { snapshot, workers, createJob, estimateStages } = useOps();

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carType, setCarType] = useState(snapshot.carTypes[0]?.id ?? '');
  const [serviceId, setServiceId] = useState(snapshot.services[0]?.id ?? '');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [startNow, setStartNow] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeServices = snapshot.services.filter((s) => s.active);
  const activeCarTypes = snapshot.carTypes.filter((c) => c.active);

  // The dropdowns default to "first available option," but that data can
  // still be loading the instant this modal opens (e.g. right after sign-in,
  // before the initial Supabase fetch resolves). Catch up once it arrives,
  // rather than locking onto an empty value forever.
  useEffect(() => {
    if (!carType && activeCarTypes.length) setCarType(activeCarTypes[0].id);
  }, [activeCarTypes, carType]);
  useEffect(() => {
    if (!serviceId && activeServices.length) setServiceId(activeServices[0].id);
  }, [activeServices, serviceId]);

  const stages = useMemo(
    () => (serviceId && carType ? estimateStages(serviceId, carType) : []),
    [serviceId, carType, estimateStages],
  );
  const stage1 = stages[0];
  const totalDuration = stages.reduce((sum, s) => sum + s.duration, 0);

  const ranked = useMemo(() => rankWorkersForAssignment(workers), [workers]);
  const suggested = ranked[0] ?? null;
  const selectedNames = workerIds
    .map((id) => workers.find((w) => w.id === id)?.name)
    .filter(Boolean);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!customerName.trim()) return setError('Customer name is required.');
    if (!plateNumber.trim()) return setError('Plate number is required.');
    if (!serviceId) return setError('Select a service.');
    if (!carType) return setError('Select a car type.');

    setSaving(true);
    try {
      const willAssign = startNow && workerIds.length > 0;
      await createJob({
        customerName, phone, plateNumber, carType, serviceId, workerIds,
        paymentStatus, startNow: willAssign, notes,
      });
      if (willAssign) {
        const supabase = getSupabaseClient();
        if (supabase) {
          for (const id of workerIds) {
            void notifyPush(supabase, { audience: 'worker', workerId: id }, {
              title: `New job: ${plateNumber.trim().toUpperCase()}`,
              body: `${stage1?.name ?? 'Job'} — tap Accept to start the timer.`,
            });
          }
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register the vehicle.');
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Register vehicle"
      subtitle="Arrival is recorded now. If you assign a worker, they'll get a notification and the timer starts once they accept."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body stack gap-20">
          {error && <div className="banner banner-alert">{error}</div>}

          <div className="form-grid">
            <div className="fieldset-title">Customer</div>

            <label className="field">
              <span className="field-label">Customer name</span>
              <input
                className="input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Khalid Al Mansoori"
                autoFocus
                required
              />
            </label>

            <label className="field">
              <span className="field-label">Phone number</span>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+971 50 000 0000"
                inputMode="tel"
              />
            </label>

            <div className="fieldset-title">Vehicle &amp; service</div>

            <label className="field">
              <span className="field-label">Plate number</span>
              <input
                className="input mono"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                placeholder="DUBAI A 12345"
                required
              />
            </label>

            <label className="field">
              <span className="field-label">Car type</span>
              <select className="select" value={carType} onChange={(e) => setCarType(e.target.value)}>
                {activeCarTypes.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Service</span>
              <select
                className="select"
                value={serviceId}
                onChange={(e) => { setServiceId(e.target.value); setWorkerIds([]); }}
              >
                {activeServices.map((s) => (
                  <option key={s.id} value={s.id}>{s.serviceName}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Payment</span>
              <select
                className="select"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
              >
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            </label>

            <div className="span-2 banner banner-info" style={{ flexWrap: 'wrap' }}>
              <span className="strong">Total target {totalDuration} min</span>
              {stages.length > 1 && (
                <span className="tiny">
                  ({stages.map((s) => `${s.name} ${s.duration}m × ${s.workerCount}`).join(' → ')})
                </span>
              )}
              <span aria-hidden>·</span>
              <span>
                {startNow && workerIds.length > 0
                  ? `Waiting for ${selectedNames.join(' + ')} to accept — timer starts on acceptance`
                  : 'Vehicle will be queued as Waiting until stage 1 is assigned'}
              </span>
              <div className="spacer" />
              <span className="tiny">Duration comes from car type + service configuration</span>
            </div>

            <div className="fieldset-title">
              Assign stage 1{stage1 ? ` — ${stage1.name}` : ''}
            </div>

            <div className="span-2 field">
              <div className="row gap-8">
                <span className="field-label">
                  {stage1 ? `Needs ${stage1.workerCount} worker${stage1.workerCount > 1 ? 's' : ''}` : 'Worker'}
                </span>
                <div className="spacer" />
                {suggested && workerIds.length === 0 && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setWorkerIds([suggested.id])}
                  >
                    Use suggested: {suggested.name}
                  </button>
                )}
              </div>

              <WorkerMultiPicker
                workers={ranked}
                required={stage1?.workerCount ?? 1}
                initialSelected={workerIds}
                onConfirm={(ids) => setWorkerIds(ids)}
                confirmLabel="Use this selection"
              />
              <span className="field-hint">
                Leave unassigned to place the vehicle in the waiting queue.
              </span>
              {stages.length > 1 && (
                <span className="field-hint">
                  Later stages ({stages.slice(1).map((s) => s.name).join(', ')}) are assigned once
                  the stage before them finishes — whoever is free at that moment, not decided now.
                </span>
              )}
            </div>

            <label className="field span-2">
              <span className="field-label">Notes (optional)</span>
              <textarea
                className="textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Child seat inside, customer waiting in lounge…"
              />
            </label>
          </div>
        </div>

        <div className="modal-foot">
          <label className="row gap-8 small">
            <input
              type="checkbox"
              checked={startNow}
              disabled={workerIds.length === 0}
              onChange={(e) => setStartNow(e.target.checked)}
            />
            Assign stage 1 now (worker must accept before the timer starts)
          </label>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? 'Registering…'
              : selectedNames.length
                ? `Register & assign ${selectedNames.join(' + ')}`
                : 'Register vehicle'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
