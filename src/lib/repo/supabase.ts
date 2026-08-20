import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mapCarType,
  mapDuration,
  mapJob,
  mapJobStage,
  mapNotification,
  mapService,
  mapServiceStage,
  mapWorker,
} from '../supabase/mappers';
import type {
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
import type { Repository } from './types';

/**
 * Production repository.
 *
 * Writes go through database functions (`create_job`, `start_stage`,
 * `complete_stage`, …) so duration resolution, the stage sequence, and the
 * fraud-flag check happen in one transaction next to the data. Reads pull
 * jobs and job_stages separately and reassemble them client-side — simpler
 * and cheaper than a nested-JSON query, and the row counts here are small.
 */
export class SupabaseRepository implements Repository {
  readonly mode = 'live' as const;

  constructor(
    private readonly supabase: SupabaseClient,
    /** Days of history to keep in the client snapshot. */
    private readonly historyDays = 60,
  ) {}

  async load(): Promise<OpsSnapshot> {
    const since = new Date();
    since.setDate(since.getDate() - this.historyDays);
    const sinceKey = since.toISOString().slice(0, 10);

    const [jobsRes, workersRes, servicesRes, serviceStagesRes, carTypesRes, durationsRes, notificationsRes] =
      await Promise.all([
        this.supabase.from('jobs').select('*').gte('date', sinceKey).order('arrival_time', { ascending: false }),
        this.supabase.from('workers').select('*').order('name'),
        this.supabase.from('services').select('*').order('sort_order'),
        this.supabase.from('service_stages').select('*').order('stage_order'),
        this.supabase.from('car_types').select('*').order('sort_order'),
        this.supabase.from('service_durations').select('*'),
        this.supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
      ]);

    const firstError =
      jobsRes.error || workersRes.error || servicesRes.error || serviceStagesRes.error ||
      carTypesRes.error || durationsRes.error || notificationsRes.error;
    if (firstError) throw firstError;

    const jobIds = (jobsRes.data ?? []).map((j) => j.id);
    let stageRows: any[] = [];
    if (jobIds.length) {
      // PostgREST caps `.in()` list length in practice around a few hundred
      // safely; batch to stay well under that for large history windows.
      const batches: string[][] = [];
      for (let i = 0; i < jobIds.length; i += 300) batches.push(jobIds.slice(i, i + 300));
      const results = await Promise.all(
        batches.map((ids) =>
          this.supabase.from('job_stages').select('*').in('job_id', ids).order('stage_order'),
        ),
      );
      for (const r of results) {
        if (r.error) throw r.error;
        stageRows.push(...(r.data ?? []));
      }
    }

    const stagesByJob = new Map<string, any[]>();
    for (const row of stageRows) {
      const list = stagesByJob.get(row.job_id) ?? [];
      list.push(row);
      stagesByJob.set(row.job_id, list);
    }

    const jobs: Job[] = (jobsRes.data ?? []).map((row) =>
      mapJob(row, (stagesByJob.get(row.id) ?? []).map(mapJobStage)),
    );

    return {
      jobs,
      workers: (workersRes.data ?? []).map(mapWorker),
      services: (servicesRes.data ?? []).map(mapService),
      serviceStages: (serviceStagesRes.data ?? []).map(mapServiceStage),
      carTypes: (carTypesRes.data ?? []).map(mapCarType),
      durations: (durationsRes.data ?? []).map(mapDuration),
      notifications: (notificationsRes.data ?? []).map(mapNotification),
    };
  }

  subscribe(onChange: () => void): () => void {
    const channel = this.supabase
      .channel('ops-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_stages' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workers' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, onChange)
      .subscribe();

    return () => {
      void this.supabase.removeChannel(channel);
    };
  }

  /** Mirrors the job into Google Sheets. Never blocks the operator. */
  private syncToSheets(jobId: string) {
    if (typeof fetch === 'undefined') return;
    void fetch('/api/sheets/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      /* Sheets is a reporting mirror; a failure there must not stop the floor. */
    });
  }

  private async fetchJob(jobId: string): Promise<Job> {
    const [jobRes, stagesRes] = await Promise.all([
      this.supabase.from('jobs').select('*').eq('id', jobId).single(),
      this.supabase.from('job_stages').select('*').eq('job_id', jobId).order('stage_order'),
    ]);
    if (jobRes.error) throw jobRes.error;
    if (stagesRes.error) throw stagesRes.error;
    const job = mapJob(jobRes.data, (stagesRes.data ?? []).map(mapJobStage));
    this.syncToSheets(job.id);
    return job;
  }

  async createJob(input: NewJobInput): Promise<Job> {
    const { data, error } = await this.supabase.rpc('create_job', {
      p_customer_name: input.customerName.trim(),
      p_phone: input.phone.trim(),
      p_plate_number: input.plateNumber.trim().toUpperCase(),
      p_car_type: input.carType,
      p_service_id: input.serviceId,
      p_worker_ids: input.workerIds,
      p_payment_status: input.paymentStatus,
      p_start_now: input.startNow && input.workerIds.length > 0,
      p_notes: input.notes?.trim() || null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return this.fetchJob(row.id);
  }

  async assignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job> {
    const { error } = await this.supabase.rpc('assign_stage', {
      p_job_id: jobId,
      p_stage_order: stageOrder,
      p_worker_ids: workerIds,
    });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async acceptStage(jobId: string, stageOrder: number, _workerId: string): Promise<Job> {
    const { error } = await this.supabase.rpc('accept_stage', {
      p_job_id: jobId,
      p_stage_order: stageOrder,
    });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async startStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job> {
    const { error } = await this.supabase.rpc('start_stage', {
      p_job_id: jobId,
      p_stage_order: stageOrder,
      p_worker_ids: workerIds,
    });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async completeStage(
    jobId: string,
    stageOrder: number,
    completedByWorkerId: string,
    photoUrl: string | null = null,
  ): Promise<Job> {
    const { error } = await this.supabase.rpc('complete_stage', {
      p_job_id: jobId,
      p_stage_order: stageOrder,
      p_completed_by: completedByWorkerId,
      p_photo_url: photoUrl,
    });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async reassignStage(jobId: string, stageOrder: number, workerIds: string[]): Promise<Job> {
    const { error } = await this.supabase.rpc('reassign_stage', {
      p_job_id: jobId,
      p_stage_order: stageOrder,
      p_worker_ids: workerIds,
    });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async cancelJob(jobId: string): Promise<Job> {
    const { error } = await this.supabase
      .from('jobs')
      .update({ status: 'cancelled' })
      .eq('id', jobId);
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async updatePayment(jobId: string, paymentStatus: PaymentStatus): Promise<Job> {
    const { error } = await this.supabase
      .from('jobs')
      .update({ payment_status: paymentStatus })
      .eq('id', jobId);
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async confirmHandover(jobId: string): Promise<Job> {
    const { error } = await this.supabase.rpc('confirm_handover', { p_job_id: jobId });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async clearFlag(jobId: string, stageOrder: number): Promise<Job> {
    const { error } = await this.supabase.rpc('clear_flag', {
      p_job_id: jobId,
      p_stage_order: stageOrder,
    });
    if (error) throw error;
    return this.fetchJob(jobId);
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    const { error } = await this.supabase.rpc('mark_notification_read', {
      p_notification_id: notificationId,
    });
    if (error) throw error;
  }

  async setWorkerStatus(workerId: string, status: WorkerBaseStatus): Promise<Worker> {
    const { data, error } = await this.supabase
      .from('workers')
      .update({ status })
      .eq('id', workerId)
      .select('*')
      .single();
    if (error) throw error;
    return mapWorker(data);
  }

  async saveWorker(input: Partial<Worker> & { name: string }): Promise<Worker> {
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      phone: input.phone ?? null,
      status: input.status ?? 'available',
      active: input.active ?? true,
    };
    const { data, error } = await this.supabase
      .from('workers')
      .upsert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return mapWorker(data);
  }

  async removeWorker(workerId: string): Promise<void> {
    const { error } = await this.supabase
      .from('workers')
      .update({ active: false })
      .eq('id', workerId);
    if (error) throw error;
  }

  async saveService(input: Partial<Service> & { serviceName: string }): Promise<Service> {
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      service_name: input.serviceName,
      base_duration: input.baseDuration ?? 30,
      price: input.price ?? 0,
      sort_order: input.sortOrder ?? 99,
      active: input.active ?? true,
    };
    const { data, error } = await this.supabase
      .from('services')
      .upsert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return mapService(data);
  }

  async removeService(serviceId: string): Promise<void> {
    const { error } = await this.supabase
      .from('services')
      .update({ active: false })
      .eq('id', serviceId);
    if (error) throw error;
  }

  async saveCarType(carType: CarType): Promise<CarType> {
    const { data, error } = await this.supabase
      .from('car_types')
      .upsert({
        id: carType.id,
        label: carType.label,
        size_factor: carType.sizeFactor,
        sort_order: carType.sortOrder,
        active: carType.active,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapCarType(data);
  }

  async setDuration(serviceId: string, carTypeId: string, minutes: number | null): Promise<void> {
    if (minutes === null) {
      const { error } = await this.supabase
        .from('service_durations')
        .delete()
        .eq('service_id', serviceId)
        .eq('car_type_id', carTypeId);
      if (error) throw error;
      return;
    }
    const { error } = await this.supabase
      .from('service_durations')
      .upsert(
        { service_id: serviceId, car_type_id: carTypeId, duration: minutes },
        { onConflict: 'service_id,car_type_id' },
      );
    if (error) throw error;
  }

  async saveServiceStage(stage: ServiceStage): Promise<ServiceStage> {
    const payload = {
      ...(stage.id && !stage.id.startsWith('new-') ? { id: stage.id } : {}),
      service_id: stage.serviceId,
      stage_order: stage.stageOrder,
      name: stage.name,
      worker_count: stage.workerCount,
      base_duration: stage.baseDuration,
    };
    const { data, error } = await this.supabase
      .from('service_stages')
      .upsert(payload, { onConflict: 'service_id,stage_order' })
      .select('*')
      .single();
    if (error) throw error;
    return mapServiceStage(data);
  }

  async removeServiceStage(stageId: string): Promise<void> {
    const { error } = await this.supabase.from('service_stages').delete().eq('id', stageId);
    if (error) throw error;
  }
}
