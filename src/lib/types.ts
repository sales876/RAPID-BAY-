/**
 * Domain types shared by every layer of the application.
 *
 * Timestamps are ISO 8601 strings with an offset. Every countdown in the UI is
 * derived from these values, never from a locally accumulated counter, so a
 * refresh or a reconnect cannot make a timer drift.
 *
 * A job is one vehicle's visit. It is made of an ordered sequence of STAGES
 * (e.g. "Exterior Wash" then "Interior Detail") — most services have one
 * stage, but any service can be configured with more. Each stage has its own
 * worker(s), its own clock, and its own completion. The job's overall status
 * is derived from its stages, never stored independently of them.
 */

export type JobStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled';

/** Status as the floor sees it: derived from the stored status plus the clock. */
export type DisplayStatus =
  | 'waiting'
  | 'assigned'
  | 'in_progress'
  | 'finishing_soon'
  | 'overdue'
  | 'completed'
  | 'cancelled';

/**
 * A stage mirrors the job's lifecycle but scoped to one leg of the work.
 * `assigned` is the pending-acceptance state: a worker has been picked but
 * hasn't tapped Accept yet, so the clock hasn't started.
 */
export type StageStatus = 'waiting' | 'assigned' | 'in_progress' | 'completed';

export type PaymentStatus = 'paid' | 'unpaid' | 'partial';

/** Statuses a person sets. `working` / `finishing_soon` are always derived. */
export type WorkerBaseStatus = 'available' | 'on_break' | 'offline';

export type WorkerDisplayStatus =
  | 'available'
  | 'pending_accept'
  | 'working'
  | 'finishing_soon'
  | 'overdue'
  | 'on_break'
  | 'offline';

/**
 * `worker` is a floor staff account: they see only their own assigned stages.
 * `receptionist` runs the front desk: registers vehicles, takes payment, hands
 * cars back. `admin` sees and can do everything.
 */
export type Role = 'admin' | 'receptionist' | 'worker';

export interface CarType {
  id: string;
  label: string;
  /** Multiplier on a service's base duration when no explicit override exists. */
  sizeFactor: number;
  sortOrder: number;
  active: boolean;
}

/**
 * One leg of a service, e.g. "Exterior Wash" or "Interior Detail". Most
 * services have exactly one stage; a service is only multi-stage when an
 * admin explicitly adds a second leg with its own worker count and target.
 */
export interface ServiceStage {
  id: string;
  serviceId: string;
  /** 1-based position in the sequence. */
  stageOrder: number;
  name: string;
  /** How many workers must be assigned before this stage can start (1 or 2). */
  workerCount: number;
  /** Minutes, for a standard sedan — scaled by the car type's size factor. */
  baseDuration: number;
}

export interface Service {
  id: string;
  serviceName: string;
  /** Minutes, for a standard sedan. Sum of stage durations if staged. */
  baseDuration: number;
  price: number;
  sortOrder: number;
  active: boolean;
}

/** Explicit duration for one car type + service combination (single-stage services only). */
export interface ServiceDuration {
  id: string;
  serviceId: string;
  carTypeId: string;
  duration: number;
}

export interface Worker {
  id: string;
  name: string;
  phone?: string | null;
  status: WorkerBaseStatus;
  active: boolean;
  /** Set once this worker has a login on the staff portal. */
  hasAccount?: boolean;
}

/**
 * One stage of one job. Carries its own clock and its own worker assignment,
 * completely independent of every other stage on the same job.
 */
export interface JobStage {
  id: string;
  jobId: string;
  stageOrder: number;
  name: string;
  workerCount: number;
  workerIds: string[];
  /** Denormalised, parallel to workerIds, for display without a join. */
  workerNames: string[];
  status: StageStatus;
  /** Set the moment a worker is picked — before they've accepted. */
  assignedAt: string | null;
  startTime: string | null;
  expectedCompletionTime: string | null;
  completionTime: string | null;
  expectedDuration: number;
  actualDuration: number | null;
  /** Worker id who tapped "Complete" — the accountable party. */
  completedBy: string | null;
  /** Photo taken at completion, required before a stage can be marked done. */
  photoUrl: string | null;
  /** True when actual duration was implausibly short — surfaced to the admin. */
  flagged: boolean;
  flagReason: string | null;
}

export interface Job {
  id: string;
  customerId?: string | null;
  vehicleId?: string | null;
  serviceId: string | null;

  customerName: string;
  phone: string;
  plateNumber: string;
  carType: string;
  serviceName: string;
  price: number;

  /** Local business date, `YYYY-MM-DD`. */
  date: string;
  arrivalTime: string;
  /** Aggregate of the stages: waiting until stage 1 starts, completed once the last stage ends. */
  status: JobStatus;
  paymentStatus: PaymentStatus;
  /** True once every stage is complete and the car has been physically handed back. */
  handoverConfirmed: boolean;

  stages: JobStage[];
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewJobInput {
  customerName: string;
  phone: string;
  plateNumber: string;
  carType: string;
  serviceId: string;
  /** Worker(s) for stage 1 only. Later stages are assigned as the job progresses. */
  workerIds: string[];
  paymentStatus: PaymentStatus;
  /** false puts the vehicle in the queue as WAITING without starting stage 1's timer. */
  startNow: boolean;
  notes?: string;
}

export type NotificationAudience = 'worker' | 'staff';
export type NotificationKind = 'stage_assigned' | 'stage_completed';

/**
 * An alert for one side of the workflow: a worker gets told a car has been
 * handed to them and needs acceptance; staff get told when a stage finishes.
 * Delivered in-app via realtime and, if the browser allows it, as a push
 * notification too.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  audience: NotificationAudience;
  workerId: string | null;
  jobId: string;
  stageOrder: number;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface Session {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  /** Set when role is 'worker' — links the login to their floor identity. */
  workerId?: string | null;
}

/** Everything the operations screens need, loaded as one snapshot. */
export interface OpsSnapshot {
  jobs: Job[];
  workers: Worker[];
  services: Service[];
  serviceStages: ServiceStage[];
  carTypes: CarType[];
  durations: ServiceDuration[];
  notifications: AppNotification[];
}

/** A stage with all clock-derived values resolved against a given instant. */
export interface LiveJobStage extends JobStage {
  displayStatus: DisplayStatus;
  remainingSeconds: number;
  performanceDelta: number | null;
}

/** A job with all clock-derived values resolved against a given instant. */
export interface LiveJob extends Job {
  stages: LiveJobStage[];
  /** The stage currently running, or the next one waiting to start. Null once the job is fully done. */
  currentStage: LiveJobStage | null;
  displayStatus: DisplayStatus;
  remainingSeconds: number;
  /** Sum of every stage's target — the whole job's expected time. */
  totalExpectedDuration: number;
  /** Sum of every stage's actual time. Null until every stage is complete. */
  totalActualDuration: number | null;
  performanceDelta: number | null;
  isActive: boolean;
  /** True when a completed stage on this job was auto-flagged and hasn't been cleared. */
  hasFlag: boolean;
}

export interface LiveWorker extends Worker {
  displayStatus: WorkerDisplayStatus;
  /** The stage this worker is actively on right now, if any. */
  currentStage: LiveJobStage | null;
  currentJob: LiveJob | null;
  /** Seconds until the worker can take another vehicle. 0 = now. */
  availableInSeconds: number;
  nextAvailableAt: string | null;
  jobsToday: number;
  activeJobs: number;
}
