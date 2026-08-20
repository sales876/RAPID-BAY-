-- ===========================================================================
-- JRHQ Car Wash — Migration 002d: fix create_job() status type mismatch
--
-- Bug: after 002c dropped the stale NOT NULL constraint, create_job() still
-- failed with:
--   42804 column "status" is of type stage_status but expression is of type text
-- Both branches build job_stages.status from a bare
-- `case when ... then 'in_progress' else 'waiting' end`, which Postgres
-- infers as `text`, not the `stage_status` enum. Cast each branch value.
--
-- Run this on its own (function-replace statements are safe to run alone).
-- ===========================================================================

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
