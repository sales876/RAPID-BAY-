-- ===========================================================================
-- JRHQ Car Wash — Migration 003b: assign/accept workflow + notifications
--
-- Run migration_003a FIRST, as its own execution. Then run this file.
--
-- New job stage lifecycle:
--   waiting -> assigned -> in_progress -> completed
--                  |
--                  admin can still force-start or reassign at any point
--
-- 1. Reception/admin picks a worker -> assign_stage(): stage goes to
--    'assigned', a notification is created for that worker. No clock yet.
-- 2. The worker sees it on /staff and taps Accept -> accept_stage(): stage
--    goes to 'in_progress', the clock starts NOW (not when it was assigned).
-- 3. Worker taps Complete (unchanged) -> complete_stage(): stage finishes,
--    and now also creates a notification for staff ("Ahmed finished the
--    Exterior Wash on DUBAI A 12345 in 18 min").
-- 4. If a worker never accepts, admin can still fall back to the existing
--    start_stage() (force-start, bypasses acceptance) or reassign_stage().
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- job_stages: track when a stage was handed to a worker, separate from when
-- they actually accepted it (start_time already covers "accepted").
-- ---------------------------------------------------------------------------
alter table job_stages add column if not exists assigned_at timestamptz;

-- ---------------------------------------------------------------------------
-- Notifications — one row per alert. `audience` decides who can see it:
-- 'worker' rows are for the named worker only; 'staff' rows are for
-- admins/receptionists. Realtime delivers these the instant they're
-- inserted; a service worker delivers a push copy on top (see push_subscriptions).
-- ---------------------------------------------------------------------------
do $enum$ begin
  create type notification_audience as enum ('worker', 'staff');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type notification_kind as enum ('stage_assigned', 'stage_completed');
exception when duplicate_object then null; end $enum$;

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  kind         notification_kind not null,
  audience     notification_audience not null,
  worker_id    uuid references workers(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  stage_order  int not null,
  title        text not null,
  body         text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index if not exists notifications_worker_idx on notifications (worker_id, created_at desc);
create index if not exists notifications_audience_idx on notifications (audience, created_at desc);

alter table notifications enable row level security;

drop policy if exists worker_read_own on notifications;
create policy worker_read_own on notifications for select using (
  audience = 'worker' and is_worker() and my_worker_id() = worker_id
);

drop policy if exists worker_mark_own_read on notifications;
create policy worker_mark_own_read on notifications for update using (
  audience = 'worker' and is_worker() and my_worker_id() = worker_id
) with check (
  audience = 'worker' and is_worker() and my_worker_id() = worker_id
);

drop policy if exists staff_read on notifications;
create policy staff_read on notifications for select using (
  audience = 'staff' and is_staff() and not is_worker()
);

-- assign_stage / reassign_stage / create_job / complete_stage run as the
-- calling role (not security definer) when invoked by an admin/receptionist
-- directly, so their `insert into notifications` needs a policy of its own.
-- worker_complete_stage's nested complete_stage() call is exempt from RLS
-- already (it runs as the function owner via SECURITY DEFINER), so this
-- policy only needs to cover the staff-invoked path.
drop policy if exists staff_insert on notifications;
create policy staff_insert on notifications for insert with check (
  is_staff() and not is_worker()
);

drop policy if exists staff_mark_read on notifications;
create policy staff_mark_read on notifications for update using (
  audience = 'staff' and is_staff() and not is_worker()
) with check (
  audience = 'staff' and is_staff() and not is_worker()
);

do $rt$ begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null; end $rt$;

-- ---------------------------------------------------------------------------
-- Web push subscriptions — one row per browser/device a person has enabled
-- notifications on. Only the owner can see/manage their own rows directly;
-- looking up *someone else's* endpoints (to actually send a push) goes
-- through get_push_targets() below, which checks role instead of ownership.
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx on push_subscriptions (profile_id);

alter table push_subscriptions enable row level security;

drop policy if exists own_subscriptions on push_subscriptions;
create policy own_subscriptions on push_subscriptions for all using (
  profile_id = auth.uid()
) with check (
  profile_id = auth.uid()
);

-- Looks up push endpoints for a target audience. Runs as the definer so a
-- caller can reach subscriptions they don't own — but only for the two
-- legitimate directions: staff notifying one worker, or a worker/staff
-- notifying staff. Never returns another worker's endpoints to a worker.
create or replace function get_push_targets(p_audience notification_audience, p_worker_id uuid default null)
returns table (endpoint text, p256dh text, auth text) as $fn$
begin
  -- is_staff() means "any active profile" in this schema (workers included) —
  -- the real admin/receptionist check is is_staff() AND NOT is_worker(),
  -- same pattern used by every other staff-only RLS policy in this project.
  if p_audience = 'worker' then
    if not (is_staff() and not is_worker()) then
      raise exception 'Only admin/reception can notify a worker.';
    end if;
    return query
      select ps.endpoint, ps.p256dh, ps.auth
      from push_subscriptions ps
      join profiles pr on pr.id = ps.profile_id
      where pr.worker_id = p_worker_id;
  else
    if not is_staff() then
      raise exception 'Only staff can be notified this way.';
    end if;
    return query
      select ps.endpoint, ps.p256dh, ps.auth
      from push_subscriptions ps
      join profiles pr on pr.id = ps.profile_id
      where pr.role in ('admin', 'receptionist') and pr.active;
  end if;
end $fn$ language plpgsql stable security definer;

grant execute on function get_push_targets(notification_audience, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_notification_read
-- ---------------------------------------------------------------------------
create or replace function mark_notification_read(p_notification_id uuid) returns notifications as $fn$
  update notifications set read_at = now() where id = p_notification_id returning *;
$fn$ language sql volatile;

-- ---------------------------------------------------------------------------
-- assign_stage — hand a stage to worker(s) without starting the clock. Fires
-- a notification per worker. Distinct from start_stage (unchanged below),
-- which remains the admin's force-start / bypass-acceptance path.
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
    insert into notifications (kind, audience, worker_id, job_id, stage_order, title, body)
    values (
      'stage_assigned', 'worker', v_worker_id, p_job_id, p_stage_order,
      format('New job: %s', v_job.plate_number),
      format('%s · %s — tap Accept to start the timer.', v_stage.name, v_job.service_name)
    );
  end loop;

  return v_stage;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- accept_stage — the worker's own action. Starts the clock. Runs as the
-- definer because a worker cannot write `jobs.status` directly under RLS.
-- ---------------------------------------------------------------------------
create or replace function accept_stage(
  p_job_id uuid,
  p_stage_order int
) returns job_stages as $fn$
declare
  v_worker_id uuid := my_worker_id();
  v_stage job_stages%rowtype;
  v_now timestamptz := now();
begin
  if v_worker_id is null then
    raise exception 'This account is not linked to a worker.';
  end if;

  select * into v_stage from job_stages
   where job_id = p_job_id and stage_order = p_stage_order and v_worker_id = any(worker_ids);

  if v_stage.id is null then
    raise exception 'You are not assigned to this stage.';
  end if;
  if v_stage.status <> 'assigned' then
    raise exception 'This stage is not waiting for acceptance.';
  end if;

  update job_stages set
    start_time = v_now,
    expected_completion_time = v_now + make_interval(mins => expected_duration),
    status = 'in_progress'::stage_status
  where job_id = p_job_id and stage_order = p_stage_order
  returning * into v_stage;

  update jobs set status = 'in_progress'::job_status where id = p_job_id;

  return v_stage;
end $fn$ language plpgsql volatile security definer;

grant execute on function accept_stage(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- create_job — stage 1 now goes to 'assigned' (pending acceptance) instead
-- of straight to 'in_progress' when workers are picked at registration time.
-- The clock only starts once that worker accepts.
-- ---------------------------------------------------------------------------
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

  -- No explicit stages configured: one implicit stage for the whole service.
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
      insert into notifications (kind, audience, worker_id, job_id, stage_order, title, body)
      values (
        'stage_assigned', 'worker', v_worker_id, v_job.id, v_stage1_id,
        format('New job: %s', v_job.plate_number),
        format('%s — tap Accept to start the timer.', v_service.service_name)
      );
    end loop;
  end if;

  return v_job;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- reassign_stage — if the stage hasn't been accepted yet, swapping the
-- worker re-arms the acceptance step for the new person (new notification,
-- still no running clock). If it's already in progress, behaviour is
-- unchanged: swap who's on it, clock keeps running from the original start.
-- ---------------------------------------------------------------------------
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
      insert into notifications (kind, audience, worker_id, job_id, stage_order, title, body)
      values (
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

-- ---------------------------------------------------------------------------
-- complete_stage — unchanged measurement/flag logic, now also tells staff.
-- ---------------------------------------------------------------------------
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

  insert into notifications (kind, audience, job_id, stage_order, title, body)
  values (
    'stage_completed', 'staff', p_job_id, p_stage_order,
    format('%s finished %s', coalesce(v_worker_name, 'A worker'), v_stage.name),
    format('%s · %s min (target %s min)%s',
      v_job.plate_number, v_actual, v_stage.expected_duration,
      case when v_stage.flagged then ' — flagged for review' else '' end)
  );

  return v_stage;
end $fn$ language plpgsql volatile;

grant execute on function complete_stage(uuid, int, uuid, text) to authenticated;

-- worker_complete_stage already wraps complete_stage as security definer
-- (migration_002b) — no change needed, it inherits the notification for free.
