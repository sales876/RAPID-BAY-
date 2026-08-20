import { FINISHING_SOON_MINUTES } from './config';
import { businessDate } from './time';
import type {
  DisplayStatus,
  Job,
  JobStage,
  LiveJob,
  LiveJobStage,
  LiveWorker,
  Worker,
  WorkerDisplayStatus,
} from './types';

/**
 * Everything the dashboard shows about "where is this car and when is it
 * done" is computed here from stored timestamps and the current instant. No
 * countdown state is kept anywhere, which is what makes a refresh harmless.
 *
 * A job is a sequence of stages (see types.ts). Every clock-facing value is
 * resolved from the CURRENT stage — the first one not yet completed — so a
 * two-leg job (wash, then detail) behaves exactly like a one-leg job from the
 * dashboard's point of view: one countdown, one status, always pointed at
 * whichever leg is actually running right now.
 */

export function toLiveJobStage(stage: JobStage, now: number): LiveJobStage {
  let remainingSeconds = 0;
  if (stage.status === 'in_progress' && stage.expectedCompletionTime) {
    remainingSeconds = Math.round(
      (new Date(stage.expectedCompletionTime).getTime() - now) / 1000,
    );
  }

  let displayStatus: DisplayStatus;
  switch (stage.status) {
    case 'waiting':
      displayStatus = 'waiting';
      break;
    case 'assigned':
      displayStatus = 'assigned';
      break;
    case 'completed':
      displayStatus = 'completed';
      break;
    default:
      if (remainingSeconds < 0) displayStatus = 'overdue';
      else if (remainingSeconds <= FINISHING_SOON_MINUTES * 60) displayStatus = 'finishing_soon';
      else displayStatus = 'in_progress';
  }

  const performanceDelta =
    stage.status === 'completed' && stage.actualDuration !== null
      ? stage.actualDuration - stage.expectedDuration
      : null;

  return { ...stage, displayStatus, remainingSeconds, performanceDelta };
}

export function toLiveJob(job: Job, now: number): LiveJob {
  const liveStages = job.stages
    .slice()
    .sort((a, b) => a.stageOrder - b.stageOrder)
    .map((s) => toLiveJobStage(s, now));

  const currentStage =
    job.status === 'cancelled'
      ? null
      : (liveStages.find((s) => s.status !== 'completed') ?? liveStages.at(-1) ?? null);

  const isActive = job.status === 'waiting' || job.status === 'in_progress';

  let displayStatus: DisplayStatus;
  if (job.status === 'cancelled') displayStatus = 'cancelled';
  else if (job.status === 'completed') displayStatus = 'completed';
  else if (job.status === 'waiting') {
    // Job-level status doesn't flip to in_progress until a worker actually
    // accepts, so a stage sitting pending acceptance still reads 'waiting' at
    // the job level unless we borrow the stage's own display status here.
    displayStatus = currentStage?.status === 'assigned' ? 'assigned' : 'waiting';
  } else displayStatus = currentStage?.displayStatus ?? 'in_progress';

  const totalExpectedDuration = liveStages.reduce((sum, s) => sum + s.expectedDuration, 0);
  const allDone = liveStages.length > 0 && liveStages.every((s) => s.status === 'completed');
  const totalActualDuration = allDone
    ? liveStages.reduce((sum, s) => sum + (s.actualDuration ?? 0), 0)
    : null;

  const performanceDelta =
    job.status === 'completed' && totalActualDuration !== null
      ? totalActualDuration - totalExpectedDuration
      : null;

  const hasFlag = liveStages.some((s) => s.flagged);

  return {
    ...job,
    stages: liveStages,
    currentStage,
    displayStatus,
    remainingSeconds: currentStage?.remainingSeconds ?? 0,
    totalExpectedDuration,
    totalActualDuration,
    performanceDelta,
    isActive,
    hasFlag,
  };
}

export function toLiveJobs(jobs: Job[], now: number): LiveJob[] {
  return jobs.map((j) => toLiveJob(j, now));
}

export function toLiveWorker(
  worker: Worker,
  liveJobs: LiveJob[],
  now: number,
): LiveWorker {
  const today = businessDate(new Date(now));

  // Every stage across every job where this worker is assigned. Cancelling a
  // job never resets its stages' own status rows, so a stage that was
  // in_progress at the moment of cancellation would otherwise keep counting
  // as active work forever — skip cancelled jobs explicitly here.
  const myStages: { job: LiveJob; stage: LiveJobStage }[] = [];
  for (const job of liveJobs) {
    if (job.status === 'cancelled') continue;
    for (const stage of job.stages) {
      if (stage.workerIds.includes(worker.id)) myStages.push({ job, stage });
    }
  }

  const active = myStages.filter(({ stage }) => stage.status === 'in_progress');
  const pending = myStages.filter(({ stage }) => stage.status === 'assigned');
  // If more than one stage is open (shouldn't normally happen), the one
  // finishing last governs when this worker is truly free again.
  const currentEntry = active
    .slice()
    .sort((a, b) => a.stage.remainingSeconds - b.stage.remainingSeconds)
    .pop();
  const currentStage = currentEntry?.stage ?? pending[0]?.stage ?? null;
  const currentJob = currentEntry?.job ?? pending[0]?.job ?? null;

  let displayStatus: WorkerDisplayStatus;
  let availableInSeconds = 0;

  if (worker.status === 'offline') {
    displayStatus = 'offline';
    availableInSeconds = Number.POSITIVE_INFINITY;
  } else if (worker.status === 'on_break' && !currentEntry && !pending.length) {
    displayStatus = 'on_break';
    availableInSeconds = Number.POSITIVE_INFINITY;
  } else if (currentEntry) {
    availableInSeconds = Math.max(0, currentEntry.stage.remainingSeconds);
    if (currentEntry.stage.displayStatus === 'overdue') displayStatus = 'overdue';
    else if (currentEntry.stage.displayStatus === 'finishing_soon') displayStatus = 'finishing_soon';
    else displayStatus = 'working';
  } else if (pending.length) {
    displayStatus = 'pending_accept';
    availableInSeconds = 0;
  } else {
    displayStatus = 'available';
    availableInSeconds = 0;
  }

  const completedStagesToday = myStages.filter(
    ({ job, stage }) => job.date === today && stage.status === 'completed',
  ).length;

  return {
    ...worker,
    displayStatus,
    currentStage,
    currentJob,
    availableInSeconds,
    nextAvailableAt: currentStage?.expectedCompletionTime ?? null,
    jobsToday: completedStagesToday,
    activeJobs: active.length,
  };
}

export function toLiveWorkers(
  workers: Worker[],
  liveJobs: LiveJob[],
  now: number,
): LiveWorker[] {
  return workers.filter((w) => w.active).map((w) => toLiveWorker(w, liveJobs, now));
}

/**
 * Assignment ordering for the registration form: who can take this car, and
 * who can take it soonest. Ties break towards the lighter workload.
 */
export function rankWorkersForAssignment(workers: LiveWorker[]): LiveWorker[] {
  const rank = (w: LiveWorker) => {
    if (w.displayStatus === 'available') return 0;
    if (w.displayStatus === 'finishing_soon') return 1;
    if (w.displayStatus === 'pending_accept') return 2;
    if (w.displayStatus === 'working' || w.displayStatus === 'overdue') return 3;
    if (w.displayStatus === 'on_break') return 4;
    return 5; // offline
  };
  return workers.slice().sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const avail = a.availableInSeconds - b.availableInSeconds;
    if (Number.isFinite(avail) && avail !== 0) return avail;
    const load = a.activeJobs - b.activeJobs;
    if (load !== 0) return load;
    return a.name.localeCompare(b.name);
  });
}

export interface AvailabilityBoard {
  now: LiveWorker[];
  within5: LiveWorker[];
  within10: LiveWorker[];
  busy: LiveWorker[];
  unavailable: LiveWorker[];
}

export function buildAvailabilityBoard(workers: LiveWorker[]): AvailabilityBoard {
  const board: AvailabilityBoard = { now: [], within5: [], within10: [], busy: [], unavailable: [] };
  for (const w of workers) {
    if (w.displayStatus === 'offline' || w.displayStatus === 'on_break') board.unavailable.push(w);
    else if (w.displayStatus === 'available') board.now.push(w);
    else if (w.displayStatus === 'pending_accept' || w.displayStatus === 'overdue') board.busy.push(w);
    else if (w.availableInSeconds <= 5 * 60) board.within5.push(w);
    else if (w.availableInSeconds <= 10 * 60) board.within10.push(w);
    else board.busy.push(w);
  }
  const bySoonest = (a: LiveWorker, b: LiveWorker) => a.availableInSeconds - b.availableInSeconds;
  board.within5.sort(bySoonest);
  board.within10.sort(bySoonest);
  board.busy.sort(bySoonest);
  return board;
}

export interface DayOverview {
  vehiclesToday: number;
  currentlyWashing: number;
  completed: number;
  waiting: number;
  cancelled: number;
  workersAvailable: number;
  workersFinishingSoon: number;
  overdueJobs: number;
  flaggedJobs: number;
  unpaid: number;
  revenueCollected: number;
}

export function buildDayOverview(
  jobs: LiveJob[],
  workers: LiveWorker[],
  dateKey: string,
): DayOverview {
  const today = jobs.filter((j) => j.date === dateKey);
  return {
    vehiclesToday: today.length,
    currentlyWashing: today.filter((j) => j.status === 'in_progress').length,
    completed: today.filter((j) => j.status === 'completed').length,
    waiting: today.filter((j) => j.status === 'waiting').length,
    cancelled: today.filter((j) => j.status === 'cancelled').length,
    workersAvailable: workers.filter((w) => w.displayStatus === 'available').length,
    workersFinishingSoon: workers.filter((w) => w.displayStatus === 'finishing_soon').length,
    overdueJobs: today.filter((j) => j.displayStatus === 'overdue').length,
    flaggedJobs: today.filter((j) => j.hasFlag).length,
    unpaid: today.filter((j) => j.paymentStatus === 'unpaid').length,
    revenueCollected: today
      .filter((j) => j.paymentStatus === 'paid')
      .reduce((sum, j) => sum + Number(j.price || 0), 0),
  };
}

export interface WorkerPerformance {
  workerId: string;
  name: string;
  /** Stages completed, not whole jobs — a two-leg job counts once per worker who worked a leg of it. */
  completed: number;
  completedToday: number;
  activeJobs: number;
  flagged: number;
  avgTarget: number | null;
  avgActual: number | null;
  avgDifference: number | null;
  onTimeRate: number | null;
  revenue: number;
}

export function buildWorkerPerformance(
  workers: LiveWorker[],
  jobs: LiveJob[],
  todayKey: string,
): WorkerPerformance[] {
  return workers
    .map((w) => {
      const myStages = jobs.flatMap((job) =>
        job.stages
          .filter((s) => s.workerIds.includes(w.id))
          .map((stage) => ({ job, stage })),
      );
      const done = myStages.filter(({ stage }) => stage.status === 'completed' && stage.actualDuration !== null);
      const avg = (values: number[]) =>
        values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

      const avgTarget = avg(done.map(({ stage }) => stage.expectedDuration));
      const avgActual = avg(done.map(({ stage }) => stage.actualDuration as number));
      const onTime = done.filter(({ stage }) => (stage.actualDuration as number) <= stage.expectedDuration).length;

      // Revenue credit: paid jobs, split evenly across the stages this worker
      // shared with a colleague, so a two-person detail leg doesn't double-count.
      const revenue = myStages
        .filter(({ job }) => job.paymentStatus === 'paid')
        .reduce((sum, { job, stage }) => sum + Number(job.price || 0) / job.stages.length / stage.workerIds.length, 0);

      return {
        workerId: w.id,
        name: w.name,
        completed: done.length,
        completedToday: done.filter(({ job }) => job.date === todayKey).length,
        activeJobs: w.activeJobs,
        flagged: myStages.filter(({ stage }) => stage.flagged).length,
        avgTarget,
        avgActual,
        avgDifference: avgTarget !== null && avgActual !== null ? avgActual - avgTarget : null,
        onTimeRate: done.length ? onTime / done.length : null,
        revenue,
      };
    })
    .sort((a, b) => b.completed - a.completed);
}

export interface PeriodReport {
  totalVehicles: number;
  completed: number;
  cancelled: number;
  active: number;
  overdue: number;
  flagged: number;
  avgActual: number | null;
  avgExpected: number | null;
  avgDifference: number | null;
  revenueCollected: number;
  revenueOutstanding: number;
  paid: number;
  unpaid: number;
  partial: number;
}

export function buildPeriodReport(jobs: LiveJob[]): PeriodReport {
  const done = jobs.filter((j) => j.status === 'completed' && j.totalActualDuration !== null);
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const avgActual = avg(done.map((j) => j.totalActualDuration as number));
  const avgExpected = avg(done.map((j) => j.totalExpectedDuration));

  return {
    totalVehicles: jobs.length,
    completed: done.length,
    cancelled: jobs.filter((j) => j.status === 'cancelled').length,
    active: jobs.filter((j) => j.isActive).length,
    overdue:
      jobs.filter((j) => j.displayStatus === 'overdue').length +
      done.filter((j) => (j.totalActualDuration as number) > j.totalExpectedDuration).length,
    flagged: jobs.filter((j) => j.hasFlag).length,
    avgActual,
    avgExpected,
    avgDifference: avgActual !== null && avgExpected !== null ? avgActual - avgExpected : null,
    revenueCollected: jobs
      .filter((j) => j.paymentStatus === 'paid')
      .reduce((s, j) => s + Number(j.price || 0), 0),
    revenueOutstanding: jobs
      .filter((j) => j.paymentStatus !== 'paid' && j.status !== 'cancelled')
      .reduce((s, j) => s + Number(j.price || 0), 0),
    paid: jobs.filter((j) => j.paymentStatus === 'paid').length,
    unpaid: jobs.filter((j) => j.paymentStatus === 'unpaid').length,
    partial: jobs.filter((j) => j.paymentStatus === 'partial').length,
  };
}

/** Every stage, across every job, that this worker can act on right now or next. */
export function myActiveStages(
  jobs: LiveJob[],
  workerId: string,
): { job: LiveJob; stage: LiveJobStage }[] {
  const out: { job: LiveJob; stage: LiveJobStage }[] = [];
  for (const job of jobs) {
    if (job.status === 'cancelled' || job.status === 'completed') continue;
    for (const stage of job.stages) {
      if (stage.workerIds.includes(workerId) && stage.status !== 'completed') {
        out.push({ job, stage });
      }
    }
  }
  return out;
}

/** This worker's finished stages, most recent first — their personal history. */
export function myCompletedStages(
  jobs: LiveJob[],
  workerId: string,
  dateKey?: string,
): { job: LiveJob; stage: LiveJobStage }[] {
  const out: { job: LiveJob; stage: LiveJobStage }[] = [];
  for (const job of jobs) {
    if (dateKey && job.date !== dateKey) continue;
    for (const stage of job.stages) {
      if (stage.workerIds.includes(workerId) && stage.status === 'completed') {
        out.push({ job, stage });
      }
    }
  }
  return out.sort((a, b) => (a.stage.completionTime! < b.stage.completionTime! ? 1 : -1));
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  waiting: 'Waiting',
  assigned: 'Pending Accept',
  in_progress: 'In Progress',
  finishing_soon: 'Finishing Soon',
  overdue: 'Overdue',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const WORKER_STATUS_LABEL: Record<WorkerDisplayStatus, string> = {
  available: 'Available',
  pending_accept: 'Pending Accept',
  working: 'Working',
  finishing_soon: 'Finishing Soon',
  overdue: 'Overdue',
  on_break: 'On Break',
  offline: 'Offline',
};
