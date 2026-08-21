'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { BUSINESS, resolveDuration } from '@/lib/config';
import { useOps } from '@/lib/ops-context';
import type { ServiceStage } from '@/lib/types';

/**
 * Service configuration.
 *
 * The duration matrix is the heart of this screen for single-stage services:
 * every cell is the target time for one car type on one service, either an
 * explicit override or base duration × size factor. A staged service (one
 * configured below with more than one leg) skips the matrix entirely — its
 * timing comes from its stages instead, each scaled by the same size factor.
 */
export default function ServicesPage() {
  const { snapshot, repo, refresh, ready } = useOps();
  const { notify } = useToast();
  const [draftName, setDraftName] = useState('');
  const [draftDuration, setDraftDuration] = useState(30);
  const [draftPrice, setDraftPrice] = useState(0);

  const services = snapshot.services.filter((s) => s.active);
  const carTypes = snapshot.carTypes.filter((c) => c.active);

  if (!ready) return <div className="empty">Loading configuration…</div>;

  const overrideFor = (serviceId: string, carTypeId: string) =>
    snapshot.durations.find((d) => d.serviceId === serviceId && d.carTypeId === carTypeId);

  const stagesFor = (serviceId: string) =>
    snapshot.serviceStages.filter((s) => s.serviceId === serviceId).sort((a, b) => a.stageOrder - b.stageOrder);

  const singleStageServices = services.filter((s) => stagesFor(s.id).length === 0);

  async function saveStage(stage: ServiceStage) {
    await repo.saveServiceStage(stage);
    await refresh();
  }

  async function addStage(serviceId: string) {
    const existing = stagesFor(serviceId);
    await saveStage({
      id: `new-${Math.random().toString(36).slice(2, 8)}`,
      serviceId,
      stageOrder: existing.length + 1,
      name: existing.length === 0 ? 'Exterior Wash' : `Stage ${existing.length + 1}`,
      workerCount: 1,
      baseDuration: 20,
    });
  }

  async function removeStage(stage: ServiceStage) {
    if (!window.confirm(`Remove "${stage.name}"? Jobs already using this service keep their history.`)) return;
    await repo.removeServiceStage(stage.id);
    // Renumber the remaining stages so there's never a gap.
    const remaining = stagesFor(stage.serviceId).filter((s) => s.id !== stage.id);
    for (let i = 0; i < remaining.length; i += 1) {
      if (remaining[i].stageOrder !== i + 1) {
        await repo.saveServiceStage({ ...remaining[i], stageOrder: i + 1 });
      }
    }
    await refresh();
  }

  return (
    <div className="stack gap-16 content-narrow">
      <section className="card">
        <div className="card-head">
          <span className="card-title">Services</span>
          <span className="card-note">Base duration applies to a standard sedan, single-stage services only</span>
        </div>
        <div className="card-body tight table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Service</th>
                <th style={{ width: 150 }}>Base duration (min)</th>
                <th style={{ width: 150 }}>Price ({BUSINESS.currency})</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const staged = stagesFor(service.id).length > 0;
                return (
                  <tr key={service.id}>
                    <td>
                      <input
                        className="input"
                        defaultValue={service.serviceName}
                        onBlur={async (e) => {
                          const value = e.target.value.trim();
                          if (!value || value === service.serviceName) return;
                          await repo.saveService({ ...service, serviceName: value });
                          await refresh();
                        }}
                        aria-label={`${service.serviceName} name`}
                      />
                    </td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        min={5}
                        step={5}
                        disabled={staged}
                        defaultValue={service.baseDuration}
                        title={staged ? 'Staged service: edit durations in Multi-stage services below' : undefined}
                        onBlur={async (e) => {
                          const value = Number(e.target.value);
                          if (!value || value === service.baseDuration) return;
                          await repo.saveService({ ...service, baseDuration: value });
                          await refresh();
                        }}
                        aria-label={`${service.serviceName} base duration`}
                      />
                    </td>
                    <td>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        step={5}
                        defaultValue={service.price}
                        onBlur={async (e) => {
                          const value = Number(e.target.value);
                          if (value === service.price) return;
                          await repo.saveService({ ...service, price: value });
                          await refresh();
                        }}
                        aria-label={`${service.serviceName} price`}
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          if (!window.confirm(`Retire "${service.serviceName}"? Past records keep it.`)) return;
                          await repo.removeService(service.id);
                          await refresh();
                          notify(`${service.serviceName} retired`);
                        }}
                      >
                        Retire
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body">
          <form
            className="row gap-8 wrap"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draftName.trim()) return;
              await repo.saveService({
                serviceName: draftName.trim(),
                baseDuration: draftDuration,
                price: draftPrice,
              });
              setDraftName('');
              await refresh();
              notify('Service added');
            }}
          >
            <input
              className="input"
              style={{ maxWidth: 240 }}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="New service name"
              aria-label="New service name"
            />
            <input
              className="input mono"
              style={{ width: 130 }}
              type="number"
              min={5}
              step={5}
              value={draftDuration}
              onChange={(e) => setDraftDuration(Number(e.target.value))}
              aria-label="New service base duration"
            />
            <input
              className="input mono"
              style={{ width: 130 }}
              type="number"
              min={0}
              step={5}
              value={draftPrice}
              onChange={(e) => setDraftPrice(Number(e.target.value))}
              aria-label="New service price"
            />
            <button className="btn btn-primary" type="submit">Add service</button>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Multi-stage services</span>
          <span className="card-note">
            Give a service two or more legs: one worker washes the exterior, then two
            workers detail the interior. Each stage gets its own worker count, target time and
            timer; the job hands off from one to the next automatically.
          </span>
        </div>
        <div className="card-body stack gap-16">
          {services.map((service) => {
            const stages = stagesFor(service.id);
            return (
              <div key={service.id} className="stack gap-8" style={{ paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
                <div className="row gap-8">
                  <span className="strong">{service.serviceName}</span>
                  {stages.length === 0 && <span className="tiny muted">Single stage: the whole job, one worker</span>}
                  <div className="spacer" />
                  <button className="btn btn-sm" onClick={() => addStage(service.id)}>
                    + Add stage
                  </button>
                </div>

                {stages.length > 0 && (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}>#</th>
                          <th>Stage name</th>
                          <th style={{ width: 140 }}>Workers required</th>
                          <th style={{ width: 160 }}>Base duration (min)</th>
                          <th style={{ width: 90 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {stages.map((stage) => (
                          <tr key={stage.id}>
                            <td className="mono muted">{stage.stageOrder}</td>
                            <td>
                              <input
                                className="input"
                                defaultValue={stage.name}
                                onBlur={(e) => {
                                  const value = e.target.value.trim();
                                  if (!value || value === stage.name) return;
                                  saveStage({ ...stage, name: value });
                                }}
                                aria-label={`Stage ${stage.stageOrder} name`}
                              />
                            </td>
                            <td>
                              <select
                                className="select"
                                defaultValue={stage.workerCount}
                                onChange={(e) => saveStage({ ...stage, workerCount: Number(e.target.value) })}
                                aria-label={`Stage ${stage.stageOrder} worker count`}
                              >
                                <option value={1}>1 worker</option>
                                <option value={2}>2 workers</option>
                                <option value={3}>3 workers</option>
                              </select>
                            </td>
                            <td>
                              <input
                                className="input mono"
                                type="number"
                                min={5}
                                step={5}
                                defaultValue={stage.baseDuration}
                                onBlur={(e) => {
                                  const value = Number(e.target.value);
                                  if (!value || value === stage.baseDuration) return;
                                  saveStage({ ...stage, baseDuration: value });
                                }}
                                aria-label={`Stage ${stage.stageOrder} base duration`}
                              />
                            </td>
                            <td>
                              <button className="btn btn-sm btn-ghost" onClick={() => removeStage(stage)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Car types</span>
          <span className="card-note">
            Size factor scales any service or stage that has no explicit override
          </span>
        </div>
        <div className="card-body tight table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Car type</th>
                <th style={{ width: 160 }}>Size factor</th>
                <th>Effect on a 40 min service</th>
              </tr>
            </thead>
            <tbody>
              {carTypes.map((carType) => (
                <tr key={carType.id}>
                  <td>
                    <input
                      className="input"
                      defaultValue={carType.label}
                      onBlur={async (e) => {
                        const value = e.target.value.trim();
                        if (!value || value === carType.label) return;
                        await repo.saveCarType({ ...carType, label: value });
                        await refresh();
                      }}
                      aria-label={`${carType.label} name`}
                    />
                  </td>
                  <td>
                    <input
                      className="input mono"
                      type="number"
                      min={0.5}
                      max={3}
                      step={0.05}
                      defaultValue={carType.sizeFactor}
                      onBlur={async (e) => {
                        const value = Number(e.target.value);
                        if (!value || value === carType.sizeFactor) return;
                        await repo.saveCarType({ ...carType, sizeFactor: value });
                        await refresh();
                      }}
                      aria-label={`${carType.label} size factor`}
                    />
                  </td>
                  <td className="mono small muted">
                    {Math.max(5, Math.round(40 * carType.sizeFactor))} min
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">Duration matrix</span>
          <span className="card-note">
            Minutes per car type and service, single-stage services only. Grey values are
            inherited; type a number to override, clear the field to inherit again. Staged
            services aren't shown here; edit their per-stage timing above instead.
          </span>
        </div>
        <div className="card-body tight table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ minWidth: 170 }}>Service</th>
                {carTypes.map((carType) => (
                  <th key={carType.id} className="right">{carType.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {singleStageServices.map((service) => (
                <tr key={service.id}>
                  <td className="strong">
                    {service.serviceName}
                    <div className="tiny muted">Base {service.baseDuration} min</div>
                  </td>
                  {carTypes.map((carType) => {
                    const override = overrideFor(service.id, carType.id);
                    const resolved = resolveDuration(
                      service.id,
                      carType.id,
                      snapshot.services,
                      snapshot.carTypes,
                      snapshot.durations,
                    );
                    return (
                      <td key={carType.id}>
                        <input
                          className="input mono right"
                          style={{
                            width: 78,
                            marginLeft: 'auto',
                            color: override ? 'var(--ink)' : 'var(--muted)',
                            fontWeight: override ? 600 : 400,
                            borderColor: override ? 'var(--accent-line)' : undefined,
                            background: override ? 'var(--accent-soft)' : undefined,
                          }}
                          type="number"
                          min={5}
                          step={5}
                          defaultValue={resolved}
                          key={`${service.id}-${carType.id}-${resolved}`}
                          aria-label={`${service.serviceName} for ${carType.label}`}
                          onBlur={async (e) => {
                            const raw = e.target.value.trim();
                            const value = raw === '' ? null : Number(raw);
                            if (value !== null && value === resolved && override) return;
                            if (value === null && !override) return;
                            await repo.setDuration(service.id, carType.id, value);
                            await refresh();
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
