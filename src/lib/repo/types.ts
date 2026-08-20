import type {
  AppNotification,
  CarType,
  Job,
  NewJobInput,
  OpsSnapshot,
  PaymentStatus,
  Service,
  ServiceStage,
  Worker,
  WorkerBaseStatus,
} from '../types';

/**
 * The application talks to exactly one of these. `LocalRepository` keeps
 * everything in the browser for demonstrations; `SupabaseRepository` is the
 * production implementation. Screens never branch on which one is in use.
 */
export interface Repository {
  readonly mode: 'demo' | 'live';

  load(): Promise<OpsSnapshot>;
  /** Fires whenever data changes, locally or from another connected screen. */
  subscribe(onChange: () => void): () => void;

  // --- Floor operations ---
  createJob(input: NewJobInput): Promise<Job>;
  /** Hands a stage to worker(s) and notifies them — the clock does not start yet. */
  assignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job>;
  /** The worker's own action: accepts a pending assignment and starts the clock. */
  acceptStage(jobId: string, stageOrder: number, workerId: string): Promise<Job>;
  /** Admin override: assigns worker(s) and starts the clock immediately, bypassing acceptance. */
  startStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job>;
  /** Marks a stage done. Auto-flags implausibly fast completions for review. */
  completeStage(
    jobId: string,
    stageOrder: number,
    completedByWorkerId: string,
    photoUrl?: string | null,
  ): Promise<Job>;
  /** Swaps who's on a stage without touching its clock. */
  reassignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job>;
  cancelJob(jobId: string): Promise<Job>;
  updatePayment(jobId: string, paymentStatus: PaymentStatus): Promise<Job>;
  /** Independent of the worker's own completion claim — reception hands the car back. */
  confirmHandover(jobId: string): Promise<Job>;
  /** Admin clears a fraud flag once reviewed. */
  clearFlag(jobId: string, stageOrder: number): Promise<Job>;
  markNotificationRead(notificationId: string): Promise<void>;

  // --- Configuration ---
  setWorkerStatus(workerId: string, status: WorkerBaseStatus): Promise<Worker>;
  saveWorker(worker: Partial<Worker> & { name: string }): Promise<Worker>;
  removeWorker(workerId: string): Promise<void>;
  saveService(service: Partial<Service> & { serviceName: string }): Promise<Service>;
  removeService(serviceId: string): Promise<void>;
  saveCarType(carType: CarType): Promise<CarType>;
  /** `null` clears the override so the size-factor fallback applies again. */
  setDuration(serviceId: string, carTypeId: string, minutes: number | null): Promise<void>;
  /** Adds or updates one leg of a service (e.g. "Interior Detail"). */
  saveServiceStage(stage: ServiceStage): Promise<ServiceStage>;
  removeServiceStage(stageId: string): Promise<void>;

  /** Demo mode only: rebuild the sample day. */
  reseed?(): Promise<void>;
}
