'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resolveStages, type ResolvedStage } from './config';
import { toLiveJobs, toLiveWorkers } from './derive';
import { getRepository } from './repo';
import { businessDate } from './time';
import type {
  LiveJob,
  LiveWorker,
  NewJobInput,
  OpsSnapshot,
  PaymentStatus,
  WorkerBaseStatus,
} from './types';

/**
 * Single source of operational truth for every screen — admin, receptionist,
 * and the staff portal all read from this same context.
 *
 * One snapshot of records, one clock. The clock ticks once a second and every
 * countdown, status pill and availability bucket is recomputed from stored
 * timestamps — so the numbers are correct after a refresh, after a reconnect,
 * and on a second terminal.
 */

const EMPTY: OpsSnapshot = {
  jobs: [], workers: [], services: [], serviceStages: [], carTypes: [], durations: [], notifications: [],
};

interface OpsValue {
  ready: boolean;
  error: string | null;
  mode: 'demo' | 'live';
  snapshot: OpsSnapshot;
  jobs: LiveJob[];
  workers: LiveWorker[];
  /** Milliseconds since epoch, ticking each second. */
  now: number;
  /** Business date key, recomputed as the clock advances. */
  today: string;
  refresh(): Promise<void>;

  createJob(input: NewJobInput): Promise<void>;
  assignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<void>;
  acceptStage(jobId: string, stageOrder: number, workerId: string): Promise<void>;
  startStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<void>;
  completeStage(
    jobId: string,
    stageOrder: number,
    completedByWorkerId: string,
    photoUrl?: string | null,
  ): Promise<void>;
  reassignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  updatePayment(jobId: string, status: PaymentStatus): Promise<void>;
  confirmHandover(jobId: string): Promise<void>;
  clearFlag(jobId: string, stageOrder: number): Promise<void>;
  markNotificationRead(notificationId: string): Promise<void>;
  setWorkerStatus(workerId: string, status: WorkerBaseStatus): Promise<void>;

  /** The full stage blueprint (name, worker count, target minutes) for a service + car type. */
  estimateStages(serviceId: string, carType: string): ResolvedStage[];
  repo: ReturnType<typeof getRepository>;
}

const OpsContext = createContext<OpsValue | null>(null);

export function OpsProvider({ children }: { children: React.ReactNode }) {
  const repoRef = useRef<ReturnType<typeof getRepository> | null>(null);
  if (!repoRef.current) repoRef.current = getRepository();
  const repo = repoRef.current;

  const [snapshot, setSnapshot] = useState<OpsSnapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const data = await repo.load();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load operations data.');
    } finally {
      setReady(true);
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
    const unsubscribe = repo.subscribe(() => {
      void refresh();
    });
    return unsubscribe;
  }, [repo, refresh]);

  // The single clock every countdown reads from.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const jobs = useMemo(() => toLiveJobs(snapshot.jobs, now), [snapshot.jobs, now]);
  const workers = useMemo(
    () => toLiveWorkers(snapshot.workers, jobs, now),
    [snapshot.workers, jobs, now],
  );
  const today = useMemo(() => businessDate(new Date(now)), [now]);

  const action = useCallback(
    <T,>(fn: () => Promise<T>) =>
      async () => {
        try {
          await fn();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Action failed.');
          throw err;
        } finally {
          await refresh();
        }
      },
    [refresh],
  );

  const value = useMemo<OpsValue>(
    () => ({
      ready,
      error,
      mode: repo.mode,
      snapshot,
      jobs,
      workers,
      now,
      today,
      refresh,
      repo,
      createJob: (input) => action(() => repo.createJob(input))(),
      assignStage: (jobId, stageOrder, workerIds) =>
        action(() => repo.assignStage(jobId, stageOrder, workerIds))(),
      acceptStage: (jobId, stageOrder, workerId) =>
        action(() => repo.acceptStage(jobId, stageOrder, workerId))(),
      startStage: (jobId, stageOrder, workerIds) =>
        action(() => repo.startStage(jobId, stageOrder, workerIds))(),
      completeStage: (jobId, stageOrder, completedBy, photoUrl) =>
        action(() => repo.completeStage(jobId, stageOrder, completedBy, photoUrl ?? null))(),
      reassignStage: (jobId, stageOrder, workerIds) =>
        action(() => repo.reassignStage(jobId, stageOrder, workerIds))(),
      cancelJob: (jobId) => action(() => repo.cancelJob(jobId))(),
      updatePayment: (jobId, status) => action(() => repo.updatePayment(jobId, status))(),
      confirmHandover: (jobId) => action(() => repo.confirmHandover(jobId))(),
      clearFlag: (jobId, stageOrder) => action(() => repo.clearFlag(jobId, stageOrder))(),
      markNotificationRead: (notificationId) =>
        action(() => repo.markNotificationRead(notificationId))(),
      setWorkerStatus: (workerId, status) =>
        action(() => repo.setWorkerStatus(workerId, status))(),
      estimateStages: (serviceId, carType) =>
        resolveStages(
          serviceId, carType, snapshot.services, snapshot.carTypes,
          snapshot.durations, snapshot.serviceStages,
        ),
    }),
    [ready, error, repo, snapshot, jobs, workers, now, today, refresh, action],
  );

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOps(): OpsValue {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error('useOps must be used inside OpsProvider');
  return ctx;
}
