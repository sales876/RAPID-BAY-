'use client';

import { useMemo, useState } from 'react';
import { JobTable } from '@/components/JobTable';
import { useAuth } from '@/lib/auth';
import { exportToExcel } from '@/lib/export/excel';
import { useOps } from '@/lib/ops-context';
import { formatLongDate, shiftDateKey } from '@/lib/time';

/**
 * Every job record, searchable. Search covers the four things a person at the
 * counter is ever holding when they ask: a plate, a name, a phone number, or
 * the worker's name.
 */
export default function VehiclesPage() {
  const { jobs, snapshot, workers, today, ready } = useOps();
  const { can } = useAuth();

  const [query, setQuery] = useState('');
  const [dateKey, setDateKey] = useState<string>(today);
  const [allDates, setAllDates] = useState(false);
  const [workerId, setWorkerId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [carType, setCarType] = useState('');
  const [payment, setPayment] = useState('');
  const [status, setStatus] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (!allDates && job.date !== dateKey) return false;
      if (workerId && !job.stages.some((s) => s.workerIds.includes(workerId))) return false;
      if (serviceId && job.serviceId !== serviceId) return false;
      if (carType && job.carType !== carType) return false;
      if (payment && job.paymentStatus !== payment) return false;
      if (status && job.displayStatus !== status) return false;
      if (!q) return true;
      return (
        job.plateNumber.toLowerCase().includes(q) ||
        job.customerName.toLowerCase().includes(q) ||
        job.phone.toLowerCase().includes(q) ||
        job.stages.some((s) => s.workerNames.some((n) => n.toLowerCase().includes(q)))
      );
    });
  }, [jobs, allDates, dateKey, workerId, serviceId, carType, payment, status, query]);

  const clearFilters = () => {
    setQuery(''); setWorkerId(''); setServiceId(''); setCarType('');
    setPayment(''); setStatus(''); setAllDates(false); setDateKey(today);
  };

  const filtersActive =
    Boolean(query || workerId || serviceId || carType || payment || status || allDates);

  if (!ready) return <div className="empty">Loading records…</div>;

  return (
    <div className="stack gap-16 content-narrow">
      <section className="card">
        <div className="card-head">
          <span className="card-title">Search &amp; filter</span>
          <div className="spacer" />
          {filtersActive && (
            <button className="btn btn-sm btn-ghost" onClick={clearFilters}>Clear</button>
          )}
          {can('export_data') && (
            <button
              className="btn btn-sm"
              onClick={() =>
                exportToExcel({
                  jobs: filtered,
                  workers: snapshot.workers,
                  carTypes: snapshot.carTypes,
                  periodLabel: allDates ? 'All records' : formatLongDate(dateKey),
                })
              }
              disabled={!filtered.length}
            >
              Export Excel
            </button>
          )}
        </div>

        <div className="card-body stack gap-12">
          <div className="search">
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plate, customer, phone or worker…"
              aria-label="Search records"
            />
          </div>

          <div className="row gap-8 wrap">
            <div className="row gap-4">
              <button
                className="btn btn-sm"
                onClick={() => { setAllDates(false); setDateKey((d) => shiftDateKey(d, -1)); }}
                aria-label="Previous day"
              >
                ‹
              </button>
              <input
                className="input"
                type="date"
                style={{ width: 150 }}
                value={dateKey}
                onChange={(e) => { setDateKey(e.target.value); setAllDates(false); }}
                disabled={allDates}
                aria-label="Date"
              />
              <button
                className="btn btn-sm"
                onClick={() => { setAllDates(false); setDateKey((d) => shiftDateKey(d, 1)); }}
                aria-label="Next day"
              >
                ›
              </button>
              <button
                className="btn btn-sm"
                aria-pressed={allDates}
                onClick={() => setAllDates((v) => !v)}
              >
                {allDates ? 'All dates ✓' : 'All dates'}
              </button>
            </div>

            <select className="select" style={{ width: 150 }} value={workerId} onChange={(e) => setWorkerId(e.target.value)} aria-label="Worker">
              <option value="">All workers</option>
              {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>

            <select className="select" style={{ width: 170 }} value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label="Service">
              <option value="">All services</option>
              {snapshot.services.map((s) => <option key={s.id} value={s.id}>{s.serviceName}</option>)}
            </select>

            <select className="select" style={{ width: 150 }} value={carType} onChange={(e) => setCarType(e.target.value)} aria-label="Car type">
              <option value="">All car types</option>
              {snapshot.carTypes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>

            <select className="select" style={{ width: 140 }} value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment status">
              <option value="">Any payment</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
            </select>

            <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Job status">
              <option value="">Any status</option>
              <option value="waiting">Waiting</option>
              <option value="in_progress">In progress</option>
              <option value="finishing_soon">Finishing soon</option>
              <option value="overdue">Overdue</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <span className="card-title">
            {allDates ? 'All records' : formatLongDate(dateKey)}
          </span>
          <div className="spacer" />
          <span className="card-note">
            {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
          </span>
        </div>
        <div className="card-body tight">
          <JobTable
            jobs={filtered}
            emptyMessage="No records match these filters."
          />
        </div>
      </section>
    </div>
  );
}
