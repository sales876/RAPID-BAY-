import { FRAUD_FLAG_RATIO, resolveStages } from '../config';
import { businessDate } from '../time';
import type {
  AppNotification,
  CarType,
  Job,
  JobStage,
  NewJobInput,
  OpsSnapshot,
  PaymentStatus,
  Service,
  ServiceStage,
  Worker,
  WorkerBaseStatus,
} from '../types';
import { buildSeed } from './seed';
import type { Repository } from './types';

const STORAGE_KEY = 'jrhq.ops.v2';
const CHANNEL = 'jrhq-ops';

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/**
 * Demo-mode repository.
 *
 * Persists to localStorage and broadcasts changes over a BroadcastChannel so
 * two tabs behave like two terminals on the same counter — the same feel as
 * Supabase realtime, without a backend. Stage transitions carry the exact
 * same timestamps and fraud-flag logic the database implementation uses.
 */
export class LocalRepository implements Repository {
  readonly mode = 'demo' as const;

  private data: OpsSnapshot | null = null;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;

  private read(): OpsSnapshot {
    if (this.data) return this.data;
    if (typeof window === 'undefined') {
      this.data = buildSeed();
      return this.data;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        this.data = JSON.parse(raw) as OpsSnapshot;
        if (!this.data.notifications) this.data.notifications = [];
        for (const job of this.data.jobs) {
          for (const stage of job.stages) {
            if (stage.assignedAt === undefined) stage.assignedAt = null;
          }
        }
        return this.data;
      } catch {
        // Corrupt payload — fall through and rebuild.
      }
    }
    this.data = buildSeed();
    this.persist();
    return this.data;
  }

  private persist() {
    if (typeof window === 'undefined' || !this.data) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  private commit() {
    this.persist();
    this.listeners.forEach((fn) => fn());
    this.channel?.postMessage('changed');
  }

  async load(): Promise<OpsSnapshot> {
    return structuredClone(this.read());
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    if (typeof window !== 'undefined' && !this.channel) {
      try {
        this.channel = new BroadcastChannel(CHANNEL);
        this.channel.onmessage = () => {
          this.data = null; // another tab wrote; re-read from storage
          this.listeners.forEach((fn) => fn());
        };
      } catch {
        this.channel = null;
      }
    }
    return () => {
      this.listeners.delete(onChange);
    };
  }

  // --- helpers -------------------------------------------------------------

  private job(jobId: string): Job {
    const job = this.read().jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    return job;
  }

  private stage(job: Job, stageOrder: number): JobStage {
    const stage = job.stages.find((s) => s.stageOrder === stageOrder);
    if (!stage) throw new Error(`Job ${job.id} has no stage ${stageOrder}`);
    return stage;
  }

  private touch(job: Job) {
    job.updatedAt = new Date().toISOString();
    this.commit();
    return job;
  }

  private notify(n: Omit<AppNotification, 'id' | 'createdAt' | 'readAt'>) {
    const data = this.read();
    data.notifications.unshift({
      ...n,
      id: makeId('ntf'),
      createdAt: new Date().toISOString(),
      readAt: null,
    });
  }

  // --- floor operations ----------------------------------------------------

  async createJob(input: NewJobInput): Promise<Job> {
    const data = this.read();
    const now = new Date();
    const nowIso = now.toISOString();

    const service = data.services.find((s) => s.id === input.serviceId);
    if (!service) throw new Error('Select a service before registering the vehicle.');

    const workers = input.workerIds
      .map((id) => data.workers.find((w) => w.id === id))
      .filter((w): w is Worker => Boolean(w));

    const resolved = resolveStages(
      input.serviceId,
      input.carType,
      data.services,
      data.carTypes,
      data.durations,
      data.serviceStages,
    );

    const assignNow = input.startNow && workers.length > 0;
    const jobId = makeId('job');

    const stages: JobStage[] = resolved.map((rs, idx) => {
      const isFirst = idx === 0;
      return {
        id: makeId('stg'),
        jobId,
        stageOrder: rs.stageOrder,
        name: rs.name,
        workerCount: rs.workerCount,
        workerIds: isFirst ? workers.map((w) => w.id) : [],
        workerNames: isFirst ? workers.map((w) => w.name) : [],
        status: isFirst && assignNow ? 'assigned' : 'waiting',
        assignedAt: isFirst && assignNow ? nowIso : null,
        startTime: null,
        expectedCompletionTime: null,
        completionTime: null,
        expectedDuration: rs.duration,
        actualDuration: null,
        completedBy: null,
        photoUrl: null,
        flagged: false,
        flagReason: null,
      };
    });

    const job: Job = {
      id: jobId,
      customerId: null,
      vehicleId: null,
      serviceId: input.serviceId,
      customerName: input.customerName.trim(),
      phone: input.phone.trim(),
      plateNumber: input.plateNumber.trim().toUpperCase(),
      carType: input.carType,
      serviceName: service.serviceName,
      price: service.price,
      date: businessDate(now),
      arrivalTime: nowIso,
      status: 'waiting',
      paymentStatus: input.paymentStatus,
      handoverConfirmed: false,
      stages,
      notes: input.notes?.trim() || null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    data.jobs.unshift(job);
    if (assignNow) {
      for (const w of workers) {
        this.notify({
          kind: 'stage_assigned', audience: 'worker', workerId: w.id,
          jobId: job.id, stageOrder: stages[0].stageOrder,
          title: `New job: ${job.plateNumber}`,
          body: `${stages[0].name} · ${job.serviceName}. Tap Accept to start the timer.`,
        });
      }
    }
    this.commit();
    return job;
  }

  async assignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job> {
    const data = this.read();
    const job = this.job(jobId);
    const stage = this.stage(job, stageOrder);
    const workers = workerIds
      .map((id) => data.workers.find((w) => w.id === id))
      .filter((w): w is Worker => Boolean(w));
    if (!workers.length) throw new Error('Assign at least one worker before handing off this stage.');

    stage.workerIds = workers.map((w) => w.id);
    stage.workerNames = workers.map((w) => w.name);
    stage.status = 'assigned';
    stage.assignedAt = new Date().toISOString();
    stage.startTime = null;
    stage.expectedCompletionTime = null;
    for (const w of workers) {
      this.notify({
        kind: 'stage_assigned', audience: 'worker', workerId: w.id,
        jobId: job.id, stageOrder: stage.stageOrder,
        title: `New job: ${job.plateNumber}`,
        body: `${stage.name}. Tap Accept to start the timer.`,
      });
    }
    return this.touch(job);
  }

  async acceptStage(jobId: string, stageOrder: number, workerId: string): Promise<Job> {
    const job = this.job(jobId);
    const stage = this.stage(job, stageOrder);
    if (!stage.workerIds.includes(workerId)) throw new Error('You are not assigned to this stage.');
    if (stage.status !== 'assigned') throw new Error('This stage is not waiting for acceptance.');

    const now = new Date().toISOString();
    stage.startTime = now;
    stage.expectedCompletionTime = addMinutes(now, stage.expectedDuration);
    stage.status = 'in_progress';
    job.status = 'in_progress';
    return this.touch(job);
  }

  async startStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job> {
    const data = this.read();
    const job = this.job(jobId);
    const stage = this.stage(job, stageOrder);
    const workers = workerIds
      .map((id) => data.workers.find((w) => w.id === id))
      .filter((w): w is Worker => Boolean(w));
    if (!workers.length) throw new Error('Assign at least one worker before starting this stage.');

    const now = new Date().toISOString();
    stage.workerIds = workers.map((w) => w.id);
    stage.workerNames = workers.map((w) => w.name);
    stage.startTime = now;
    stage.expectedCompletionTime = addMinutes(now, stage.expectedDuration);
    stage.status = 'in_progress';
    stage.assignedAt = stage.assignedAt ?? now;
    job.status = 'in_progress';
    return this.touch(job);
  }

  async completeStage(
    jobId: string,
    stageOrder: number,
    completedByWorkerId: string,
    photoUrl: string | null = null,
  ): Promise<Job> {
    const job = this.job(jobId);
    const stage = this.stage(job, stageOrder);
    const now = new Date();
    const startedAt = new Date(stage.startTime ?? job.arrivalTime).getTime();
    const actual = Math.max(1, Math.round((now.getTime() - startedAt) / 60_000));

    stage.completionTime = now.toISOString();
    stage.actualDuration = actual;
    stage.status = 'completed';
    stage.completedBy = completedByWorkerId;
    stage.photoUrl = photoUrl;
    stage.flagged = false;
    stage.flagReason = null;

    if (actual < stage.expectedDuration * FRAUD_FLAG_RATIO) {
      stage.flagged = true;
      stage.flagReason = `Completed in ${actual} min against a ${stage.expectedDuration} min target, under ${Math.round(FRAUD_FLAG_RATIO * 100)}% of target.`;
    }

    const allDone = job.stages.every((s) => s.status === 'completed');
    job.status = allDone ? 'completed' : 'in_progress';

    const workerName = this.read().workers.find((w) => w.id === completedByWorkerId)?.name ?? 'A worker';
    this.notify({
      kind: 'stage_completed', audience: 'staff', workerId: null,
      jobId: job.id, stageOrder: stage.stageOrder,
      title: `${workerName} finished ${stage.name}`,
      body: `${job.plateNumber} · ${actual} min (target ${stage.expectedDuration} min)${stage.flagged ? ', flagged for review' : ''}`,
    });

    return this.touch(job);
  }

  async reassignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job> {
    const data = this.read();
    const job = this.job(jobId);
    const stage = this.stage(job, stageOrder);
    const workers = workerIds
      .map((id) => data.workers.find((w) => w.id === id))
      .filter((w): w is Worker => Boolean(w));
    if (!workers.length) throw new Error('Unknown worker');
    stage.workerIds = workers.map((w) => w.id);
    stage.workerNames = workers.map((w) => w.name);
    if (stage.status === 'assigned') {
      stage.assignedAt = new Date().toISOString();
      for (const w of workers) {
        this.notify({
          kind: 'stage_assigned', audience: 'worker', workerId: w.id,
          jobId: job.id, stageOrder: stage.stageOrder,
          title: `New job: ${job.plateNumber}`,
          body: `${stage.name}. Tap Accept to start the timer.`,
        });
      }
    }
    return this.touch(job);
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const data = this.read();
    const n = data.notifications.find((x) => x.id === notificationId);
    if (n) n.readAt = new Date().toISOString();
    this.commit();
  }

  async cancelJob(jobId: string): Promise<Job> {
    const job = this.job(jobId);
    job.status = 'cancelled';
    return this.touch(job);
  }

  async updatePayment(jobId: string, paymentStatus: PaymentStatus): Promise<Job> {
    const job = this.job(jobId);
    job.paymentStatus = paymentStatus;
    return this.touch(job);
  }

  async confirmHandover(jobId: string): Promise<Job> {
    const job = this.job(jobId);
    job.handoverConfirmed = true;
    return this.touch(job);
  }

  async clearFlag(jobId: string, stageOrder: number): Promise<Job> {
    const job = this.job(jobId);
    const stage = this.stage(job, stageOrder);
    stage.flagged = false;
    return this.touch(job);
  }

  // --- configuration -------------------------------------------------------

  async setWorkerStatus(workerId: string, status: WorkerBaseStatus): Promise<Worker> {
    const data = this.read();
    const worker = data.workers.find((w) => w.id === workerId);
    if (!worker) throw new Error('Unknown worker');
    worker.status = status;
    this.commit();
    return worker;
  }

  async saveWorker(input: Partial<Worker> & { name: string }): Promise<Worker> {
    const data = this.read();
    if (input.id) {
      const worker = data.workers.find((w) => w.id === input.id);
      if (!worker) throw new Error('Unknown worker');
      Object.assign(worker, input);
      this.commit();
      return worker;
    }
    const worker: Worker = {
      id: `wrk-${input.name.toLowerCase().replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name,
      phone: input.phone ?? '',
      status: input.status ?? 'available',
      active: input.active ?? true,
      hasAccount: input.hasAccount ?? false,
    };
    data.workers.push(worker);
    this.commit();
    return worker;
  }

  async removeWorker(workerId: string): Promise<void> {
    const data = this.read();
    const worker = data.workers.find((w) => w.id === workerId);
    if (worker) worker.active = false; // never hard-delete: history references it
    this.commit();
  }

  async saveService(input: Partial<Service> & { serviceName: string }): Promise<Service> {
    const data = this.read();
    if (input.id) {
      const service = data.services.find((s) => s.id === input.id);
      if (!service) throw new Error('Unknown service');
      Object.assign(service, input);
      this.commit();
      return service;
    }
    const service: Service = {
      id: `svc-${Math.random().toString(36).slice(2, 8)}`,
      serviceName: input.serviceName,
      baseDuration: input.baseDuration ?? 30,
      price: input.price ?? 0,
      sortOrder: input.sortOrder ?? data.services.length + 1,
      active: input.active ?? true,
    };
    data.services.push(service);
    this.commit();
    return service;
  }

  async removeService(serviceId: string): Promise<void> {
    const data = this.read();
    const service = data.services.find((s) => s.id === serviceId);
    if (service) service.active = false;
    this.commit();
  }

  async saveCarType(carType: CarType): Promise<CarType> {
    const data = this.read();
    const existing = data.carTypes.find((c) => c.id === carType.id);
    if (existing) Object.assign(existing, carType);
    else data.carTypes.push(carType);
    this.commit();
    return carType;
  }

  async setDuration(serviceId: string, carTypeId: string, minutes: number | null): Promise<void> {
    const data = this.read();
    const idx = data.durations.findIndex(
      (d) => d.serviceId === serviceId && d.carTypeId === carTypeId,
    );
    if (minutes === null) {
      if (idx !== -1) data.durations.splice(idx, 1);
    } else if (idx !== -1) {
      data.durations[idx].duration = minutes;
    } else {
      data.durations.push({
        id: `sd-${Math.random().toString(36).slice(2, 8)}`,
        serviceId,
        carTypeId,
        duration: minutes,
      });
    }
    this.commit();
  }

  async saveServiceStage(stage: ServiceStage): Promise<ServiceStage> {
    const data = this.read();
    const idx = data.serviceStages.findIndex((s) => s.id === stage.id);
    if (idx !== -1) data.serviceStages[idx] = stage;
    else data.serviceStages.push(stage);
    this.commit();
    return stage;
  }

  async removeServiceStage(stageId: string): Promise<void> {
    const data = this.read();
    data.serviceStages = data.serviceStages.filter((s) => s.id !== stageId);
    this.commit();
  }

  async reseed(): Promise<void> {
    this.data = buildSeed();
    this.commit();
  }
}
