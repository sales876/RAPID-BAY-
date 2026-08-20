-- ===========================================================================
-- JRHQ Car Wash Operations & Time Management System
-- Supabase / PostgreSQL schema
--
-- Run this in the Supabase SQL editor, then run supabase/seed.sql.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------------
do $enum$ begin
  create type job_status as enum ('waiting', 'in_progress', 'completed', 'cancelled');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type payment_status as enum ('paid', 'unpaid', 'partial');
exception when duplicate_object then null; end $enum$;

-- Only the statuses a human sets are stored. "working" and "finishing soon"
-- are derived from the worker's active job so they can never drift out of
-- sync with the timers.
do $enum$ begin
  create type worker_status as enum ('available', 'on_break', 'offline');
exception when duplicate_object then null; end $enum$;

do $enum$ begin
  create type app_role as enum ('admin', 'receptionist');
exception when duplicate_object then null; end $enum$;

-- ---------------------------------------------------------------------------
-- Branches. One row today, multi-location tomorrow: every operational table
-- carries branch_id so a second site is an insert, not a migration.
-- ---------------------------------------------------------------------------
create table if not exists branches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  timezone   text not null default 'Asia/Dubai',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Staff accounts: Supabase Auth users plus a role.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  branch_id  uuid references branches(id) on delete set null,
  full_name  text not null default '',
  role       app_role not null default 'receptionist',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table if not exists car_types (
  id          text primary key,
  label       text not null,
  -- Multiplier applied to a service base duration when no explicit
  -- car_type + service override exists in service_durations.
  size_factor numeric(4,2) not null default 1.00,
  sort_order  int not null default 0,
  active      boolean not null default true
);

create table if not exists services (
  id            uuid primary key default gen_random_uuid(),
  service_name  text not null unique,
  base_duration int not null,
  price         numeric(10,2) not null default 0,
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Explicit per car-type / per-service overrides. Anything not listed falls
-- back to services.base_duration * car_types.size_factor.
create table if not exists service_durations (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references services(id) on delete cascade,
  car_type_id text not null references car_types(id) on delete cascade,
  duration    int not null,
  unique (service_id, car_type_id)
);

create table if not exists workers (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid references branches(id) on delete set null,
  name       text not null,
  phone      text,
  status     worker_status not null default 'available',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operational data
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid references branches(id) on delete set null,
  name       text not null,
  phone      text not null,
  created_at timestamptz not null default now()
);
create index if not exists customers_phone_idx on customers (phone);

create table if not exists vehicles (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customers(id) on delete set null,
  plate_number text not null,
  car_type     text not null references car_types(id),
  created_at   timestamptz not null default now()
);
create index if not exists vehicles_plate_idx on vehicles (upper(plate_number));

create table if not exists jobs (
  id                       uuid primary key default gen_random_uuid(),
  branch_id                uuid references branches(id) on delete set null,
  customer_id              uuid references customers(id) on delete set null,
  vehicle_id               uuid references vehicles(id) on delete set null,
  service_id               uuid references services(id) on delete set null,
  worker_id                uuid references workers(id) on delete set null,

  -- Denormalised for reporting stability: a March report should not change
  -- because a customer was renamed or a service retired in June.
  customer_name            text not null,
  phone                    text not null default '',
  plate_number             text not null,
  car_type                 text not null,
  service_name             text not null,
  worker_name              text not null default '',
  price                    numeric(10,2) not null default 0,

  date                     date not null,
  arrival_time             timestamptz not null default now(),
  start_time               timestamptz,
  expected_completion_time timestamptz,
  completion_time          timestamptz,
  expected_duration        int,
  actual_duration          int,
  payment_status           payment_status not null default 'unpaid',
  status                   job_status not null default 'waiting',
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists jobs_date_idx   on jobs (date desc);
create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_worker_idx on jobs (worker_id);
create index if not exists jobs_plate_idx  on jobs (upper(plate_number));

create or replace function touch_updated_at() returns trigger as $fn$
begin
  new.updated_at = now();
  return new;
end $fn$ language plpgsql;

drop trigger if exists jobs_touch_updated_at on jobs;
create trigger jobs_touch_updated_at before update on jobs
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Duration resolution: car type + service -> minutes
-- ---------------------------------------------------------------------------
create or replace function resolve_duration(p_service_id uuid, p_car_type text)
returns int as $fn$
declare
  v_override int;
  v_base     int;
  v_factor   numeric;
begin
  select duration into v_override
    from service_durations
   where service_id = p_service_id and car_type_id = p_car_type;

  if v_override is not null then
    return v_override;
  end if;

  select base_duration into v_base   from services  where id = p_service_id;
  select size_factor   into v_factor from car_types where id = p_car_type;

  return greatest(5, round(coalesce(v_base, 30) * coalesce(v_factor, 1.0))::int);
end $fn$ language plpgsql stable;

-- ---------------------------------------------------------------------------
-- Register a vehicle and start its job in one transaction.
-- ---------------------------------------------------------------------------
create or replace function create_job(
  p_customer_name  text,
  p_phone          text,
  p_plate_number   text,
  p_car_type       text,
  p_service_id     uuid,
  p_worker_id      uuid,
  p_payment_status payment_status default 'unpaid',
  p_start_now      boolean default true,
  p_notes          text default null,
  p_branch_id      uuid default null
) returns jobs as $fn$
declare
  v_customer customers%rowtype;
  v_vehicle  vehicles%rowtype;
  v_service  services%rowtype;
  v_worker   workers%rowtype;
  v_duration int;
  v_branch   uuid;
  v_tz       text;
  v_now      timestamptz := now();
  v_job      jobs%rowtype;
begin
  v_branch := coalesce(p_branch_id, (select id from branches where active order by created_at limit 1));
  v_tz     := coalesce((select timezone from branches where id = v_branch), 'Asia/Dubai');

  select * into v_service from services where id = p_service_id;
  if not found then
    raise exception 'Unknown service %', p_service_id;
  end if;

  select * into v_worker from workers where id = p_worker_id;

  -- Reuse the customer record when the phone number is already known.
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

  v_duration := resolve_duration(p_service_id, p_car_type);

  insert into jobs (
    branch_id, customer_id, vehicle_id, service_id, worker_id,
    customer_name, phone, plate_number, car_type, service_name, worker_name, price,
    date, arrival_time, start_time, expected_completion_time,
    expected_duration, payment_status, status, notes
  ) values (
    v_branch, v_customer.id, v_vehicle.id, p_service_id, p_worker_id,
    p_customer_name, p_phone, upper(p_plate_number), p_car_type,
    v_service.service_name, coalesce(v_worker.name, ''), v_service.price,
    (v_now at time zone v_tz)::date,
    v_now,
    case when p_start_now then v_now else null end,
    case when p_start_now then v_now + make_interval(mins => v_duration) else null end,
    v_duration, p_payment_status,
    case when p_start_now then 'in_progress'::job_status else 'waiting'::job_status end,
    p_notes
  ) returning * into v_job;

  return v_job;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- Start a waiting job, optionally reassigning the worker.
-- ---------------------------------------------------------------------------
create or replace function start_job(p_job_id uuid, p_worker_id uuid default null)
returns jobs as $fn$
declare
  v_job    jobs%rowtype;
  v_worker workers%rowtype;
  v_now    timestamptz := now();
begin
  if p_worker_id is not null then
    select * into v_worker from workers where id = p_worker_id;
  end if;

  update jobs set
    worker_id                = coalesce(p_worker_id, worker_id),
    worker_name              = coalesce(v_worker.name, worker_name),
    start_time               = v_now,
    expected_completion_time = v_now + make_interval(mins => expected_duration),
    status                   = 'in_progress'
  where id = p_job_id
  returning * into v_job;

  if v_job.id is null then
    raise exception 'Unknown job %', p_job_id;
  end if;

  return v_job;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- Complete a job: stop the clock, measure against target, free the worker.
-- ---------------------------------------------------------------------------
create or replace function complete_job(p_job_id uuid)
returns jobs as $fn$
declare
  v_job jobs%rowtype;
  v_now timestamptz := now();
begin
  update jobs set
    completion_time = v_now,
    actual_duration = greatest(1, round(extract(epoch from (v_now - coalesce(start_time, arrival_time))) / 60)::int),
    status          = 'completed'
  where id = p_job_id
  returning * into v_job;

  if v_job.id is null then
    raise exception 'Unknown job %', p_job_id;
  end if;

  return v_job;
end $fn$ language plpgsql volatile;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table branches          enable row level security;
alter table profiles          enable row level security;
alter table car_types         enable row level security;
alter table services          enable row level security;
alter table service_durations enable row level security;
alter table workers           enable row level security;
alter table customers         enable row level security;
alter table vehicles          enable row level security;
alter table jobs              enable row level security;

create or replace function is_staff() returns boolean as $fn$
  select exists (select 1 from profiles where id = auth.uid() and active);
$fn$ language sql stable security definer;

create or replace function is_admin() returns boolean as $fn$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin');
$fn$ language sql stable security definer;

do $policies$
declare t text;
begin
  -- Any signed-in staff member may read operational data.
  foreach t in array array['branches','car_types','services','service_durations',
                           'workers','customers','vehicles','jobs']
  loop
    execute format('drop policy if exists staff_read on %I', t);
    execute format('create policy staff_read on %I for select using (is_staff())', t);
  end loop;

  -- Receptionists run the floor: they create and update jobs, customers and
  -- vehicles. They cannot change configuration.
  foreach t in array array['customers','vehicles','jobs']
  loop
    execute format('drop policy if exists staff_insert on %I', t);
    execute format('create policy staff_insert on %I for insert with check (is_staff())', t);
    execute format('drop policy if exists staff_update on %I', t);
    execute format('create policy staff_update on %I for update using (is_staff())', t);
  end loop;

  -- Configuration is admin-only.
  foreach t in array array['branches','car_types','services','service_durations','workers']
  loop
    execute format('drop policy if exists admin_write on %I', t);
    execute format('create policy admin_write on %I for all using (is_admin()) with check (is_admin())', t);
  end loop;
end $policies$;

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select using (id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $rt$ begin
  alter publication supabase_realtime add table jobs;
exception when duplicate_object then null; end $rt$;

do $rt$ begin
  alter publication supabase_realtime add table workers;
exception when duplicate_object then null; end $rt$;
