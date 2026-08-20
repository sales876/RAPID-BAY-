import type { CarType, Service, ServiceDuration, ServiceStage } from './types';

/**
 * Business configuration. Anything an operator might reasonably want to change
 * lives here or in the database — never inline in a component.
 */
export const BUSINESS = {
  name: process.env.NEXT_PUBLIC_BUSINESS_NAME || 'JRHQ Car Wash',
  branch: process.env.NEXT_PUBLIC_BRANCH_NAME || 'Main Branch',
  timezone: process.env.NEXT_PUBLIC_TIMEZONE || 'Asia/Dubai',
  currency: 'AED',
};

/** Remaining minutes at which a job is flagged "Finishing Soon". */
export const FINISHING_SOON_MINUTES = Number(
  process.env.NEXT_PUBLIC_FINISHING_SOON_MINUTES || 5,
);

/** Availability buckets on the dashboard, in minutes. */
export const AVAILABILITY_BUCKETS = [5, 10] as const;

/**
 * A completed stage under this fraction of its target duration is auto-flagged
 * for admin review — the cheapest fraud check available: a wash that finished
 * in a third of the expected time didn't happen the way it was logged.
 */
export const FRAUD_FLAG_RATIO = 0.5;

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// ---------------------------------------------------------------------------
// Default reference data.
//
// In live mode these rows live in Supabase and are edited from the Services
// screen. In demo mode they seed the local store, which is then equally
// editable. Either way the UI reads the configuration, never these constants.
// ---------------------------------------------------------------------------

export const DEFAULT_CAR_TYPES: CarType[] = [
  { id: 'sedan', label: 'Sedan', sizeFactor: 1.0, sortOrder: 1, active: true },
  { id: 'hatchback', label: 'Hatchback', sizeFactor: 0.9, sortOrder: 2, active: true },
  { id: 'suv', label: 'SUV', sizeFactor: 1.25, sortOrder: 3, active: true },
  { id: 'coupe', label: 'Coupe', sizeFactor: 0.95, sortOrder: 4, active: true },
  { id: 'luxury_sedan', label: 'Luxury Sedan', sizeFactor: 1.2, sortOrder: 5, active: true },
  { id: 'large_suv', label: 'Large SUV', sizeFactor: 1.45, sortOrder: 6, active: true },
  { id: 'pickup', label: 'Pickup / Truck', sizeFactor: 1.4, sortOrder: 7, active: true },
  { id: 'van', label: 'Van', sizeFactor: 1.35, sortOrder: 8, active: true },
];

export const DEFAULT_SERVICES: Service[] = [
  { id: 'svc-basic', serviceName: 'Basic Wash', baseDuration: 20, price: 35, sortOrder: 1, active: true },
  { id: 'svc-premium', serviceName: 'Premium Wash', baseDuration: 30, price: 60, sortOrder: 2, active: true },
  { id: 'svc-interior', serviceName: 'Interior Cleaning', baseDuration: 25, price: 55, sortOrder: 3, active: true },
  { id: 'svc-extint', serviceName: 'Exterior + Interior', baseDuration: 40, price: 90, sortOrder: 4, active: true },
  { id: 'svc-full', serviceName: 'Full Detailing', baseDuration: 60, price: 180, sortOrder: 5, active: true },
  { id: 'svc-deep', serviceName: 'Deep Cleaning', baseDuration: 75, price: 220, sortOrder: 6, active: true },
  { id: 'svc-wax', serviceName: 'Wax & Polish', baseDuration: 45, price: 140, sortOrder: 7, active: true },
  { id: 'svc-premdetail', serviceName: 'Premium Detailing', baseDuration: 90, price: 320, sortOrder: 8, active: true },
];

/** Explicit overrides. Everything else falls back to base × size factor. */
export const DEFAULT_SERVICE_DURATIONS: ServiceDuration[] = [
  { id: 'sd-1', serviceId: 'svc-basic', carTypeId: 'sedan', duration: 20 },
  { id: 'sd-2', serviceId: 'svc-basic', carTypeId: 'hatchback', duration: 18 },
  { id: 'sd-3', serviceId: 'svc-basic', carTypeId: 'suv', duration: 25 },
  { id: 'sd-4', serviceId: 'svc-basic', carTypeId: 'large_suv', duration: 30 },
  { id: 'sd-5', serviceId: 'svc-basic', carTypeId: 'pickup', duration: 30 },
  { id: 'sd-6', serviceId: 'svc-premium', carTypeId: 'sedan', duration: 30 },
  { id: 'sd-7', serviceId: 'svc-premium', carTypeId: 'suv', duration: 40 },
  { id: 'sd-8', serviceId: 'svc-premium', carTypeId: 'large_suv', duration: 45 },
  { id: 'sd-9', serviceId: 'svc-extint', carTypeId: 'sedan', duration: 40 },
  { id: 'sd-10', serviceId: 'svc-extint', carTypeId: 'suv', duration: 50 },
];

/**
 * Services with more than one worker leg. Absent from this list = a single
 * implicit stage covering the whole service with one worker. This is exactly
 * the Sharjah two-step pattern: one person washes the exterior, then two
 * people take the car for interior detail — each leg its own timer, its own
 * assignment, its own completion.
 */
export const DEFAULT_SERVICE_STAGES: ServiceStage[] = [
  { id: 'ss-full-1', serviceId: 'svc-full', stageOrder: 1, name: 'Exterior Wash', workerCount: 1, baseDuration: 20 },
  { id: 'ss-full-2', serviceId: 'svc-full', stageOrder: 2, name: 'Interior Detail', workerCount: 2, baseDuration: 40 },

  { id: 'ss-deep-1', serviceId: 'svc-deep', stageOrder: 1, name: 'Exterior Wash', workerCount: 1, baseDuration: 25 },
  { id: 'ss-deep-2', serviceId: 'svc-deep', stageOrder: 2, name: 'Interior Detail', workerCount: 2, baseDuration: 50 },

  { id: 'ss-premdetail-1', serviceId: 'svc-premdetail', stageOrder: 1, name: 'Exterior Wash', workerCount: 1, baseDuration: 25 },
  { id: 'ss-premdetail-2', serviceId: 'svc-premdetail', stageOrder: 2, name: 'Interior Detail', workerCount: 2, baseDuration: 65 },
];

export const DEFAULT_WORKER_NAMES = [
  'Ahmed', 'Mohammed', 'Arjun', 'Raj', 'Imran',
  'Sameer', 'Bilal', 'Hassan', 'Rahul', 'Faisal',
];

/**
 * The single place a single-stage duration is decided: an explicit override
 * if one exists, otherwise the service's base duration scaled by the car's
 * size factor. Staged services resolve per-stage via `resolveStages` instead.
 */
export function resolveDuration(
  serviceId: string,
  carTypeId: string,
  services: Service[],
  carTypes: CarType[],
  durations: ServiceDuration[],
): number {
  const override = durations.find(
    (d) => d.serviceId === serviceId && d.carTypeId === carTypeId,
  );
  if (override) return override.duration;

  const service = services.find((s) => s.id === serviceId);
  const carType = carTypes.find((c) => c.id === carTypeId);
  const base = service?.baseDuration ?? 30;
  const factor = carType?.sizeFactor ?? 1;
  return Math.max(5, Math.round(base * factor));
}

export interface ResolvedStage {
  stageOrder: number;
  name: string;
  workerCount: number;
  duration: number;
}

/**
 * The blueprint for a job: one row per stage, in order, with its target
 * duration already resolved for this car type. A service with no configured
 * stages resolves to a single implicit stage covering the whole job — this is
 * what keeps every existing single-worker service working unchanged.
 */
export function resolveStages(
  serviceId: string,
  carTypeId: string,
  services: Service[],
  carTypes: CarType[],
  durations: ServiceDuration[],
  serviceStages: ServiceStage[],
): ResolvedStage[] {
  const configured = serviceStages
    .filter((s) => s.serviceId === serviceId)
    .sort((a, b) => a.stageOrder - b.stageOrder);

  if (configured.length === 0) {
    const service = services.find((s) => s.id === serviceId);
    return [
      {
        stageOrder: 1,
        name: service?.serviceName ?? 'Service',
        workerCount: 1,
        duration: resolveDuration(serviceId, carTypeId, services, carTypes, durations),
      },
    ];
  }

  const carType = carTypes.find((c) => c.id === carTypeId);
  const factor = carType?.sizeFactor ?? 1;
  return configured.map((stage) => ({
    stageOrder: stage.stageOrder,
    name: stage.name,
    workerCount: stage.workerCount,
    duration: Math.max(5, Math.round(stage.baseDuration * factor)),
  }));
}
