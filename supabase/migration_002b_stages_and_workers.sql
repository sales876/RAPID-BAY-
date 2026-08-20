-- ===========================================================================
-- JRHQ Car Wash — Migration 002b: multi-stage jobs + staff portal
--
-- Run migration_002a_add_worker_role.sql FIRST, as its own separate query
-- execution, and let it finish. Then run this file as a second execution.
-- Running both in one paste fails with "unsafe use of new value" — Postgres
-- won't let a brand-new enum value be referenced in the same transaction
-- that created it.
--
-- This file is additive: no existing table is dropped, no existing row is
-- deleted.
--
-- What this adds:
--   - `service_stages`: the admin-configured legs of a service (e.g. a
--     two-step "wash then detail" service)
--   - `job_stages`: the actual legs of one job in flight — each with its own
--     worker(s), clock, completion, and fraud flag
--   - `profiles.worker_id`, linking a "worker" login to its floor identity
--   - Old single-worker job columns are left in place (unused going forward)
--     so nothing about your existing data is destroyed. They can be dropped
--     in a later cleanup migration once you've confirmed nothing reads them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Stage status
-- ---------------------------------------------------------------------------
do $enum$ begin
  create type stage_status as enum ('waiting', 'in_progress', 'completed');
exception when duplicate_object then null; end $enum$;

-- A worker's login links to their operational identity in `workers`.
alter table profiles add column if not exists worker_id uuid references workers(id) on delete set null;

-- Informational — true once a `workers` row has a matching auth login.
alter table workers add column if not exists has_account boolean not null default false;

-- Independent of any single worker's completion claim: reception/admin
-- confirms the car was physically handed back to the customer.
alter table jobs add column if not exists handover_confirmed boolean not null default false;

-- ---------------------------------------------------------------------------
-- Service stages — the admin-configured blueprint for a service.
-- A service with no rows here is a single implicit stage (today's behaviour,
-- unchanged). A service with two rows is the Sharjah pattern: one worker
-- washes the exterior, then two workers detail the interior — each leg its
-- own target duration and its own required worker count.
-- ---------------------------------------------------------------------------
create table if not exists service_stages (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references services(id) on delete cascade,
  stage_order   int not null,
  name          text not null,
  worker_count  int not null default 1,
  base_duration int not null,
  unique (service_id, stage_order)
);

alter table service_stages enable row level security;
drop policy if exists staff_read on service_stages;
create policy staff_read on service_stages for select using (is_staff());
drop policy if exists admin_write on service_stages;
create policy admin_write on service_stages for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Job stages — the actual legs of one job in flight.
-- ---------------------------------------------------------------------------
create table if not exists job_stages (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references jobs(id) on delete cascade,
  stage_order               int not null,
  name                      text not null,
  worker_count              int not null default 1,
  worker_ids                uuid[] not null default '{}',
  worker_names              text[] not null default '{}',
  status                    stage_status not null default 'waiting',
  start_time                timestamptz,
  expected_completion_time  timestamptz,
  completion_time           timestamptz,
  expected_duration         int not null,
  actual_duration           int,
  completed_by              uuid references workers(id),
  photo_url                 text,
  flagged                   boolean not null default false,
  flag_reason               text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (job_id, stage_order)
);
create index if not exists job_stages_job_idx on job_stages (job_id);
create index if not exists job_stages_worker_ids_idx on job_stages using gin (worker_ids);
create index if not exists job_stages_status_idx on job_stages (status);

drop trigger if exists job_stages_touch_updated_at on job_stages;
create trigger job_stages_touch_updated_at before update on job_stages
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill: give every existing job a single stage 1 row built from its old
-- single-worker columns, so nothing already in flight or in history loses
-- its data. Safe to run more than once — skips jobs that already have stages.
-- ---------------------------------------------------------------------------
insert into job_stages (
  job_id, stage_order, name, worker_count, worker_ids, worker_names,
  status, start_time, expected_completion_time, completion_time,
  expected_duration, actual_duration, completed_by
)
select
  j.id, 1, j.service_name, 1,
  case when j.worker_id is not null then array[j.worker_id] else '{}' end,
  case when j.worker_name is not null and j.worker_name <> '' then array[j.worker_name] else '{}' end,
  case j.status
    when 'waiting' then 'waiting'
    when 'in_progress' then 'in_progress'
    when 'completed' then 'completed'
    else 'waiting'
  end::stage_status,
  j.start_time, j.expected_completion_time, j.completion_time,
  j.expected_duration, j.actual_duration,
  case when j.status = 'completed' then j.worker_id else null end
from jobs j
where not exists (select 1 from job_stages js where js.job_id = j.id)
  and j.status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Row level security for job_stages
-- ---------------------------------------------------------------------------
alter table job_stages enable row level security;

create or replace function is_worker() returns boolean as $fn$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'worker');
$fn$ language sql stable security definer;

create or replace function my_worker_id() returns uuid as $fn$
  select worker_id from profiles where id = auth.uid();
$fn$ language sql stable security definer;

-- Admins and receptionists see everything (matches the existing jobs policy).
drop policy if exists staff_read on job_stages;
create policy staff_read on job_stages for select using (
  is_staff() and not is_worker()
);

-- Workers see only stages they are assigned to.
drop policy if exists worker_read_own on job_stages;
create policy worker_read_own on job_stages for select using (
  is_worker() and my_worker_id() = any(worker_ids)
);

-- Admins/receptionists can write any stage (assignment, reassignment).
drop policy if exists staff_write on job_stages;
create policy staff_write on job_stages for all using (
  is_staff() and not is_worker()
) with check (
  is_staff() and not is_worker()
);

-- Workers may only update a stage they are on (to mark it complete) — never
-- insert or delete, and never touch a stage they are not assigned to.
drop policy if exists worker_update_own on job_stages;
create policy worker_update_own on job_stages for update using (
  is_worker() and my_worker_id() = any(worker_ids)
) with check (
  is_worker() and my_worker_id() = any(worker_ids)
);

-- Workers may read the parent job for a stage they're on (customer/plate
-- context) but not the full unrestricted staff view of every job.
drop policy if exists worker_read_own_jobs on jobs;
create policy worker_read_own_jobs on jobs for select using (
  is_worker() and exists (
    select 1 from job_stages js
    where js.job_id = jobs.id and my_worker_id() = any(js.worker_ids)
  )
);

-- ---------------------------------------------------------------------------
-- create_job — rewritten to build the full stage sequence for the chosen
-- service at once. Duration per stage is resolved server-side from
-- service_stages (if the service has explicit legs) or falls back to the
-- single-stage resolve_duration() already in place.
-- ---------------------------------------------------------------------------
drop function if exists create_job(text, text, text, text, uuid, uuid, payment_status, boolean, text, uuid);

create or replace function create_job(
  p_customer_name  text,
  p_phone          text,
  p_plate_number   text,
  p_car_type       text,
  p_service_id     uuid,
  p_worker_ids     uuid[] default '{}',
  p_payment_status payment_status default 'unpaid',
  p_start_now      boolean default true,
  p_notes          text default null,
  p_branch_id      uuid default null
) returns jobs as $fn$
declare
  v_customer   customers%rowtype;
  v_vehicle    vehicles%rowtype;
  v_service    services%rowtype;
  v_branch     uuid;
  v_tz         text;
  v_now        timestamptz := now();
  v_job        jobs%rowtype;
  v_stage      record;
  v_start_now  boolean;
  v_worker_names text[];
  v_first      boolean := true;
begin
  v_branch := coalesce(p_branch_id, (select id from branches where active order by created_at limit 1));
  v_tz     := coalesce((select timezone from branches where id = v_branch), 'Asia/Dubai');

  select * into v_service from services where id = p_service_id;
  if not found then
    raise exception 'Unknown service %', p_service_id;
  end if;

  if p_phone <> '' then
    select * into v_customer from customers where phone = p_phone limit 1;
  end if;
  if v_customer.id is null then
    insert into customers (branch_id, name, phone)
    values (v_branch, p_customer_name, p_phone)
    returning * into v_customer;
  end if;

  select * into v_vehicle from vehicles
   where upper(plate_number) = upper(p_plate_number) limit 1;
  if v_vehicle.id is null then
    insert into vehicles (customer_id, plate_number, car_type)
    values (v_customer.id, upper(p_plate_number), p_car_type)
    returning * into v_vehicle;
  else
    update vehicles set car_type = p_car_type, customer_id = v_customer.id
     where id = v_vehicle.id;
  end if;

  v_start_now := p_start_now and array_length(p_worker_ids, 1) > 0;

  select coalesce(array_agg(w.name order by w.id), '{}')
    into v_worker_names
    from unnest(p_worker_ids) as wid
    join workers w on w.id = wid;

  insert into jobs (
    branch_id, customer_id, vehicle_id, service_id,
    customer_name, phone, plate_number, car_type, service_name, price,
    date, arrival_time, payment_status, status, notes
  ) values (
    v_branch, v_customer.id, v_vehicle.id, p_service_id,
    p_customer_name, p_phone, upper(p_plate_number), p_car_type,
    v_service.service_name, v_service.price,
    (v_now at time zone v_tz)::date, v_now, p_payment_status,
    case when v_start_now then 'in_progress'::job_status else 'waiting'::job_status end,
    p_notes
  ) returning * into v_job;

  -- Build the stage sequence: explicit service_stages if configured,
  -- otherwise a single implicit stage covering the whole service.
  for v_stage in
    select stage_order, name, worker_count,
           greatest(5, round(base_duration * coalesce(
             (select size_factor from car_types where id = p_car_type), 1
           ))::int) as duration
      from service_stages
     where service_id = p_service_id
     order by stage_order
  loop
    insert into job_stages (
      job_id, stage_order, name, worker_count, worker_ids, worker_names,
      status, start_time, expected_completion_time, expected_duration
    ) values (
      v_job.id, v_stage.stage_order, v_stage.name, v_stage.worker_count,
      case when v_first then p_worker_ids else '{}' end,
      case when v_first then v_worker_names else '{}' end,
      case when v_first and v_start_now then 'in_progress'::stage_status else 'waiting'::stage_status end,
      case when v_first and v_start_now then v_now else null end,
      case when v_first and v_start_now then v_now + make_interval(mins => v_stage.duration) else null end,
      v_stage.duration
    );
    v_first := false;
  end loop;

  -- No explicit stages configured: one implicit stage for the whole service.
  if not found then
    insert into job_stages (
      job_id, stage_order, name, worker_count, worker_ids, worker_names,
      status, start_time, expected_completion_time, expected_duration
    ) values (
      v_job.id, 1, v_service.service_name, 1, p_worker_ids, v_worker_names,
      case when v_start_now then 'in_progress'::stage_status else 'waiting'::stage_status end,
      case when v_start_now then v_now else null end,
      case when v_start_now then v_now + make_interval(mins => resolve_duration(p_service_id, p_car_type)) else null end,
      resolve_duration(p_service_id, p_car_type)
    );
  end if;

  return v_job;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- start_stage — assign worker(s) and start the clock for a waiting stage.
-- ---------------------------------------------------------------------------
create or replace function start_stage(
  p_job_id uuid,
  p_stage_order int,
  p_worker_ids uuid[]
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_now timestamptz := now();
  v_worker_names text[];
begin
  if array_length(p_worker_ids, 1) is null then
    raise exception 'Assign at least one worker before starting this stage.';
  end if;

  select coalesce(array_agg(w.name order by w.id), '{}')
    into v_worker_names
    from unnest(p_worker_ids) as wid
    join workers w on w.id = wid;

  update job_stages set
    worker_ids = p_worker_ids,
    worker_names = v_worker_names,
    start_time = v_now,
    expected_completion_time = v_now + make_interval(mins => expected_duration),
    status = 'in_progress'
  where job_id = p_job_id and stage_order = p_stage_order
  returning * into v_stage;

  if v_stage.id is null then
    raise exception 'Unknown stage % for job %', p_stage_order, p_job_id;
  end if;

  update jobs set status = 'in_progress' where id = p_job_id;

  return v_stage;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- complete_stage — stop the clock, measure it, auto-flag implausibly fast
-- completions, and roll the parent job to 'completed' once every stage is done.
-- ---------------------------------------------------------------------------
create or replace function complete_stage(
  p_job_id uuid,
  p_stage_order int,
  p_completed_by uuid,
  p_photo_url text default null
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_now timestamptz := now();
  v_actual int;
  v_all_done boolean;
begin
  select * into v_stage from job_stages where job_id = p_job_id and stage_order = p_stage_order;
  if v_stage.id is null then
    raise exception 'Unknown stage % for job %', p_stage_order, p_job_id;
  end if;

  v_actual := greatest(1, round(extract(epoch from (v_now - coalesce(v_stage.start_time, v_now))) / 60)::int);

  update job_stages set
    completion_time = v_now,
    actual_duration = v_actual,
    status = 'completed',
    completed_by = p_completed_by,
    photo_url = p_photo_url,
    flagged = v_actual < expected_duration * 0.5,
    flag_reason = case when v_actual < expected_duration * 0.5
      then format('Completed in %s min against a %s min target — under 50%% of target.', v_actual, expected_duration)
      else null
    end
  where job_id = p_job_id and stage_order = p_stage_order
  returning * into v_stage;

  select bool_and(status = 'completed') into v_all_done from job_stages where job_id = p_job_id;

  update jobs set status = case when v_all_done then 'completed'::job_status else 'in_progress'::job_status end
   where id = p_job_id;

  return v_stage;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- reassign_stage — swap who's on a stage without touching its clock.
-- ---------------------------------------------------------------------------
create or replace function reassign_stage(
  p_job_id uuid,
  p_stage_order int,
  p_worker_ids uuid[]
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_worker_names text[];
begin
  select coalesce(array_agg(w.name order by w.id), '{}')
    into v_worker_names
    from unnest(p_worker_ids) as wid
    join workers w on w.id = wid;

  update job_stages set worker_ids = p_worker_ids, worker_names = v_worker_names
   where job_id = p_job_id and stage_order = p_stage_order
   returning * into v_stage;

  if v_stage.id is null then
    raise exception 'Unknown stage % for job %', p_stage_order, p_job_id;
  end if;

  return v_stage;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- Worker self-service: a worker may only complete a stage they are on. The
-- functions above run as the caller (not security definer), so normal RLS
-- on job_stages already enforces this — but complete_stage still needs to
-- run with elevated rights to update the parent `jobs` row, which a worker
-- cannot write directly. Wrap it so a worker can call it safely.
-- ---------------------------------------------------------------------------
create or replace function worker_complete_stage(
  p_job_id uuid,
  p_stage_order int,
  p_photo_url text default null
) returns job_stages as $fn$
declare
  v_worker_id uuid := my_worker_id();
  v_stage job_stages%rowtype;
begin
  if v_worker_id is null then
    raise exception 'This account is not linked to a worker.';
  end if;

  select * into v_stage from job_stages
   where job_id = p_job_id and stage_order = p_stage_order and v_worker_id = any(worker_ids);

  if v_stage.id is null then
    raise exception 'You are not assigned to this stage.';
  end if;

  return complete_stage(p_job_id, p_stage_order, v_worker_id, p_photo_url);
end $fn$ language plpgsql volatile security definer;

grant execute on function worker_complete_stage(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_handover / clear_flag — small admin/reception actions.
-- ---------------------------------------------------------------------------
create or replace function confirm_handover(p_job_id uuid) returns jobs as $fn$
  update jobs set handover_confirmed = true where id = p_job_id returning *;
$fn$ language sql volatile;

create or replace function clear_flag(p_job_id uuid, p_stage_order int) returns job_stages as $fn$
  update job_stages set flagged = false
   where job_id = p_job_id and stage_order = p_stage_order
   returning *;
$fn$ language sql volatile;

-- ---------------------------------------------------------------------------
-- Realtime for the new table
-- ---------------------------------------------------------------------------
do $rt$ begin
  alter publication supabase_realtime add table job_stages;
exception when duplicate_object then null; end $rt$;

do $rt$ begin
  alter publication supabase_realtime add table service_stages;
exception when duplicate_object then null; end $rt$;
