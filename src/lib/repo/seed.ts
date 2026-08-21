import {
  DEFAULT_CAR_TYPES,
  DEFAULT_SERVICE_DURATIONS,
  DEFAULT_SERVICE_STAGES,
  DEFAULT_SERVICES,
  DEFAULT_WORKER_NAMES,
  FRAUD_FLAG_RATIO,
  resolveStages,
} from '../config';
import { businessDate } from '../time';
import type {
  AppNotification, Job, JobStage, OpsSnapshot, PaymentStatus, Worker, WorkerBaseStatus,
} from '../types';

/**
 * Demo data generator.
 *
 * The floor is staged so the dashboard tells the whole story the moment it
 * opens: single-stage jobs in every state, a two-stage job mid-handoff
 * (wash done, detail running with two workers), one flagged completion, one
 * overdue job, and a fortnight of history behind it for the reports screen.
 *
 * Everything is expressed relative to "now", so the demo is never stale.
 */

/** Deterministic PRNG — the same demo every time it is reseeded. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMER_NAMES = [
  'Khalid Al Mansoori', 'Priya Nair', 'Omar Haddad', 'Sarah Thompson',
  'Vikram Shetty', 'Layla Ibrahim', 'Daniel Okafor', 'Fatima Al Suwaidi',
  'James Whitfield', 'Ananya Rao', 'Yusuf Karim', 'Grace Mwangi',
  'Rashid Al Balushi', 'Elena Petrova', 'Tariq Aziz', 'Meera Krishnan',
  'Abdullah Al Zaabi', 'Chloe Bennett', 'Sanjay Menon', 'Noura Al Ali',
  'Marcus Reid', 'Huda Rahman', 'Deepak Iyer', 'Salma Farouk',
];

const EMIRATES = ['Dubai', 'Dubai', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'];
const PLATE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'J', 'K', 'M', 'N', 'P'];

const CAR_TYPE_IDS = DEFAULT_CAR_TYPES.map((c) => c.id);
const SERVICE_IDS = DEFAULT_SERVICES.map((s) => s.id);
const STAGED_SERVICE_IDS = new Set(DEFAULT_SERVICE_STAGES.map((s) => s.serviceId));
const SIMPLE_SERVICE_IDS = SERVICE_IDS.filter((id) => !STAGED_SERVICE_IDS.has(id));

const PAYMENTS: PaymentStatus[] = ['paid', 'paid', 'paid', 'unpaid', 'partial'];
const MIN = 60_000;

function makeId(prefix: string, n: number) {
  return `${prefix}-${n.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function pick<T>(rand: () => number, list: T[]): T {
  return list[Math.floor(rand() * list.length)];
}

interface DraftOptions {
  rand: () => number;
  index: number;
  arrivalMs: number;
  serviceId?: string;
  carType?: string;
  paymentStatus?: PaymentStatus;
}

interface Draft {
  job: Job;
  resolvedStages: ReturnType<typeof resolveStages>;
}

/** Builds an un-started job (all stages waiting) — the shared starting point every scenario below customises. */
function draftJob({ rand, index, arrivalMs, serviceId, carType, paymentStatus }: DraftOptions): Draft {
  const svc = serviceId ?? pick(rand, SERVICE_IDS);
  const ct = carType ?? pick(rand, CAR_TYPE_IDS);
  const service = DEFAULT_SERVICES.find((s) => s.id === svc)!;
  const resolvedStages = resolveStages(
    svc, ct, DEFAULT_SERVICES, DEFAULT_CAR_TYPES, DEFAULT_SERVICE_DURATIONS, DEFAULT_SERVICE_STAGES,
  );

  const customerName = CUSTOMER_NAMES[index % CUSTOMER_NAMES.length];
  const plateNumber = `${pick(rand, EMIRATES)} ${pick(rand, PLATE_LETTERS)} ${1000 + Math.floor(rand() * 89999)}`;
  const phone = `+9715${Math.floor(rand() * 9)} ${100 + Math.floor(rand() * 899)} ${1000 + Math.floor(rand() * 8999)}`;
  const jobId = makeId('job', index);

  const stages: JobStage[] = resolvedStages.map((rs) => ({
    id: makeId('stg', index * 10 + rs.stageOrder),
    jobId,
    stageOrder: rs.stageOrder,
    name: rs.name,
    workerCount: rs.workerCount,
    workerIds: [],
    workerNames: [],
    status: 'waiting',
    assignedAt: null,
    startTime: null,
    expectedCompletionTime: null,
    completionTime: null,
    expectedDuration: rs.duration,
    actualDuration: null,
    completedBy: null,
    photoUrl: null,
    flagged: false,
    flagReason: null,
  }));

  const job: Job = {
    id: jobId,
    customerId: null,
    vehicleId: null,
    serviceId: svc,
    customerName,
    phone,
    plateNumber,
    carType: ct,
    serviceName: service.serviceName,
    price: service.price,
    date: businessDate(new Date(arrivalMs)),
    arrivalTime: iso(arrivalMs),
    status: 'waiting',
    paymentStatus: paymentStatus ?? pick(rand, PAYMENTS),
    handoverConfirmed: false,
    stages,
    notes: null,
    createdAt: iso(arrivalMs),
    updatedAt: iso(arrivalMs),
  };

  return { job, resolvedStages };
}

/** Hands a stage to worker(s) pending acceptance — no clock yet. */
function assignStage(job: Job, stageOrder: number, workers: Worker[], assignedMs: number) {
  const stage = job.stages.find((s) => s.stageOrder === stageOrder)!;
  stage.workerIds = workers.map((w) => w.id);
  stage.workerNames = workers.map((w) => w.name);
  stage.assignedAt = iso(assignedMs);
  stage.status = 'assigned';
}

/** Starts a stage now (or at a given offset) with the given worker(s), and marks the job in_progress. */
function startStage(job: Job, stageOrder: number, workers: Worker[], startMs: number) {
  const stage = job.stages.find((s) => s.stageOrder === stageOrder)!;
  stage.workerIds = workers.map((w) => w.id);
  stage.workerNames = workers.map((w) => w.name);
  stage.startTime = iso(startMs);
  stage.expectedCompletionTime = iso(startMs + stage.expectedDuration * MIN);
  stage.status = 'in_progress';
  job.status = 'in_progress';
}

/** Completes an already-started stage at a given actual duration (minutes). */
function completeStage(job: Job, stageOrder: number, actualMinutes: number, completedBy: string) {
  const stage = job.stages.find((s) => s.stageOrder === stageOrder)!;
  const startMs = new Date(stage.startTime!).getTime();
  stage.completionTime = iso(startMs + actualMinutes * MIN);
  stage.actualDuration = actualMinutes;
  stage.status = 'completed';
  stage.completedBy = completedBy;
  if (actualMinutes < stage.expectedDuration * FRAUD_FLAG_RATIO) {
    stage.flagged = true;
    stage.flagReason = `Completed in ${actualMinutes} min against a ${stage.expectedDuration} min target, under ${Math.round(FRAUD_FLAG_RATIO * 100)}% of target.`;
  }
  if (job.stages.every((s) => s.status === 'completed')) job.status = 'completed';
}

export function buildSeed(): OpsSnapshot {
  const rand = mulberry32(20260818);
  const now = Date.now();

  // --- Workers -------------------------------------------------------------
  const baseStatuses: Record<string, WorkerBaseStatus> = {
    Arjun: 'on_break',
    Faisal: 'offline',
  };
  const workers: Worker[] = DEFAULT_WORKER_NAMES.map((name, i) => ({
    id: `wrk-${name.toLowerCase()}`,
    name,
    phone: `+9715${i} 4${i}0 ${2000 + i * 137}`,
    status: baseStatuses[name] ?? 'available',
    active: true,
    hasAccount: ['Ahmed', 'Sameer', 'Rahul'].includes(name),
  }));
  const byName = (n: string) => workers.find((w) => w.name === n)!;

  const jobs: Job[] = [];
  let index = 0;

  // --- Active floor: single-stage jobs, one per busy worker -----------------
  const singleStage: Array<{ worker: string; remainingSeconds: number; serviceId?: string }> = [
    { worker: 'Mohammed', remainingSeconds: 17 * 60 + 5 },
    { worker: 'Imran', remainingSeconds: 22 * 60 + 30 },
    { worker: 'Sameer', remainingSeconds: 3 * 60 + 21 },   // finishing soon
    { worker: 'Bilal', remainingSeconds: -(6 * 60 + 32) }, // overdue
  ];
  for (const stage of singleStage) {
    const { job } = draftJob({
      rand, index: index++, arrivalMs: now,
      serviceId: stage.serviceId ?? pick(rand, SIMPLE_SERVICE_IDS),
    });
    const w = byName(stage.worker);
    const targetMin = job.stages[0].expectedDuration;
    const startMs = now + stage.remainingSeconds * 1000 - targetMin * MIN;
    startStage(job, 1, [w], startMs);
    jobs.push(job);
  }

  // --- Two-stage job mid-handoff: wash done, detail running with 2 workers --
  {
    const { job } = draftJob({ rand, index: index++, arrivalMs: now - 38 * MIN, serviceId: 'svc-full' });
    const washStart = now - 38 * MIN;
    startStage(job, 1, [byName('Ahmed')], washStart);
    completeStage(job, 1, job.stages[0].expectedDuration - 2, byName('Ahmed').id); // finished slightly early, clean
    const detailStart = now - 9 * MIN;
    startStage(job, 2, [byName('Hassan'), byName('Raj')], detailStart);
    jobs.push(job);
  }

  // --- Two-stage job: wash done (flagged — suspiciously fast), detail waiting for assignment --
  {
    const { job } = draftJob({ rand, index: index++, arrivalMs: now - 14 * MIN, serviceId: 'svc-deep' });
    const washStart = now - 14 * MIN;
    startStage(job, 1, [byName('Rahul')], washStart);
    completeStage(job, 1, 6, byName('Rahul').id); // 6 min against a 25 min target — auto-flagged
    jobs.push(job);
  }

  // --- One car handed to a worker but not yet accepted -----------------------
  const notifications: AppNotification[] = [];
  {
    const { job } = draftJob({ rand, index: index++, arrivalMs: now - 2 * MIN, serviceId: pick(rand, SIMPLE_SERVICE_IDS) });
    const assignedMs = now - 90_000;
    assignStage(job, 1, [byName('Sameer')], assignedMs);
    jobs.push(job);
    notifications.push({
      id: makeId('ntf', index),
      kind: 'stage_assigned',
      audience: 'worker',
      workerId: byName('Sameer').id,
      jobId: job.id,
      stageOrder: 1,
      title: `New job: ${job.plateNumber}`,
      body: `${job.stages[0].name}. Tap Accept to start the timer.`,
      createdAt: iso(assignedMs),
      readAt: null,
    });
  }

  // --- Queue: vehicles accepted but not yet started -------------------------
  for (let i = 0; i < 3; i += 1) {
    const { job } = draftJob({
      rand, index: index++, arrivalMs: now - (9 - i * 3) * MIN,
      serviceId: pick(rand, SIMPLE_SERVICE_IDS),
      paymentStatus: i === 0 ? 'unpaid' : 'paid',
    });
    jobs.push(job);
  }

  // --- Completed earlier today (mix of single- and two-stage) ---------------
  const workingNames = DEFAULT_WORKER_NAMES.filter((n) => n !== 'Faisal');
  for (let i = 0; i < 13; i += 1) {
    const w = byName(workingNames[i % workingNames.length]);
    const arrivalMs = now - (6 * 60 - i * 24) * MIN;
    const staged = i % 5 === 0; // occasional two-stage job in the history
    const { job } = draftJob({
      rand, index: index++, arrivalMs,
      serviceId: staged ? 'svc-full' : pick(rand, SIMPLE_SERVICE_IDS),
    });
    let cursor = arrivalMs + 2 * MIN;
    for (const jobStage of job.stages) {
      const crew = jobStage.workerCount > 1 ? [w, byName(pick(rand, workingNames))] : [w];
      startStage(job, jobStage.stageOrder, crew, cursor);
      const drift = Math.round((rand() - 0.55) * 14);
      const actual = Math.max(6, jobStage.expectedDuration + drift);
      completeStage(job, jobStage.stageOrder, actual, crew[crew.length - 1].id);
      cursor = new Date(jobStage.completionTime!).getTime();
    }
    job.handoverConfirmed = true;
    jobs.push(job);
  }

  // One cancelled vehicle today — customers do leave.
  {
    const { job } = draftJob({
      rand, index: index++, arrivalMs: now - 200 * MIN,
      serviceId: pick(rand, SIMPLE_SERVICE_IDS), paymentStatus: 'unpaid',
    });
    job.status = 'cancelled';
    jobs.push(job);
  }

  // --- History: two weeks of completed work for the reports screen ----------
  for (let day = 1; day <= 14; day += 1) {
    const count = 14 + Math.floor(rand() * 12);
    for (let i = 0; i < count; i += 1) {
      const w = byName(workingNames[Math.floor(rand() * workingNames.length)]);
      const arrivalMs = now - day * 24 * 60 * MIN - Math.floor(rand() * 7 * 60) * MIN;
      const staged = rand() < 0.2;
      const { job } = draftJob({
        rand, index: index++, arrivalMs,
        serviceId: staged ? pick(rand, [...STAGED_SERVICE_IDS]) : pick(rand, SIMPLE_SERVICE_IDS),
      });
      let cursor = arrivalMs + 2 * MIN;
      for (const jobStage of job.stages) {
        const crew = jobStage.workerCount > 1 ? [w, byName(pick(rand, workingNames))] : [w];
        startStage(job, jobStage.stageOrder, crew, cursor);
        const drift = Math.round((rand() - 0.55) * 16);
        const actual = Math.max(6, jobStage.expectedDuration + drift);
        completeStage(job, jobStage.stageOrder, actual, crew[crew.length - 1].id);
        cursor = new Date(jobStage.completionTime!).getTime();
      }
      job.paymentStatus = rand() > 0.12 ? 'paid' : rand() > 0.5 ? 'partial' : 'unpaid';
      job.handoverConfirmed = true;
      jobs.push(job);
    }
  }

  jobs.sort((a, b) => (a.arrivalTime < b.arrivalTime ? 1 : -1));

  return {
    jobs,
    workers,
    services: DEFAULT_SERVICES.map((s) => ({ ...s })),
    serviceStages: DEFAULT_SERVICE_STAGES.map((s) => ({ ...s })),
    carTypes: DEFAULT_CAR_TYPES.map((c) => ({ ...c })),
    durations: DEFAULT_SERVICE_DURATIONS.map((d) => ({ ...d })),
    notifications,
  };
}
