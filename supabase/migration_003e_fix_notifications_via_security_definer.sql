-- ===========================================================================
-- JRHQ Car Wash — Migration 003e: real fix for the notifications insert
--
-- Diagnosis: staff_insert's WITH CHECK evaluated correctly as a standalone
-- RPC call, and its metadata in pg_policies was exactly right — even a bare
-- `with check (true)` still got rejected, while disabling RLS on the table
-- entirely let the insert through immediately. That isolates the problem to
-- RLS enforcement on this table specifically misbehaving for invoker-context
-- inserts, for reasons not resolved (possibly a Supabase/PostgREST-side
-- caching quirk on this project). Rather than keep chasing that, this uses
-- the exact pattern already proven to work elsewhere in this schema
-- (accept_stage, worker_complete_stage): a narrow SECURITY DEFINER function
-- that owns its own permission check and bypasses RLS via ownership, instead
-- of depending on an INSERT policy.
--
-- Run this on its own.
-- ===========================================================================

alter table notifications enable row level security;

create or replace function create_notification(
  p_kind notification_kind,
  p_audience notification_audience,
  p_worker_id uuid,
  p_job_id uuid,
  p_stage_order int,
  p_title text,
  p_body text
) returns void as $fn$
begin
  -- Mirrors the intent of the old staff_insert policy: only an active
  -- profile may create a notification, and only actual staff (admin or
  -- receptionist — is_staff() is misleadingly named "any active profile" in
  -- this schema) may notify a worker. Any active profile (staff or the
  -- worker themself, via worker_complete_stage) may notify staff.
  if not is_staff() then
    raise exception 'Not signed in as an active profile.';
  end if;
  if p_audience = 'worker' and is_worker() then
    raise exception 'Only admin/reception can notify a worker.';
  end if;

  insert into notifications (kind, audience, worker_id, job_id, stage_order, title, body)
  values (p_kind, p_audience, p_worker_id, p_job_id, p_stage_order, p_title, p_body);
end $fn$ language plpgsql volatile security definer;

grant execute on function create_notification(notification_kind, notification_audience, uuid, uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Swap every direct `insert into notifications (...)` for a call to the
-- function above. Everything else in these functions is unchanged from
-- migration_003b.
-- ---------------------------------------------------------------------------

create or replace function assign_stage(
  p_job_id uuid,
  p_stage_order int,
  p_worker_ids uuid[]
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_job   jobs%rowtype;
  v_now   timestamptz := now();
  v_worker_names text[];
  v_worker_id uuid;
begin
  if array_length(p_worker_ids, 1) is null then
    raise exception 'Assign at least one worker before handing off this stage.';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'Unknown job %', p_job_id;
  end if;

  select coalesce(array_agg(w.name order by w.id), '{}')
    into v_worker_names
    from unnest(p_worker_ids) as wid
    join workers w on w.id = wid;

  update job_stages set
    worker_ids = p_worker_ids,
    worker_names = v_worker_names,
    status = 'assigned'::stage_status,
    assigned_at = v_now,
    start_time = null,
    expected_completion_time = null
  where job_id = p_job_id and stage_order = p_stage_order
  returning * into v_stage;

  if v_stage.id is null then
    raise exception 'Unknown stage % for job %', p_stage_order, p_job_id;
  end if;

  foreach v_worker_id in array p_worker_ids loop
    perform create_notification(
      'stage_assigned', 'worker', v_worker_id, p_job_id, p_stage_order,
      format('New job: %s', v_job.plate_number),
      format('%s · %s — tap Accept to start the timer.', v_stage.name, v_job.service_name)
    );
  end loop;

  return v_stage;
end $fn$ language plpgsql volatile;

create or replace function reassign_stage(
  p_job_id uuid,
  p_stage_order int,
  p_worker_ids uuid[]
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_job   jobs%rowtype;
  v_worker_names text[];
  v_worker_id uuid;
  v_now timestamptz := now();
begin
  select * into v_stage from job_stages where job_id = p_job_id and stage_order = p_stage_order;
  if v_stage.id is null then
    raise exception 'Unknown stage % for job %', p_stage_order, p_job_id;
  end if;

  select coalesce(array_agg(w.name order by w.id), '{}')
    into v_worker_names
    from unnest(p_worker_ids) as wid
    join workers w on w.id = wid;

  if v_stage.status = 'assigned' then
    update job_stages set worker_ids = p_worker_ids, worker_names = v_worker_names, assigned_at = v_now
     where job_id = p_job_id and stage_order = p_stage_order
     returning * into v_stage;

    select * into v_job from jobs where id = p_job_id;
    foreach v_worker_id in array p_worker_ids loop
      perform create_notification(
        'stage_assigned', 'worker', v_worker_id, p_job_id, p_stage_order,
        format('New job: %s', v_job.plate_number),
        format('%s — tap Accept to start the timer.', v_stage.name)
      );
    end loop;
  else
    update job_stages set worker_ids = p_worker_ids, worker_names = v_worker_names
     where job_id = p_job_id and stage_order = p_stage_order
     returning * into v_stage;
  end if;

  return v_stage;
end $fn$ language plpgsql volatile;

create or replace function complete_stage(
  p_job_id uuid,
  p_stage_order int,
  p_completed_by uuid,
  p_photo_url text default null
) returns job_stages as $fn$
declare
  v_stage job_stages%rowtype;
  v_job   jobs%rowtype;
  v_worker_name text;
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
   where id = p_job_id
   returning * into v_job;

  select name into v_worker_name from workers where id = p_completed_by;

  perform create_notification(
    'stage_completed', 'staff', null, p_job_id, p_stage_order,
    format('%s finished %s', coalesce(v_worker_name, 'A worker'), v_stage.name),
    format('%s · %s min (target %s min)%s',
      v_job.plate_number, v_actual, v_stage.expected_duration,
      case when v_stage.flagged then ' — flagged for review' else '' end)
  );

  return v_stage;
end $fn$ language plpgsql volatile;

grant execute on function complete_stage(uuid, int, uuid, text) to authenticated;

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
  v_assign_now boolean;
  v_worker_names text[];
  v_first      boolean := true;
  v_stage1_id  int;
  v_worker_id  uuid;
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

  v_assign_now := p_start_now and array_length(p_worker_ids, 1) > 0;

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
    'waiting'::job_status,
    p_notes
  ) returning * into v_job;

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
      status, assigned_at, expected_duration
    ) values (
      v_job.id, v_stage.stage_order, v_stage.name, v_stage.worker_count,
      case when v_first then p_worker_ids else '{}' end,
      case when v_first then v_worker_names else '{}' end,
      case when v_first and v_assign_now then 'assigned'::stage_status else 'waiting'::stage_status end,
      case when v_first and v_assign_now then v_now else null end,
      v_stage.duration
    );
    if v_first and v_assign_now then v_stage1_id := v_stage.stage_order; end if;
    v_first := false;
  end loop;

  if not found then
    insert into job_stages (
      job_id, stage_order, name, worker_count, worker_ids, worker_names,
      status, assigned_at, expected_duration
    ) values (
      v_job.id, 1, v_service.service_name, 1, p_worker_ids, v_worker_names,
      case when v_assign_now then 'assigned'::stage_status else 'waiting'::stage_status end,
      case when v_assign_now then v_now else null end,
      resolve_duration(p_service_id, p_car_type)
    );
    if v_assign_now then v_stage1_id := 1; end if;
  end if;

  if v_assign_now then
    foreach v_worker_id in array p_worker_ids loop
      perform create_notification(
        'stage_assigned', 'worker', v_worker_id, v_job.id, v_stage1_id,
        format('New job: %s', v_job.plate_number),
        format('%s — tap Accept to start the timer.', v_service.service_name)
      );
    end loop;
  end if;

  return v_job;
end $fn$ language plpgsql volatile;
