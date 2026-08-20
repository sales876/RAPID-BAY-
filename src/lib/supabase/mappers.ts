import type { AppNotification, CarType, Job, JobStage, Service, ServiceDuration, ServiceStage, Worker } from '../types';

/** Row shapes as returned by PostgREST (snake_case), mapped to domain types. */

export function mapJobStage(row: any): JobStage {
  return {
    id: row.id,
    jobId: row.job_id,
    stageOrder: Number(row.stage_order),
    name: row.name,
    workerCount: Number(row.worker_count ?? 1),
    workerIds: row.worker_ids ?? [],
    workerNames: row.worker_names ?? [],
    status: row.status,
    assignedAt: row.assigned_at,
    startTime: row.start_time,
    expectedCompletionTime: row.expected_completion_time,
    completionTime: row.completion_time,
    expectedDuration: Number(row.expected_duration ?? 0),
    actualDuration: row.actual_duration === null ? null : Number(row.actual_duration),
    completedBy: row.completed_by,
    photoUrl: row.photo_url,
    flagged: Boolean(row.flagged),
    flagReason: row.flag_reason,
  };
}

/** `stages` must already be filtered to this job and sorted by stage_order. */
export function mapJob(row: any, stages: JobStage[] = []): Job {
  return {
    id: row.id,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    serviceId: row.service_id,
    customerName: row.customer_name ?? '',
    phone: row.phone ?? '',
    plateNumber: row.plate_number ?? '',
    carType: row.car_type ?? '',
    serviceName: row.service_name ?? '',
    price: Number(row.price ?? 0),
    date: row.date,
    arrivalTime: row.arrival_time,
    status: row.status,
    paymentStatus: row.payment_status,
    handoverConfirmed: Boolean(row.handover_confirmed),
    stages,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export function mapWorker(row: any): Worker {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    status: row.status,
    active: row.active,
    hasAccount: Boolean(row.has_account),
  };
}

export function mapService(row: any): Service {
  return {
    id: row.id,
    serviceName: row.service_name,
    baseDuration: Number(row.base_duration),
    price: Number(row.price ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
    active: row.active,
  };
}

export function mapServiceStage(row: any): ServiceStage {
  return {
    id: row.id,
    serviceId: row.service_id,
    stageOrder: Number(row.stage_order),
    name: row.name,
    workerCount: Number(row.worker_count ?? 1),
    baseDuration: Number(row.base_duration),
  };
}

export function mapCarType(row: any): CarType {
  return {
    id: row.id,
    label: row.label,
    sizeFactor: Number(row.size_factor ?? 1),
    sortOrder: Number(row.sort_order ?? 0),
    active: row.active,
  };
}

export function mapNotification(row: any): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    audience: row.audience,
    workerId: row.worker_id,
    jobId: row.job_id,
    stageOrder: Number(row.stage_order),
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export function mapDuration(row: any): ServiceDuration {
  return {
    id: row.id,
    serviceId: row.service_id,
    carTypeId: row.car_type_id,
    duration: Number(row.duration),
  };
}
